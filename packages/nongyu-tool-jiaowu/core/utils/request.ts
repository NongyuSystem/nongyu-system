/**
 * 网络请求封装模块
 * 基于 axios 实现，包含请求拦截、响应拦截、自动重试
 * （统一身份认证改造后已移除「静默自动登录」，改用 JiaowuSessionExpiredError 交给界面）
 */

import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import { decodeGbk } from "./decode";
import { getCookie, setCookie } from "./cookie";
import {
  JiaowuSessionExpiredError,
  isJiaowuTimeoutError,
  resolveJiaowuErrorMessage,
} from "./errors";
import { resolveJiaowuUserAgent } from "./userAgent";

/**
 * 教务网请求的通用 Headers
 * 模拟浏览器环境以通过服务器的基本校验
 */
const COMMON_HEADERS: Record<string, string> = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "accept-encoding": "gzip, deflate, br, zstd",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
  "upgrade-insecure-requests": "1",
};

/**
 * Axios 实例配置
 * 设置超时时间、通用 Header，并指定响应类型为 arraybuffer 以便后续处理 GBK 编码
 */
const service: AxiosInstance = axios.create({
  timeout: 20000,
  headers: COMMON_HEADERS,
  responseType: "arraybuffer", // 默认返回 arraybuffer 以便手动解码 GBK
});

/**
 * 请求拦截器
 * 在发送请求前自动注入当前有效的 Cookie
 */
service.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const cookie = getCookie();

    // 登录请求已按浏览器抓包带 UA，不得覆盖
    if (!headerHas(config.headers, "User-Agent")) {
      config.headers.set("User-Agent", resolveJiaowuUserAgent());
    }

    // 自动设置 Referer，许多 ASP 系统以此作为安全校验
    if (config.url && !config.headers["Referer"]) {
      config.headers["Referer"] = config.url;
    }

    // 只有在没有手动设置 Cookie 的情况下才注入全局 Cookie
    if (cookie && !headerHas(config.headers, "Cookie")) {
      config.headers.set("Cookie", cookie);
    }
    return config;
  },
  (error: any) => {
    return Promise.reject(error);
  },
);

/**
 * 扩展 AxiosRequestConfig 接口
 * 添加自定义属性以支持重试计数、登录重试标识以及完整响应控制
 */
export interface ExtendedAxiosRequestConfig extends AxiosRequestConfig {
  _retryCount?: number; // 当前重试次数
  /** @deprecated 统一身份认证改造后不再自动重登，字段保留以兼容既有调用方 */
  _reloginAttempted?: boolean;
  fullResponse?: boolean; // 是否返回完整的 AxiosResponse 对象
}

/**
 * 教务 axios 结算事件（供 RN 开发态日志使用，包内不打印）
 */
export type JiaowuHttpLogEvent = {
  ok: boolean;
  method: string;
  url: string;
  status: number | null;
  durationMs: number;
  requestBody: unknown;
  responseBody: unknown;
  errorMessage: string | null;
  hasAuthorization: boolean;
  hasCookie: boolean;
};

let jiaowuHttpLogger: ((event: JiaowuHttpLogEvent) => void) | undefined;

/**
 * 判断 axios headers 上是否存在指定头（不读取原文，只看有无）
 */
function headerHas(headers: AxiosRequestConfig["headers"], name: string): boolean {
  if (!headers) return false;
  const getter = (headers as { get?: (key: string) => unknown }).get;
  if (typeof getter === "function") {
    const value = getter.call(headers, name);
    return value != null && value !== "";
  }
  const record = headers as Record<string, unknown>;
  const matched = record[name] ?? record[name.toLowerCase()];
  return matched != null && matched !== "";
}

/**
 * 解析 axios 最终请求 URL（含 query）
 */
function resolveAxiosUrl(config: AxiosRequestConfig): string {
  try {
    return axios.getUri(config);
  } catch {
    const path = config.url ?? "";
    const base = config.baseURL ?? "";
    return `${base}${path}` || "(unknown url)";
  }
}

/**
 * 从 config / error 组装一条结算事件
 */
function buildJiaowuHttpLogEvent(
  config: ExtendedAxiosRequestConfig | undefined,
  status: number | null,
  responseBody: unknown,
  errorMessage: string | null,
  startedAt: number,
): JiaowuHttpLogEvent {
  return {
    ok: errorMessage == null && status != null && status >= 200 && status < 400,
    method: (config?.method ?? "GET").toUpperCase(),
    url: config ? resolveAxiosUrl(config) : "(unknown url)",
    status,
    durationMs: Date.now() - startedAt,
    requestBody: config?.data,
    responseBody,
    errorMessage,
    hasAuthorization: headerHas(config?.headers, "Authorization"),
    hasCookie: headerHas(config?.headers, "Cookie"),
  };
}

/**
 * 安全触发开发态日志回调，失败不影响原请求
 */
function emitJiaowuHttpLog(event: JiaowuHttpLogEvent): void {
  if (!jiaowuHttpLogger) return;
  try {
    jiaowuHttpLogger(event);
  } catch {
    // 日志回调失败不得影响教务请求
  }
}

/**
 * 注册教务请求结算回调（幂等覆盖）。未注册时 request() 零额外开销以外的分支即 return。
 * 挂在 request() 而非拦截器，避免内部重试/自动登录把同一业务请求打两遍。
 */
export function attachJiaowuHttpLogger(onSettled: (event: JiaowuHttpLogEvent) => void): void {
  jiaowuHttpLogger = onSettled;
}

/**
 * 响应拦截器
 * 1. 处理 GBK 解码
 * 2. 检测并处理“登录超时”
 * 3. 错误时触发自动重试逻辑
 */
service.interceptors.response.use(
  async (response: AxiosResponse) => {
    const config = response.config as ExtendedAxiosRequestConfig;

    // 一律先 GBK 解码。check.asp 若保持 ArrayBuffer，jiaowuLogin 无法识别失败脚本。
    const decodedHtml = decodeGbk(response.data);
    response.data = decodedHtml;

    // 登录接口只解码，不做超时自动重登，避免与 jiaowuLogin 死循环
    if (config.url?.includes("check.asp")) {
      return response;
    }

    // 判断响应内容是否提示登录超时
    if (decodedHtml.includes("登录超时") || decodedHtml.includes("账号验证失败")) {
      // 统一身份认证改造（2026-10-23）后，重新登录必须由用户看一次图形验证码，
      // 已无法用本地密码静默重登：这里只清掉失效会话，把「需重新登录」抛给界面。
      setCookie("");
      return Promise.reject(new JiaowuSessionExpiredError());
    }

    return response;
  },
  async (error) => {
    const config = error.config as ExtendedAxiosRequestConfig | undefined;

    // 如果是网络错误或其他异常，且重试次数未达上限（默认3次），进行重试
    if (config && (config._retryCount || 0) < 3) {
      config._retryCount = (config._retryCount || 0) + 1;
      console.log(`网络错误或请求失败，正在进行第 ${config._retryCount} 次重试...`);

      // 延迟 1s 后重试
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return service(config);
    }

    // 重试耗尽：超时统一抛出校园网提示，便于上层直接透出 message
    if (isJiaowuTimeoutError(error)) {
      return Promise.reject(new Error(resolveJiaowuErrorMessage(error)));
    }
    return Promise.reject(error);
  },
);

/**
 * 通用请求封装函数
 *
 * @param config 请求配置对象
 * @returns 根据 config.fullResponse 返回数据内容或完整响应对象
 *
 * @example
 * const html = await request({ url: '/api/page' });
 * const full = await request({ url: '/api/page', fullResponse: true });
 */
export async function request<T = any>(config: ExtendedAxiosRequestConfig): Promise<T> {
  const startedAt = Date.now();
  try {
    const response = await service.request(config);
    emitJiaowuHttpLog(
      buildJiaowuHttpLogEvent(
        response.config as ExtendedAxiosRequestConfig,
        response.status,
        response.data,
        null,
        startedAt,
      ),
    );
    if (config.fullResponse) {
      return response as any;
    }
    return response.data as T;
  } catch (error: unknown) {
    const axiosError = error as {
      config?: ExtendedAxiosRequestConfig;
      response?: { status?: number; data?: unknown };
      message?: string;
    };
    emitJiaowuHttpLog(
      buildJiaowuHttpLogEvent(
        axiosError.config ?? config,
        axiosError.response?.status ?? null,
        axiosError.response?.data,
        axiosError.message ?? String(error),
        startedAt,
      ),
    );
    throw error;
  }
}

/**
 * GET 请求便捷方法
 *
 * @param url 请求地址
 * @param params URL 参数对象
 * @param config 额外配置
 */
export function get<T = any>(
  url: string,
  params?: any,
  config: ExtendedAxiosRequestConfig = {},
): Promise<T> {
  return request<T>({
    url,
    method: "GET",
    params,
    ...config,
  });
}

/**
 * POST 请求便捷方法
 *
 * @param url 请求地址
 * @param data Body 数据
 * @param config 额外配置
 */
export function post<T = any>(
  url: string,
  data?: any,
  config: ExtendedAxiosRequestConfig = {},
): Promise<T> {
  return request<T>({
    url,
    method: "POST",
    data,
    ...config,
  });
}

export default request;

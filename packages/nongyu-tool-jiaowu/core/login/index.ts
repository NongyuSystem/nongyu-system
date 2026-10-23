/**
 * 教务登录模块
 * 负责维护用户凭据、执行登录请求以及生成/管理会话 Cookie
 */

import {
  get,
  post,
  getCookie,
  setCookie,
  decodeGbk,
  resolveJiaowuErrorMessage,
  type ExtendedAxiosRequestConfig,
} from "../utils";
import { AxiosResponse } from "axios";

/**
 * 内部存储的全局登录凭据
 */
const LOGIN_DATA = {
  user: "", // 学号
  pwd: "", // 密码
};

/**
 * 设置全局登录数据，内部测试用，模拟登录
 */
export const setLoginData = (user: string, pwd: string) => {
  LOGIN_DATA.user = user;
  LOGIN_DATA.pwd = pwd;
};

/**
 * 获取当前存储的全局登录数据
 */
export const getLoginData = () => {
  return LOGIN_DATA;
};

/**
 * 清空内存中的登录凭据与 Cookie（登出时调用）
 */
export const clearLoginData = () => {
  LOGIN_DATA.user = "";
  LOGIN_DATA.pwd = "";
  setCookie("");
};

/**
 * 官网登录页（浏览器会先打开此页再提交 check.asp）
 */
const LOGIN_PAGE_URL = "https://jiaowu.sicau.edu.cn/web/web/web/index.asp";

/**
 * 教务网登录校验接口地址
 */
const LOGIN_ENDPOINT = "https://jiaowu.sicau.edu.cn/jiaoshi/bangong/check.asp";

/**
 * 登录表单中除学号密码外的固定域（sign / hour_key 从登录页解析）
 */
const FIXED_FORM_PARAMS = {
  lb: "S",
  submit: "",
};

/**
 * 与浏览器登录页一致的公共头（不含 Cookie / Content-Type）
 */
const LOGIN_BROWSER_HEADERS: Record<string, string> = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0",
  "sec-ch-ua": '"Not=A?Brand";v="99", "Microsoft Edge";v="151", "Chromium";v="151"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
};

/**
 * 登录会话 Cookie 的前缀
 */
const COOKIE_PREFIX = "ASPSESSIONID";

/**
 * 收集响应头里的 Set-Cookie 原始值（兼容 axios 普通对象与 AxiosHeaders）
 */
function readSetCookieHeader(headers: AxiosResponse["headers"]): unknown[] {
  if (!headers) return [];

  const collected: unknown[] = [
    (headers as Record<string, unknown>)["set-cookie"],
    (headers as Record<string, unknown>)["Set-Cookie"],
  ];

  const getter = (headers as { get?: (name: string) => unknown }).get;
  if (typeof getter === "function") {
    collected.push(getter.call(headers, "set-cookie"));
    collected.push(getter.call(headers, "Set-Cookie"));
  }

  return collected;
}

/**
 * 从响应头中提取所有 ASPSESSIONID 类型的 Cookie
 */
function extractCookiesFromHeaders(headers: AxiosResponse["headers"]): string[] {
  const pairs: string[] = [];

  for (const raw of readSetCookieHeader(headers)) {
    if (raw == null || raw === "") continue;
    const items = Array.isArray(raw) ? raw : [raw];
    for (const item of items) {
      const pair = String(item).split(";")[0]?.trim();
      if (pair && pair.toUpperCase().includes(COOKIE_PREFIX)) {
        pairs.push(pair);
      }
    }
  }

  return [...new Set(pairs)];
}

/**
 * 从登录页 HTML 取出 hidden input 的 value（兼容 name/value 两种属性顺序）
 */
function extractHiddenInputValue(html: string, fieldName: string): string | null {
  const nameFirst = new RegExp(
    `name\\s*=\\s*["']${fieldName}["'][^>]*value\\s*=\\s*["']([^"']+)["']`,
    "i",
  );
  const valueFirst = new RegExp(
    `value\\s*=\\s*["']([^"']+)["'][^>]*name\\s*=\\s*["']${fieldName}["']`,
    "i",
  );
  const fromNameFirst = html.match(nameFirst)?.[1]?.trim();
  if (fromNameFirst) return fromNameFirst;
  const fromValueFirst = html.match(valueFirst)?.[1]?.trim();
  return fromValueFirst || null;
}

type JiaowuLoginPageFields = {
  sign: string;
  hourKey: string;
};

/**
 * 将登录响应体规范为字符串（拦截器应已解码；此处兜底 ArrayBuffer）
 */
function toLoginResponseText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data == null) return "";
  if (typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer) {
    return decodeGbk(data);
  }
  if (ArrayBuffer.isView(data)) {
    return decodeGbk(data as Uint8Array);
  }
  return String(data);
}

/**
 * 解析 check.asp 失败页文案。
 * 失败多为 alert + history.back；成功多为 302 或 200 + location 跳转，二者都不应判失败。
 */
function parseJiaowuLoginFailureMessage(html: string): string | null {
  const text = html.replace(/^\uFEFF/, "").trim();
  if (!text) return null;

  const alertMatch = text.match(/alert\s*\(\s*["']([^"']+)["']\s*\)/i);
  if (alertMatch?.[1]) {
    return alertMatch[1].trim();
  }

  const isJsRedirect =
    /(?:window\.)?location(?:\.href)?\s*=/i.test(text) || /window\.navigate\s*\(/i.test(text);
  if (isJsRedirect) return null;

  const looksLikeFailScript =
    text.toLowerCase().startsWith("<script") && /history\.(back|go)/i.test(text);
  if (looksLikeFailScript || /登录失败|密码错误|账号不存在/.test(text)) {
    return "登录失败，可能是学号密码错误或接口变动";
  }

  return null;
}

/**
 * 打开官网登录页：写入 ASP Cookie，并解析 sign / hour_key
 */
async function openJiaowuLoginPage(): Promise<JiaowuLoginPageFields> {
  setCookie("");
  const pageResponse = (await get(LOGIN_PAGE_URL, undefined, {
    headers: {
      ...LOGIN_BROWSER_HEADERS,
      Referer: "https://jiaowu.sicau.edu.cn/",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
    },
    fullResponse: true,
    validateStatus: (status) => status >= 200 && status < 400,
  } as ExtendedAxiosRequestConfig)) as unknown as AxiosResponse;

  const pageCookies = extractCookiesFromHeaders(pageResponse.headers);
  if (pageCookies.length > 0) {
    setCookie(pageCookies.join("; "));
  }

  const html = toLoginResponseText(pageResponse.data);
  const sign = extractHiddenInputValue(html, "sign");
  const hourKey = extractHiddenInputValue(html, "hour_key");
  if (!sign || !hourKey) {
    throw new Error("登录页未解析到 sign 或 hour_key");
  }
  return { sign, hourKey };
}

/**
 * 组装 check.asp 请求头；有会话 Cookie 才写入，避免空 Cookie 盖掉 RN 原生 Cookie 罐
 */
function buildLoginPostHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    ...LOGIN_BROWSER_HEADERS,
    "Cache-Control": "max-age=0",
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: "https://jiaowu.sicau.edu.cn",
    Referer: LOGIN_PAGE_URL,
    Priority: "u=0, i",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
  };
  const sessionCookie = getCookie();
  if (sessionCookie) {
    headers.Cookie = sessionCookie;
  }
  return headers;
}

/**
 * 四川农业大学教务系统登录函数。
 *
 * 先打开官网登录页建立会话，从 hidden 域解析 sign / hour_key，再向 check.asp 提交学号密码。
 *
 * @deprecated 教务系统自 2026-10-23 起已取消首页「账号 + 密码」登录，
 * 该口令路径随时可能被彻底关闭。请改用 `jiaowuLoginByCas`（统一身份认证 + 用户输入的图形验证码），
 * 详见 `./cas.ts`。本函数暂时保留，只为在旧路径仍可用时做回退对照。
 *
 * 使用场景：
 * 1. 农屿App登录页，校验通过后农屿本地存学号和密码
 *
 * @param user - 学号/用户名，不传则使用内置默认值
 * @param pwd  - 密码，不传则使用内置默认值
 *
 * @returns 成功返回 `{ success: true, cookie: string }`，失败返回 `{ success: false, message: string }`
 *
 * @example 基本调用
 * ```ts
 * // 不传参数，使用内置默认账号密码
 * const result = await jiaowuLogin();
 * ```
 *
 * @example 成功示例
 * ```ts
 * const result = await jiaowuLogin('20210001', 'mypassword');
 * // {
 * //   success: true,
 * //   cookie: 'ASPSESSIONIDCEQTSTBS=ABCDEFGHIJKLMNOPQRSTUVWX'
 * // }
 * ```
 *
 * @example 失败示例 - 账号密码错误
 * ```ts
 * const result = await jiaowuLogin('20210001', 'wrong_pwd');
 * // {
 * //   success: false,
 * //   message: '用户名或密码错误！'  // 优先透出教务 alert 原文
 * // }
 * ```
 *
 * @example 失败示例 - 未提供凭据
 * ```ts
 * const result = await jiaowuLogin('', '');
 * // {
 * //   success: false,
 * //   message: '未提供用户名或密码'
 * // }
 * ```
 *
 * @example 失败示例 - 网络异常
 * ```ts
 * const result = await jiaowuLogin('20210001', 'mypassword');
 * // {
 * //   success: false,
 * //   message: '登录异常: Network Error'
 * // }
 * ```
 */
export async function jiaowuLogin(user?: string, pwd?: string) {
  const finalUser = user || LOGIN_DATA.user;
  const finalPwd = pwd || LOGIN_DATA.pwd;

  if (!finalUser || !finalPwd) {
    return { success: false, message: "未提供用户名或密码" };
  }

  try {
    const pageFields = await openJiaowuLoginPage();

    const params = new URLSearchParams();
    params.append("user", finalUser);
    params.append("pwd", finalPwd);
    params.append("lb", FIXED_FORM_PARAMS.lb);
    params.append("submit", FIXED_FORM_PARAMS.submit);
    params.append("sign", pageFields.sign);
    params.append("hour_key", pageFields.hourKey);

    const response = (await post(LOGIN_ENDPOINT, params.toString(), {
      headers: buildLoginPostHeaders(),
      fullResponse: true,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    } as ExtendedAxiosRequestConfig)) as unknown as AxiosResponse;

    const resultText = toLoginResponseText(response.data);
    const isRedirect = response.status >= 300 && response.status < 400;
    const failureMessage = isRedirect ? null : parseJiaowuLoginFailureMessage(resultText);

    if (failureMessage) {
      return { success: false, message: failureMessage };
    }

    const serverCookies = extractCookiesFromHeaders(response.headers);
    const sessionCookie = getCookie();
    const finalCookie = serverCookies[0] || sessionCookie;
    if (finalCookie) {
      setCookie(finalCookie);
    }
    setLoginData(finalUser, finalPwd);

    return { success: true, cookie: finalCookie || "" };
  } catch (error: unknown) {
    const message = resolveJiaowuErrorMessage(error, "登录异常");
    console.error("登录请求异常:", message);
    return { success: false, message };
  }
}

/**
 * 统一身份认证（CAS）登录。
 *
 * 教务系统改为只走「微信扫码」或「统一身份认证」之后，登录主路径是这里：
 * 先 `getJiaowuCaptcha()` 取图给用户看，用户输入后交给 `jiaowuLoginByCas()`。
 * 验证码必须由用户读图输入 —— 这也是平台区分人与脚本的唯一手段。
 */
export {
  getJiaowuCaptcha,
  jiaowuLoginByCas,
  type JiaowuCaptcha,
  type JiaowuCaptchaResult,
  type JiaowuCasLoginInput,
  type JiaowuCasLoginResult,
} from "./cas";

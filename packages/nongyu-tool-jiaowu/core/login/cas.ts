/**
 * 统一身份认证（川农 e 认证 / CAS）登录模块
 *
 * 背景：教务系统自 2026-10-23 起取消首页「账号 + 密码」直接登录，
 * 旧的 `check.asp` 口令提交路径失效，改为「微信扫码」或「统一身份认证」。
 * 本模块实现后者，链路与浏览器点击「统一身份认证登录」完全一致：
 *
 * ```text
 * GET  /jiaoshi/aspsso/caslogin.asp                    → 302 到统一身份认证（appid + service）
 * GET  /api/v1/captcha?appid=<教务 appid>              → 图形验证码（加密响应体）
 * POST /api/v1/cas/login                               → 校验通过后返回 ticket（加密响应体）
 * GET  <callbackUrl>?ticket=<st>:<userId>&userId=<id>  → 教务系统据此建立 ASP 会话
 * ```
 *
 * 与旧口令登录的关键差异：**每次登录都必须由用户输入图形验证码**，
 * 因此不再具备「会话超时后静默用本地密码重登」的能力（见《教务鉴权方案》）。
 *
 * @module core/login/cas
 */

import axios from "axios";
import CryptoJS from "crypto-js";

import { resolveJiaowuErrorMessage } from "../utils/errors";
import { getCookie, setCookie } from "../utils/cookie";

/** 统一身份认证平台根地址 */
const CAS_BASE_URL = "https://auth.sicau.edu.cn";

/**
 * 教务系统在统一身份认证平台注册的应用标识。
 * 来源：`caslogin.asp` 的 302 `Location`，不是自定义值，改动须重新抓取。
 */
const CAS_APPID = "b54a2f27-f7ba-4b91-bbf0-3b2b12244d14";

/**
 * 教务系统的 CAS 入口，同时也是 CAS 协议的 `service` 参数。
 * 平台会把 `ticket` 回投到这里，教务据此建立自己的 ASP 会话。
 */
const CAS_SERVICE_URL = "https://jiaowu.sicau.edu.cn/jiaoshi/aspsso/caslogin.asp";

/**
 * 响应体加密的盐值，与平台前端一致：`MD5(requestId + SALT)` 得到 AES key。
 */
const RESPONSE_SALT = ":sicau-cas";

/** 教务 ASP 会话 Cookie 前缀（会话只认这一族） */
const ASP_COOKIE_PREFIX = "ASPSESSIONID";

/** 教务回调允许跟随的最大跳数（实测 2 跳，留余量） */
const CAS_MAX_REDIRECTS = 5;

/** 统一身份认证接口超时（毫秒） */
const CAS_TIMEOUT = 15000;

/** 教务回调超时（毫秒），教务网在校园网外常超时 */
const CALLBACK_TIMEOUT = 20000;

/** 平台响应信封 */
type CasEnvelope<T> = {
  code?: number;
  msg?: string;
  status?: string;
  data?: T | string | null;
  /** 参与解密的随机串，缺一不可 */
  requestId?: string;
  /** 验证码标识，仅 /api/v1/captcha 返回 */
  id?: string;
};

/** 图形验证码：`image` 是可直接喂给 `<Image source={{ uri }} />` 的 data URI */
export type JiaowuCaptcha = {
  /** 验证码标识，提交登录时原样回传 */
  uuid: string;
  /** `data:image/png;base64,...` */
  image: string;
};

/** CAS 登录入参 */
export type JiaowuCasLoginInput = {
  /** 学号 */
  studentId: string;
  /** 统一身份认证密码 */
  password: string;
  /** 用户看图输入的验证码 */
  captchaCode: string;
  /** 与验证码配套的 uuid */
  captchaUuid: string;
};

/** CAS 登录结果 */
export type JiaowuCasLoginResult =
  | { success: true; cookie: string }
  | {
      success: false;
      message: string;
      /**
       * 是否需要立刻换一张验证码。
       * 「验证码错误」「验证码已过期」这类失败必须刷新，否则用户会反复提交同一张废图。
       */
      needRefreshCaptcha?: boolean;
    };

/** 验证码获取结果 */
export type JiaowuCaptchaResult =
  | { success: true; result: JiaowuCaptcha }
  | { success: false; message: string };

/**
 * 解密平台响应体。
 *
 * 算法（与平台前端 `qr()` 一致）：
 * 1. `key = MD5(requestId + ":sicau-cas")`，取 32 位 hex 作为 AES-128 key；
 * 2. base64 解码后，**前 16 字节是 IV**，其余是密文；
 * 3. AES-128-CBC 解密且**关闭标准填充**（NoPadding）；
 * 4. 明文最后一个字节 = 自定义填充长度 N，去掉尾部 N 字节；
 * 5. 剩余部分是 JSON。
 *
 * 不用 `node:crypto`：本包同时跑在 RN 上，那里没有该模块。
 *
 * @param encryptedText 响应体里的 `data` 字段（base64）
 * @param requestId     同响应的 `requestId` 字段
 */
function decryptCasData(encryptedText: string, requestId: string): unknown {
  const aesKeyHex = CryptoJS.MD5(`${requestId}${RESPONSE_SALT}`).toString(CryptoJS.enc.Hex);

  const raw = CryptoJS.enc.Base64.parse(encryptedText);
  const iv = raw.clone();
  iv.sigBytes = 16;
  iv.clamp();

  // 前 4 个 word（16 字节）是 IV，其余是密文
  const ciphertext = CryptoJS.lib.WordArray.create(raw.words.slice(4));

  const plain = CryptoJS.AES.decrypt(
    { ciphertext } as unknown as CryptoJS.lib.CipherParams,
    CryptoJS.enc.Hex.parse(aesKeyHex),
    {
      iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.NoPadding,
    },
  );

  const text = plain.toString(CryptoJS.enc.Utf8);
  const padLength = (plain.words[plain.words.length - 1] ?? 0) & 0xff;
  const json = padLength > 0 && padLength < text.length ? text.slice(0, -padLength) : text;

  return JSON.parse(json);
}

/**
 * 拆信封：`data` 为字符串时先解密，为对象或 null 时原样返回。
 *
 * 失败响应（如「验证码错误」）的 `data` 是 `null`，不能拿去解密。
 */
function unwrapEnvelope<T>(body: CasEnvelope<T> | null | undefined): T | null {
  if (!body || body.data == null) return null;
  if (typeof body.data !== "string") return body.data;
  try {
    return decryptCasData(body.data, String(body.requestId ?? "")) as T;
  } catch {
    return null;
  }
}

/**
 * 收集响应头里的 Set-Cookie，只保留 ASPSESSIONID 族。
 *
 * RN 的 XHR 有时读不到 `Set-Cookie`，此时返回空数组，
 * 由调用方决定是否沿用内存里已有的 Cookie（不要写空 Cookie 头）。
 */
function extractAspCookies(headers: unknown): string[] {
  if (!headers) return [];
  const collected: unknown[] = [];
  const bag = headers as Record<string, unknown> & { get?: (name: string) => unknown };

  collected.push(bag["set-cookie"], bag["Set-Cookie"]);
  if (typeof bag.get === "function") {
    collected.push(bag.get("set-cookie"), bag.get("Set-Cookie"));
  }

  const pairs: string[] = [];
  for (const raw of collected) {
    if (raw == null || raw === "") continue;
    const items = Array.isArray(raw) ? raw : [String(raw)];
    for (const item of items) {
      const pair = String(item).split(";")[0]?.trim();
      if (pair && pair.toUpperCase().includes(ASP_COOKIE_PREFIX)) {
        pairs.push(pair);
      }
    }
  }
  return [...new Set(pairs)];
}

/**
 * 合并新旧 Cookie：同名以新值为准，避免把同一个 ASP 会话写两遍。
 */
function mergeCookiePairs(...groups: string[][]): string {
  const map = new Map<string, string>();
  for (const group of groups) {
    for (const pair of group) {
      const name = pair.slice(0, pair.indexOf("=") >>> 0) || pair;
      map.set(name.trim().toUpperCase(), pair);
    }
  }
  return [...map.values()].join("; ");
}

/** 教务回调请求头：贴近真实浏览器点击「统一身份认证登录」后的一次跳转 */
function buildCallbackHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Cache-Control": "max-age=0",
  };
  if (cookie) headers.Cookie = cookie;
  return headers;
}

/**
 * 获取一张图形验证码。
 *
 * 用法：先拿图给用户看，用户输入后连同 `uuid` 一起交给 {@link jiaowuLoginByCas}。
 * 图过期或用户看不清时重新调用本函数即可换图。
 */
export async function getJiaowuCaptcha(): Promise<JiaowuCaptchaResult> {
  try {
    const response = await axios.get(`${CAS_BASE_URL}/api/v1/captcha`, {
      params: { appid: CAS_APPID },
      timeout: CAS_TIMEOUT,
      headers: { Accept: "application/json" },
    });

    const body = response.data as CasEnvelope<string>;
    const image = unwrapEnvelope<string>(body);
    const uuid = body?.id;

    if (!uuid || typeof image !== "string" || !image.startsWith("data:image")) {
      return { success: false, message: body?.msg || "验证码获取失败，请重试" };
    }

    return { success: true, result: { uuid, image } };
  } catch (error) {
    return { success: false, message: resolveJiaowuErrorMessage(error, "验证码获取失败") };
  }
}

/**
 * 把 ticket 写进教务回调地址（set 语义，替换同名参数）。
 *
 * 平台返回的 `callbackUrl` **自带 `?ticket=ST:xxx`**（只有 service ticket，没有 userId 后缀）。
 * 平台前端用 `searchParams.set("ticket", st + ":" + userId)` 覆盖它；
 * 若这里改成字符串追加，URL 会同时出现两个 `ticket`，教务取第一个（缺 `:userId`）→
 * 回调虽然 200，但会话不成立，业务页仍 302 回登录页。
 *
 * RN 的 URL polyfill 不保证支持 `searchParams`，故手工实现。
 */
function buildCallbackUrl(callbackBase: string, ticket: string, userId: string): string {
  const queryIndex = callbackBase.indexOf("?");
  const path = queryIndex === -1 ? callbackBase : callbackBase.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : callbackBase.slice(queryIndex + 1);

  const kept = query
    .split("&")
    .filter(Boolean)
    .filter((pair) => {
      const key = pair.split("=")[0];
      return key !== "ticket" && key !== "userId";
    });

  kept.push(`ticket=${encodeURIComponent(`${ticket}:${userId}`)}`);
  kept.push(`userId=${encodeURIComponent(userId)}`);

  return `${path}?${kept.join("&")}`;
}

/**
 * 解析 302 的 `Location`（可能是相对路径，如 `../bangong/check_cas.asp?sign=…`）。
 *
 * RN 的 URL polyfill 不可靠，这里按 RFC 3986 的相对引用规则手工拼接：
 * 以当前 URL 的目录为基准，处理 `../` 与 `./`，保留 query。
 */
function resolveRedirect(base: string, location: string): string {
  if (/^https?:\/\//i.test(location)) return location;

  const originMatch = base.match(/^([a-z]+:\/\/[^/]+)/i);
  const origin = originMatch ? originMatch[1] : "";

  let target = location;
  if (!target.startsWith("/")) {
    const basePath = base.slice(origin.length).split("?")[0];
    const dir = basePath.slice(0, basePath.lastIndexOf("/") + 1);
    target = `${dir}${target}`;
  }

  const [pathPart, ...queryParts] = target.split("?");
  const query = queryParts.length > 0 ? `?${queryParts.join("?")}` : "";

  const stack: string[] = [];
  for (const segment of pathPart.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") stack.pop();
    else stack.push(segment);
  }

  return `${origin}/${stack.join("/")}${query}`;
}

/**
 * 通过统一身份认证登录教务系统。
 *
 * 流程（与浏览器一致，缺一不可）：
 * 1. 先 GET `caslogin.asp` 建立 ASP 会话（教务按「正常链接」校验来源）；
 * 2. `POST /api/v1/cas/login` 换取 service ticket；
 * 3. 带 ticket 回投 `caslogin.asp`，让教务系统用自己的 ASP 会话收下身份；
 * 4. 取回 `ASPSESSIONID*` 写入工具内存，后续业务页复用。
 *
 * 验证码由用户在界面上输入，不做任何 OCR —— 识别失败会让用户卡在登录页，
 * 而验证码本身就是平台用来区别人与脚本的。
 *
 * @example
 * ```ts
 * const cap = await getJiaowuCaptcha();
 * // 把 cap.result.image 显示给用户，等用户输入 code
 * const res = await jiaowuLoginByCas({
 *   studentId: "20210001",
 *   password: "******",
 *   captchaCode: "a1b2",
 *   captchaUuid: cap.result.uuid,
 * });
 * if (!res.success) {
 *   if (res.needRefreshCaptcha) 换一张验证码();
 * }
 * ```
 */
/** 统一身份认证成功后的 payload 形状（密码登录与短信登录共用） */
type CasLoginPayload = {
  callbackUrl?: string;
  st?: string;
  users?: Array<{ id?: string | number }>;
};

/**
 * 公共收尾：拿 service ticket 回投教务，沿重定向链建立 ASP 会话。
 *
 * 实测链路（缺一不可）：
 *   caslogin.asp?ticket=ST:xxx:userId&userId=…  → 302 ../bangong/check_cas.asp?sign=…
 *   check_cas.asp?sign=…                        → 302 首页 + Set-Cookie（新 ASPSESSIONID）
 *
 * 两个必须记住的点：
 * 1. 只停在第一跳（`maxRedirects: 0` 且不手动跟随）会拿到 302 却没有任何新 Cookie；
 * 2. `callbackUrl` 自带 `?ticket=ST:xxx`（无 userId 后缀），必须按 set 语义覆盖，
 *    否则 URL 里出现两个 ticket，教务取第一个（缺 `:userId`）→ 校验失败。
 */
async function completeServiceLogin(
  payload: CasLoginPayload | null,
  cookieFromEntry: string[],
): Promise<JiaowuCasLoginResult> {
  const ticket = payload?.st;
  const userId = payload?.users?.[0]?.id == null ? "" : String(payload.users[0].id);

  if (!ticket || !userId) {
    return { success: false, message: "统一身份认证未返回有效票据", needRefreshCaptcha: true };
  }

  let cookiePairs = cookieFromEntry.slice();
  let currentUrl = buildCallbackUrl(payload?.callbackUrl || CAS_SERVICE_URL, ticket, userId);
  let settled = false;

  for (let hop = 0; hop < CAS_MAX_REDIRECTS; hop += 1) {
    const step = await axios.get(currentUrl, {
      maxRedirects: 0,
      timeout: CALLBACK_TIMEOUT,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: buildCallbackHeaders(mergeCookiePairs(cookiePairs) || getCookie()),
      responseType: "text",
      transformResponse: [(data) => data],
    });

    cookiePairs = cookiePairs.concat(extractAspCookies(step.headers));

    const location = (step.headers as Record<string, unknown>)?.location;
    if (!location) {
      settled = true;
      break;
    }
    currentUrl = resolveRedirect(currentUrl, String(location));
  }

  const finalCookie = mergeCookiePairs(cookiePairs);

  if (!settled) {
    return {
      success: false,
      message: "教务系统回调跳转异常，请稍后重试",
      needRefreshCaptcha: true,
    };
  }

  if (!finalCookie) {
    return {
      success: false,
      message: "教务系统未返回会话 Cookie，请改用校园网重试",
      needRefreshCaptcha: true,
    };
  }

  // 落会话：业务页请求靠这串 Cookie
  setCookie(finalCookie);
  return { success: true, cookie: finalCookie };
}

export async function jiaowuLoginByCas(input: JiaowuCasLoginInput): Promise<JiaowuCasLoginResult> {
  const studentId = input.studentId?.trim();
  const password = input.password ?? "";
  const captchaCode = input.captchaCode?.trim();
  const captchaUuid = input.captchaUuid?.trim();

  if (!studentId || !password) {
    return { success: false, message: "未提供学号或密码" };
  }
  if (!captchaCode) {
    return { success: false, message: "请输入图形验证码" };
  }
  if (!captchaUuid) {
    // 没有 uuid 说明前端没先取验证码，直接失败比提交一个必然无效的请求更清楚
    return { success: false, message: "验证码已失效，请刷新后重试", needRefreshCaptcha: true };
  }

  let cookieFromEntry: string[] = [];

  try {
    // 1) 建立 ASP 会话。此步失败不阻断：拿到 ticket 后仍会再打一次回调。
    try {
      const entry = await axios.get(CAS_SERVICE_URL, {
        maxRedirects: 0,
        timeout: CALLBACK_TIMEOUT,
        validateStatus: (status) => status >= 200 && status < 400,
        headers: buildCallbackHeaders(getCookie()),
      });
      cookieFromEntry = extractAspCookies(entry.headers);
    } catch {
      cookieFromEntry = [];
    }

    // 2) 统一身份认证校验，换 service ticket
    const loginResponse = await axios.post(
      `${CAS_BASE_URL}/api/v1/cas/login`,
      {
        appid: CAS_APPID,
        code: captchaCode,
        number: studentId,
        password,
        uuid: captchaUuid,
      },
      {
        timeout: CAS_TIMEOUT,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
      },
    );

    const loginBody = loginResponse.data as CasEnvelope<{
      callbackUrl?: string;
      st?: string;
      users?: Array<{ id?: string | number }>;
    }>;

    const payload = unwrapEnvelope<{
      callbackUrl?: string;
      st?: string;
      users?: Array<{ id?: string | number }>;
    }>(loginBody);

    const ticket = payload?.st;
    const userId = payload?.users?.[0]?.id == null ? "" : String(payload.users[0].id);

    if (!ticket || !userId) {
      const message = loginBody?.msg || "统一身份认证登录失败";
      return {
        success: false,
        message,
        // 验证码 / 凭据类失败一律要求换图，避免用户拿废图反复提交
        needRefreshCaptcha: /验证码|captcha|过期/i.test(message),
      };
    }

    return completeServiceLogin(payload, cookieFromEntry);
  } catch (error) {
    return { success: false, message: resolveJiaowuErrorMessage(error, "登录异常") };
  }
}

/** 短信登录入参 */
export type JiaowuPhoneLoginInput = {
  /** 手机号（与统一身份认证绑定的一致） */
  phone: string;
  /** 收到的短信验证码 */
  smsCode: string;
};

/** 发送短信验证码入参 */
export type JiaowuSendSmsInput = {
  phone: string;
  /** 图形验证码（发短信前仍需过一道图形码） */
  captchaCode: string;
  captchaUuid: string;
};

/**
 * 发送登录短信验证码。
 *
 * 平台发短信前同样要过图形验证码 —— 这条路径无法完全免验证码，
 * 适合不想让服务端保存密码、又愿意每次收短信的用户。
 */
export async function sendJiaowuSmsCode(
  input: JiaowuSendSmsInput,
): Promise<{ success: true } | { success: false; message: string; needRefreshCaptcha?: boolean }> {
  const phone = input.phone?.trim();
  const captchaCode = input.captchaCode?.trim();
  if (!phone) return { success: false, message: "请输入手机号" };
  if (!captchaCode) return { success: false, message: "请输入图形验证码" };
  if (!input.captchaUuid) {
    return { success: false, message: "验证码已失效，请刷新后重试", needRefreshCaptcha: true };
  }

  try {
    const response = await axios.post(
      `${CAS_BASE_URL}/api/v1/sms/send`,
      { uuid: input.captchaUuid, code: captchaCode, type: "login", phone },
      { timeout: CAS_TIMEOUT, headers: { "Content-Type": "application/json" } },
    );
    const body = response.data as CasEnvelope<unknown>;
    if (body?.code === 200) return { success: true };
    const message = body?.msg || "短信发送失败";
    return { success: false, message, needRefreshCaptcha: /验证码|图形/i.test(message) };
  } catch (error) {
    return { success: false, message: resolveJiaowuErrorMessage(error, "短信发送失败") };
  }
}

/**
 * 用手机短信验证码登录教务系统。
 *
 * 走平台的 `loginByPhone`，返回的 payload 与密码登录同构，
 * 因此收尾（换 ticket → 回投教务 → 建 ASP 会话）复用 {@link completeServiceLogin}。
 */
export async function jiaowuLoginByPhone(
  input: JiaowuPhoneLoginInput,
): Promise<JiaowuCasLoginResult> {
  const phone = input.phone?.trim();
  const smsCode = input.smsCode?.trim();
  if (!phone || !smsCode) {
    return { success: false, message: "请输入手机号和短信验证码" };
  }

  let cookieFromEntry: string[] = [];
  try {
    try {
      const entry = await axios.get(CAS_SERVICE_URL, {
        maxRedirects: 0,
        timeout: CALLBACK_TIMEOUT,
        validateStatus: (status) => status >= 200 && status < 400,
        headers: buildCallbackHeaders(getCookie()),
      });
      cookieFromEntry = extractAspCookies(entry.headers);
    } catch {
      cookieFromEntry = [];
    }

    const response = await axios.post(
      `${CAS_BASE_URL}/api/v1/cas/loginByPhone`,
      { code: smsCode, phone, appid: CAS_APPID },
      {
        timeout: CAS_TIMEOUT,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
      },
    );

    const body = response.data as CasEnvelope<CasLoginPayload>;
    if (body?.code !== 200) {
      const message = body?.msg || "短信登录失败";
      return { success: false, message, needRefreshCaptcha: /验证码|过期/i.test(message) };
    }

    const payload = unwrapEnvelope<CasLoginPayload>(body);
    return completeServiceLogin(payload, cookieFromEntry);
  } catch (error) {
    return { success: false, message: resolveJiaowuErrorMessage(error, "短信登录异常") };
  }
}

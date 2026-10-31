/**
 * 教务请求错误辅助
 */

/** 教务网不可达（常见于超时）时的用户提示 */
export const JIAOWU_CAMPUS_NETWORK_HINT = "教务网迁入内网，可尝试连接校园网使用农屿";

/**
 * 教务会话已失效。
 *
 * 统一身份认证改造（2026-10-23）之后，重新登录必须由用户看一次图形验证码，
 * 拦截器因此**不再具备静默重登的能力**，只能把「会话过期」明确抛给上层，
 * 由界面引导用户重新输验证码登录。
 */
export class JiaowuSessionExpiredError extends Error {
  constructor(message = "教务会话已过期，请重新登录") {
    super(message);
    this.name = "JiaowuSessionExpiredError";
  }
}

/** 判断是否为「教务会话过期，需用户重新登录」 */
export function isJiaowuSessionExpiredError(error: unknown): error is JiaowuSessionExpiredError {
  if (error instanceof JiaowuSessionExpiredError) return true;
  if (!error || typeof error !== "object") return false;
  const err = error as { name?: unknown };
  return err.name === "JiaowuSessionExpiredError";
}

/**
 * 判断是否为请求超时类错误（含 axios ECONNABORTED）
 */
export function isJiaowuTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    const msg = String(error ?? "");
    return /timeout/i.test(msg);
  }

  const err = error as { code?: string; message?: string; cause?: unknown };
  if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT" || err.code === "ESOCKETTIMEDOUT") {
    return true;
  }
  if (typeof err.message === "string" && /timeout/i.test(err.message)) {
    return true;
  }
  if (err.cause) {
    return isJiaowuTimeoutError(err.cause);
  }
  return false;
}

/**
 * 从异常生成面向调用方的 message；超时时固定返回校园网提示
 */
export function resolveJiaowuErrorMessage(error: unknown, fallback = "请求失败"): string {
  if (isJiaowuTimeoutError(error)) {
    return JIAOWU_CAMPUS_NETWORK_HINT;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return fallback;
}

/**
 * 构造带 success/result/message 的失败返回（超时时附带校园网提示）
 */
export function jiaowuFailResult<T>(
  result: T,
  error: unknown,
): {
  success: false;
  result: T;
  message: string;
} {
  return {
    success: false,
    result,
    message: resolveJiaowuErrorMessage(error),
  };
}

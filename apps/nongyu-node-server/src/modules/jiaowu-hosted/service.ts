/**
 * 教务凭据托管与自动登录编排。
 *
 * 用户选择「账密自动登录」时才会走到这里：
 * 1. 开启托管：校验一次密码 → AES-256-GCM 加密入库；
 * 2. 取会话：解密密码 → OCR 过验证码 → CAS 登录 → 返回教务 ASP Cookie；
 * 3. 关闭托管：直接删行，不留副本。
 *
 * 关闭托管后，用户仍可用「账密 + 手输验证码」「手机验证码」「微信扫码」登录，
 * 那几条路完全不经过本模块。
 */

import { getEnv } from "../../config/env.js";
import { AppError, ErrorCodes } from "../../lib/errors.js";
import { autoLogin } from "./autoLogin.js";
import { decryptSecret, encryptSecret, parseCredentialKey } from "./cipher.js";
import { deleteCredential, findCredential, markLoginResult, upsertCredential } from "./repo.js";

/** 会话缓存：同一用户短时间内复用同一个 ASP Cookie，避免高频自动登录触发风控 */
const SESSION_TTL_MS = 10 * 60 * 1000;

type CachedSession = { cookie: string; at: number };
const sessionCache = new Map<number, CachedSession>();

export type HostedStatus = {
  /** 托管能力是否在服务端可用（未配置密钥则为 false） */
  available: boolean;
  /** 该用户是否已开启 */
  enabled: boolean;
  studentNo: string | null;
  lastLoginAt: string | null;
  lastError: string | null;
};

function requireKey(): Buffer {
  const key = parseCredentialKey(getEnv().JIAOWU_CREDENTIAL_KEY);
  if (!key) {
    throw new AppError(
      ErrorCodes.VALIDATION,
      "服务端未配置凭据密钥，无法开启免验证码自动登录",
      400,
    );
  }
  return key;
}

/** 查询托管状态；密钥未配置时 available=false，客户端应隐藏该入口 */
export async function getHostedStatus(userId: number): Promise<HostedStatus> {
  const available = parseCredentialKey(getEnv().JIAOWU_CREDENTIAL_KEY) !== null;
  const row = await findCredential(userId);
  if (!row) {
    return { available, enabled: false, studentNo: null, lastLoginAt: null, lastError: null };
  }
  return {
    available,
    enabled: row.enabled === 1,
    studentNo: row.student_no,
    lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
    lastError: row.last_error,
  };
}

/**
 * 开启（或更新）托管。
 *
 * 会立刻做一次真实自动登录来验证密码 —— 密码错就当场拒绝，
 * 免得用户过两天才发现「自动登录一直失败」。
 */
export async function enableHosted(
  userId: number,
  studentNo: string,
  password: string,
): Promise<{ cookie: string }> {
  const key = requireKey();

  const probe = await autoLogin({ studentNo, password });
  if (!probe.success) {
    const message = probe.ocrUnavailable
      ? "服务端验证码识别不可用，暂时无法开启（可继续用手输验证码登录）"
      : `密码校验失败：${probe.message}`;
    throw new AppError(ErrorCodes.VALIDATION, message, 400);
  }

  await upsertCredential({
    userId,
    studentNo,
    passwordCipher: encryptSecret(password, key),
  });
  await markLoginResult(userId, { ok: true });
  sessionCache.set(userId, { cookie: probe.cookie, at: Date.now() });

  return { cookie: probe.cookie };
}

/** 关闭托管：删行 + 清缓存 */
export async function disableHosted(userId: number): Promise<{ removed: boolean }> {
  sessionCache.delete(userId);
  const removed = await deleteCredential(userId);
  return { removed };
}

export type HostedLoginResult =
  | { success: true; cookie: string; cached: boolean }
  | { success: false; message: string; ocrUnavailable?: boolean; needsReauth?: boolean };

/**
 * 用托管凭据换一次教务会话。
 *
 * - 命中未过期的缓存直接返回（cached=true）
 * - 密码被改 / 密钥轮换导致解密失败 → needsReauth=true，客户端应引导重新开启或改用手动方式
 */
export async function loginWithHostedCredential(userId: number): Promise<HostedLoginResult> {
  const cached = sessionCache.get(userId);
  if (cached && Date.now() - cached.at < SESSION_TTL_MS) {
    return { success: true, cookie: cached.cookie, cached: true };
  }

  const key = parseCredentialKey(getEnv().JIAOWU_CREDENTIAL_KEY);
  if (!key) {
    return { success: false, message: "服务端未配置凭据密钥" };
  }

  const row = await findCredential(userId);
  if (!row || row.enabled !== 1) {
    return { success: false, message: "未开启免验证码自动登录", needsReauth: true };
  }

  let password: string;
  try {
    password = decryptSecret(row.password_cipher, key);
  } catch {
    // 密钥轮换或密文损坏：无法恢复，提示用户重新开启
    await markLoginResult(userId, { ok: false, error: "凭据解密失败，请重新开启" });
    return { success: false, message: "凭据已失效，请重新开启自动登录", needsReauth: true };
  }

  const result = await autoLogin({ studentNo: row.student_no, password });
  if (!result.success) {
    await markLoginResult(userId, { ok: false, error: result.message });
    return {
      success: false,
      message: result.message,
      ocrUnavailable: result.ocrUnavailable,
    };
  }

  sessionCache.set(userId, { cookie: result.cookie, at: Date.now() });
  await markLoginResult(userId, { ok: true });
  return { success: true, cookie: result.cookie, cached: false };
}

/** 会话被教务判定失效时主动踢掉缓存，下次调用会真正重登 */
export function invalidateHostedSession(userId: number): void {
  sessionCache.delete(userId);
}

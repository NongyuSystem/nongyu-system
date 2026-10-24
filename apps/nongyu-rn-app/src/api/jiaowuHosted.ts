/**
 * 教务托管登录（免验证码自动登录）接口。
 *
 * 只有用户在登录页主动开启后才会走到这里；关闭后回到手输验证码 / 短信 / 微信。
 */

import { appFetch } from "@/api/appClient";

export type JiaowuHostedStatus = {
  /** 服务端是否具备托管能力（未配置密钥则为 false，界面应隐藏入口） */
  available: boolean;
  enabled: boolean;
  studentNo: string | null;
  lastLoginAt: string | null;
  lastError: string | null;
};

export type JiaowuHostedLoginResult = {
  success: boolean;
  cookie?: string;
  cached?: boolean;
  message?: string;
  /** 识别器不可用：应回落手输验证码 */
  ocrUnavailable?: boolean;
  /** 凭据失效：应引导用户重新开启或改用手动方式 */
  needsReauth?: boolean;
};

/** 查询托管状态 */
export function getJiaowuHostedStatus(): Promise<JiaowuHostedStatus> {
  return appFetch<JiaowuHostedStatus>("/api/app/jiaowu/hosted");
}

/** 开启托管（服务端会立刻真登录一次校验密码，密码错会抛错） */
export function enableJiaowuHosted(
  studentNo: string,
  password: string,
): Promise<{ cookie: string }> {
  return appFetch<{ cookie: string }>("/api/app/jiaowu/hosted", {
    method: "POST",
    body: JSON.stringify({ studentNo, password }),
  });
}

/** 关闭托管（服务端删除凭据，不可恢复） */
export function disableJiaowuHosted(): Promise<{ removed: boolean }> {
  return appFetch<{ removed: boolean }>("/api/app/jiaowu/hosted", { method: "DELETE" });
}

/** 用托管凭据换一次教务会话 */
export function loginWithJiaowuHosted(): Promise<JiaowuHostedLoginResult> {
  return appFetch<JiaowuHostedLoginResult>("/api/app/jiaowu/hosted/login", { method: "POST" });
}

/** 教务会话失效时清掉服务端缓存，下次调用会真正重登 */
export function invalidateJiaowuHosted(): Promise<{ invalidated: boolean }> {
  return appFetch<{ invalidated: boolean }>("/api/app/jiaowu/hosted/invalidate", {
    method: "POST",
  });
}

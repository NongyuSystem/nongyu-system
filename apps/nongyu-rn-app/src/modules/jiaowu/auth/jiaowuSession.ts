import {
  clearLoginData,
  getCookie,
  getJiaowuCaptcha,
  jiaowuLogin,
  jiaowuLoginByCas,
  setCookie,
  setLoginData,
  type JiaowuCasLoginInput,
  type JiaowuCaptchaResult,
  type JiaowuCasLoginResult,
} from "nongyu-tool-jiaowu";
import { clearJiaowuAspCookie, getJiaowuAspCookie, setJiaowuAspCookie } from "@/storage/mmkv";

/**
 * 将学号密码写入工具内存 LOGIN_DATA
 *
 * @deprecated 统一身份认证改造后，工具不再用本地密码静默重登，
 * 这里保留只为「登出前清空」「界面预填」等场景。
 */
export function bridgeSetLoginData(studentId: string, password: string): void {
  setLoginData(studentId, password);
}

/**
 * 取一张统一身份认证的图形验证码。
 *
 * 返回的 `image` 是 data URI，可直接喂 `Image source={{ uri }}`；
 * 验证码必须由用户读图输入，不做 OCR。
 */
export function bridgeGetJiaowuCaptcha(): Promise<JiaowuCaptchaResult> {
  return getJiaowuCaptcha();
}

/**
 * 走统一身份认证完成教务登录；成功时把 ASP Cookie 备份到 MMKV。
 */
export async function bridgeJiaowuLoginByCas(
  input: JiaowuCasLoginInput,
): Promise<JiaowuCasLoginResult> {
  const result = await jiaowuLoginByCas(input);
  if (result.success && result.cookie) {
    setJiaowuAspCookie(result.cookie);
  }
  return result;
}

/**
 * 旧口令登录（`index.asp` + `check.asp`）。
 *
 * @deprecated 教务系统自 2026-10-23 起已取消首页账号密码登录，
 * 该路径随时会被彻底关闭。新代码请用 {@link bridgeJiaowuLoginByCas}。
 */
export async function bridgeJiaowuLogin(studentId?: string, password?: string) {
  const result = await jiaowuLogin(studentId, password);
  if (result.success && result.cookie) {
    setJiaowuAspCookie(result.cookie);
  }
  return result;
}

/**
 * 冷启动：从 MMKV 恢复 ASP Cookie 到工具内存
 */
export function restoreAspCookieFromStorage(): boolean {
  const cookie = getJiaowuAspCookie();
  if (!cookie) return false;
  setCookie(cookie);
  return true;
}

/**
 * 将当前工具内存 Cookie 同步到 MMKV
 */
export function persistCurrentAspCookie(): void {
  const cookie = getCookie();
  if (cookie) {
    setJiaowuAspCookie(cookie);
  }
}

/**
 * 清空工具侧登录态与本地 Cookie 备份
 */
export function clearJiaowuToolSession(): void {
  clearLoginData();
  clearJiaowuAspCookie();
}

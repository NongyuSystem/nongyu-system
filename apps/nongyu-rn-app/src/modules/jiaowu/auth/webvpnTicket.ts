import { requireOptionalNativeModule } from "expo";
import * as SecureStore from "expo-secure-store";
import { setJiaowuTransport } from "nongyu-tool-jiaowu";

type WebVpnCookieNative = {
  readTicket(): Promise<string | null>;
  writeTicket(value: string): Promise<void>;
  clearTicket(): Promise<void>;
};

/**
 * 当前平台没有打进原生模块时返回 null，不让登录页崩。
 */
function getWebVpnCookieNative(): WebVpnCookieNative | null {
  return requireOptionalNativeModule<WebVpnCookieNative>("NongyuWebVpnCookie");
}

/** SecureStore 不允许冒号 */
const TICKET_KEY = "webvpn_ticket";

/**
 * 登录成功后把 HttpOnly 票据从系统 Cookie 罐抄进 SecureStore。
 * 读不到就跳过，不把空值写成凭据。
 */
export async function captureWebVpnTicket(): Promise<void> {
  try {
    const native = getWebVpnCookieNative();
    if (!native) return;
    const value = await native.readTicket();
    if (!value) return;
    await SecureStore.setItemAsync(TICKET_KEY, value);
  } catch {
    // 读不到票据不打断登录；冷启动会要求重新登录
  }
}

/**
 * 冷启动把票据写回 Cookie 罐，并切到 WebVPN 传输。
 * 没有票据或当前平台没有原生模块时返回 false，保持直连。
 */
export async function restoreWebVpnTicket(): Promise<boolean> {
  try {
    const value = await SecureStore.getItemAsync(TICKET_KEY);
    if (!value) return false;
    const native = getWebVpnCookieNative();
    if (!native) return false;
    await native.writeTicket(value);
    setJiaowuTransport("webvpn");
    return true;
  } catch {
    return false;
  }
}

/**
 * 退出登录时清 SecureStore 和系统罐里的票据。
 */
export async function clearWebVpnTicket(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TICKET_KEY);
  } catch {
    // 没有旧票据时删除会抛，忽略
  }
  try {
    await getWebVpnCookieNative()?.clearTicket();
  } catch {
    // 原生模块缺失不得挡住登出
  }
  setJiaowuTransport("direct");
}

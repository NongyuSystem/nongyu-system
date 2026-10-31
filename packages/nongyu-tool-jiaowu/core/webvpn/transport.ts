/**
 * 教务传输模式。
 *
 * 直连是默认。只有登录页探测到教务不可达，或冷启动恢复了 WebVPN 票据时，才切到 webvpn。
 * 业务请求与 CAS 请求都走 {@link rewriteOutboundUrl}，避免漏改 service / Location。
 */

import { encodeWebVpnUrl } from "./encode";

export type JiaowuTransportMode = "direct" | "webvpn";

/** 需要编码的校内主机。其它主机（含已经是 webvpn 的地址）不动。 */
const REWRITE_HOSTS = new Set(["jiaowu.sicau.edu.cn", "auth.sicau.edu.cn"]);

let mode: JiaowuTransportMode = "direct";

/**
 * 当前传输模式
 */
export function getJiaowuTransport(): JiaowuTransportMode {
  return mode;
}

/**
 * 切换传输模式。直连时后续请求保持原 URL。
 */
export function setJiaowuTransport(next: JiaowuTransportMode): void {
  mode = next;
}

/**
 * 从绝对 URL 取出主机名。相对路径返回空串。
 */
function hostOf(url: string): string {
  const matched = /^https?:\/\/([^/?#]+)/i.exec(url);
  if (!matched?.[1]) return "";
  return matched[1].replace(/:\d+$/, "").toLowerCase();
}

/**
 * WebVPN 模式下改写校内绝对地址。直连模式原样返回。
 */
export function rewriteOutboundUrl(url: string): string {
  if (mode !== "webvpn" || !url) return url;
  const host = hostOf(url);
  if (!REWRITE_HOSTS.has(host)) return url;
  return encodeWebVpnUrl(url);
}

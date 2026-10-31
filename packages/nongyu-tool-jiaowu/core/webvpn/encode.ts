/**
 * 川农 WebVPN（网瑞达 wengine）主机名编码。
 *
 * 只加密 host。path 与 query 保持明文。缺 key 的 hex 前缀时网关会 302 到登录页。
 * 算法与 `docs/nongyu-rn-app/tech/WebVPN探索.md` 的 openssl 对照一致。
 */

import CryptoJS from "crypto-js";

/** 网关根地址 */
export const WEBVPN_ORIGIN = "https://webvpn.sicau.edu.cn";

/** key = iv，16 字节 */
export const WEBVPN_KEY = "wrdvpnisthebest!";

/** key 的 ASCII hex，路径段固定前缀 */
export const WEBVPN_KEY_HEX = "77726476706e69737468656265737421";

const BLOCK = 16;

/**
 * 主机名与 key 都是 ASCII，避免依赖 RN 不一定有的 TextEncoder
 */
function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    out[index] = text.charCodeAt(index) & 0xff;
  }
  return out;
}

/**
 * 把 WordArray 按 sigBytes 还原成字节（不用 Node Buffer，RN 也能跑）
 */
function wordArrayToBytes(value: CryptoJS.lib.WordArray): Uint8Array {
  const out = new Uint8Array(value.sigBytes);
  for (let index = 0; index < value.sigBytes; index += 1) {
    const word = value.words[index >>> 2] ?? 0;
    out[index] = (word >>> (24 - (index % 4) * 8)) & 0xff;
  }
  return out;
}

/**
 * 字节转 WordArray
 */
function bytesToWordArray(bytes: Uint8Array): CryptoJS.lib.WordArray {
  const words: number[] = [];
  for (let index = 0; index < bytes.length; index += 4) {
    words.push(
      ((bytes[index] ?? 0) << 24) |
        ((bytes[index + 1] ?? 0) << 16) |
        ((bytes[index + 2] ?? 0) << 8) |
        (bytes[index + 3] ?? 0),
    );
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
}

/**
 * AES-128 加密单个 16 字节块（ECB，无填充），供 CFB-128 产生密钥流
 */
function aesEncryptBlock(block: Uint8Array, key: CryptoJS.lib.WordArray): Uint8Array {
  const encrypted = CryptoJS.AES.encrypt(bytesToWordArray(block), key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.NoPadding,
  });
  return wordArrayToBytes(encrypted.ciphertext);
}

/**
 * AES-128-CFB，segment_size = 128。明文长度须为 16 的倍数。
 */
export function aesCfb128Encrypt(plain: Uint8Array, keyText: string, ivText: string): Uint8Array {
  if (plain.length % BLOCK !== 0) {
    throw new Error("CFB-128 明文必须按 16 字节对齐");
  }
  const key = CryptoJS.enc.Utf8.parse(keyText);
  let feedback = asciiBytes(ivText);
  const out = new Uint8Array(plain.length);
  for (let offset = 0; offset < plain.length; offset += BLOCK) {
    const keystream = aesEncryptBlock(feedback, key);
    const cipherBlock = new Uint8Array(BLOCK);
    for (let index = 0; index < BLOCK; index += 1) {
      cipherBlock[index] = (plain[offset + index] ?? 0) ^ (keystream[index] ?? 0);
      out[offset + index] = cipherBlock[index] ?? 0;
    }
    feedback = cipherBlock;
  }
  return out;
}

/**
 * 字节转小写 hex
 */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * 主机名路径段：key hex + 截断后的主机密文 hex
 */
export function encodeVpnHost(host: string): string {
  const paddedLength = Math.ceil(host.length / BLOCK) * BLOCK;
  const padded = new Uint8Array(paddedLength);
  const raw = asciiBytes(host);
  padded.set(raw);
  for (let index = raw.length; index < paddedLength; index += 1) {
    padded[index] = 0x30;
  }
  const cipher = aesCfb128Encrypt(padded, WEBVPN_KEY, WEBVPN_KEY);
  return WEBVPN_KEY_HEX + toHex(cipher.slice(0, raw.length));
}

/**
 * 把 http(s) 绝对地址改写成 WebVPN 路径。非 http(s) 原样返回。
 */
export function encodeWebVpnUrl(rawUrl: string): string {
  const matched = /^(https?):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i.exec(rawUrl);
  if (!matched) return rawUrl;
  const scheme = matched[1]?.toLowerCase() ?? "https";
  const hostPort = matched[2] ?? "";
  const path = matched[3] && matched[3].length > 0 ? matched[3] : "/";
  const query = matched[4] ?? "";
  const host = hostPort.replace(/:\d+$/, "");
  if (host === "webvpn.sicau.edu.cn") return rawUrl;
  return `${WEBVPN_ORIGIN}/${scheme}/${encodeVpnHost(host)}${path}${query}`;
}

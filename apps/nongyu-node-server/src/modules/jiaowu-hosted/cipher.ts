/**
 * 教务凭据的对称加密。
 *
 * 为什么不用 bcrypt：这里需要**还原明文**去登录教务，bcrypt 是单向哈希，做不到。
 * 用 AES-256-GCM（带认证标签）：既保密又防篡改，密钥只放环境变量、不进库、不进日志。
 *
 * 密文格式：`v1.iv.tag.cipher`（各段 base64），带版本号便于日后轮换算法。
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM 推荐 96 位
const KEY_BYTES = 32; // AES-256

/**
 * 解析环境变量里的密钥。
 *
 * 接受 64 位 hex 或 base64（解出来必须是 32 字节）。为空则返回 null —— 表示托管能力关闭。
 */
export function parseCredentialKey(raw: string | undefined | null): Buffer | null {
  const value = raw?.trim();
  if (!value) return null;

  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    key = Buffer.from(value, "hex");
  } else {
    key = Buffer.from(value, "base64");
  }

  if (key.length !== KEY_BYTES) return null;
  return key;
}

/** 加密明文（如教务密码），返回可直接入库的字符串 */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

/** 解密；密文被篡改或版本不符时抛错，由调用方降级为「要求用户重新登录」 */
export function decryptSecret(payload: string, key: Buffer): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("凭据密文格式不支持");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  if (iv.length !== IV_BYTES || tag.length !== 16) {
    throw new Error("凭据密文格式不支持");
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return plain.toString("utf8");
}

/** 常量时间比较两个字符串（防时序侧信道，用于密钥/口令比对场景） */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

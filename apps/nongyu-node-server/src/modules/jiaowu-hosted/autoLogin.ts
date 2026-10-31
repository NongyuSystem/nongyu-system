/**
 * 教务自动登录：图形验证码交给 OCR，失败自动换图重试。
 *
 * 这是「服务端代管凭据 → 自动换票」的核心。用户只需提供一次学号密码，
 * 之后服务端可自行完成整个 CAS 登录拿到教务会话，不需要用户再读验证码。
 *
 * 链路复用 `nongyu-tool-jiaowu` 里已验证的实现（该校验与客户端完全一致）：
 * 取图 → OCR → `POST /api/v1/cas/login` → 回投 `caslogin.asp`（含两跳重定向）→ ASPSESSIONID。
 *
 * OCR 单次准确率实测约 83%（同批 6 张样本 5 张正确），
 * 因此默认重试 5 次：1 - 0.17^5 ≈ 99.99%。每次重试都会换一张新图。
 */

import { getJiaowuCaptcha, jiaowuLoginByCas } from "nongyu-tool-jiaowu";
import { createLogger, type Logger } from "../../lib/logger.js";

/** 同 ocr/client：logger 惰性化，避免脱离服务环境时因 env 校验失败 */
let cachedLogger: Logger | null = null;
let loggerResolved = false;
function log(): Logger | null {
  if (!loggerResolved) {
    loggerResolved = true;
    try {
      cachedLogger = createLogger();
    } catch {
      cachedLogger = null;
    }
  }
  return cachedLogger;
}
import { recognizeCaptcha } from "./ocr/client.js";

/** 默认重试次数：验证码一次性，失败必须换图重来 */
const DEFAULT_MAX_ATTEMPTS = 5;

export type AutoLoginInput = {
  studentNo: string;
  password: string;
  maxAttempts?: number;
};

export type AutoLoginSuccess = {
  success: true;
  /** 教务系统 ASP 会话 Cookie（`ASPSESSIONID*`） */
  cookie: string;
  /** 实际用掉的尝试次数，便于观测 OCR 命中率 */
  attempts: number;
};

export type AutoLoginFailure = {
  success: false;
  message: string;
  attempts: number;
  /**
   * 识别器不可用（目标机没装 Python/ddddocr）。
   * 上层据此降级为「让用户在客户端手输验证码」，而不是直接报登录失败。
   */
  ocrUnavailable?: boolean;
};

export type AutoLoginResult = AutoLoginSuccess | AutoLoginFailure;

/**
 * 自动登录教务系统。
 *
 * @example
 * ```ts
 * const r = await autoLogin({ studentNo: "20210001", password: "******" });
 * if (r.success) setCookie(r.cookie);
 * else if (r.ocrUnavailable) 走手动验证码流程();
 * ```
 */
export async function autoLogin(input: AutoLoginInput): Promise<AutoLoginResult> {
  const studentNo = input.studentNo?.trim();
  const password = input.password ?? "";
  const maxAttempts = Math.min(Math.max(input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 1), 10);

  if (!studentNo || !password) {
    return { success: false, message: "缺少学号或密码", attempts: 0 };
  }

  let lastMessage = "自动登录失败";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const captcha = await getJiaowuCaptcha();
    if (!captcha.success) {
      lastMessage = captcha.message;
      log()?.warn({ attempt, message: captcha.message }, "jiaowu-auto-login: 取验证码失败");
      continue;
    }

    const imageBase64 = captcha.result.image.split(",")[1] ?? "";
    const code = await recognizeCaptcha(imageBase64);
    if (!code) {
      // 识别器不可用与「这张图没认出来」要分开处理：
      // 前者应立刻降级，后者换图重试即可。
      return {
        success: false,
        message: "验证码识别服务不可用",
        attempts: attempt,
        ocrUnavailable: true,
      };
    }

    const result = await jiaowuLoginByCas({
      studentId: studentNo,
      password,
      captchaCode: code,
      captchaUuid: captcha.result.uuid,
    });

    if (result.success) {
      log()?.info({ attempt }, "jiaowu-auto-login: 登录成功");
      return { success: true, cookie: result.cookie, attempts: attempt };
    }

    lastMessage = result.message;
    log()?.info(
      { attempt, code, message: result.message },
      "jiaowu-auto-login: 本次失败，换图重试",
    );
  }

  return { success: false, message: lastMessage, attempts: maxAttempts };
}

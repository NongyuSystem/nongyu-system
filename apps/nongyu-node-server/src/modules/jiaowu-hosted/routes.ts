/**
 * 教务托管登录路由（App 端，需登录态）。
 *
 * 这些接口只服务「用户主动开启免验证码自动登录」的场景；
 * 关闭后客户端应回到手输验证码 / 手机验证码 / 微信扫码。
 */

import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middlewares/common.js";
import { requireAppAuth } from "../../middlewares/auth.js";
import { loginRateLimit } from "../../middlewares/rateLimit.js";
import { ok } from "../../lib/response.js";
import {
  disableHosted,
  enableHosted,
  getHostedStatus,
  invalidateHostedSession,
  loginWithHostedCredential,
} from "./service.js";

export const appJiaowuHostedRouter = Router();

const studentNoSchema = z.string().regex(/^\d{9}$/, "学号需为 9 位数字");
const passwordSchema = z.string().min(1, "请输入教务密码").max(128);

const enableSchema = z.object({
  studentNo: studentNoSchema,
  password: passwordSchema,
});

/** 查询托管状态：available=false 时客户端应隐藏「免验证码自动登录」入口 */
appJiaowuHostedRouter.get(
  "/hosted",
  requireAppAuth,
  asyncHandler(async (req, res) => {
    const data = await getHostedStatus(req.appAuth!.uid);
    ok(res, data);
  }),
);

/** 开启托管：会立刻真实登录一次验证密码，密码错直接 400 */
appJiaowuHostedRouter.post(
  "/hosted",
  requireAppAuth,
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const body = enableSchema.parse(req.body);
    const data = await enableHosted(req.appAuth!.uid, body.studentNo, body.password);
    // 只回 cookie，绝不回 password_cipher 或明文
    ok(res, data);
  }),
);

/** 关闭托管：删除凭据，不可恢复 */
appJiaowuHostedRouter.delete(
  "/hosted",
  requireAppAuth,
  asyncHandler(async (req, res) => {
    const data = await disableHosted(req.appAuth!.uid);
    ok(res, data);
  }),
);

/** 用托管凭据换一次教务会话（命中缓存则直接返回） */
appJiaowuHostedRouter.post(
  "/hosted/login",
  requireAppAuth,
  loginRateLimit,
  asyncHandler(async (req, res) => {
    const data = await loginWithHostedCredential(req.appAuth!.uid);
    ok(res, data);
  }),
);

/** 教务判定会话失效时调用，让下一次 /hosted/login 真正重登 */
appJiaowuHostedRouter.post(
  "/hosted/invalidate",
  requireAppAuth,
  asyncHandler(async (req, res) => {
    invalidateHostedSession(req.appAuth!.uid);
    ok(res, { invalidated: true });
  }),
);

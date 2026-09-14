import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ErrorCodes, isAppError } from "../lib/errors.js";
import { fail } from "../lib/response.js";
import { createLogger } from "../lib/logger.js";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const message = err.issues[0]?.message ?? "参数校验失败";
    return fail(res, 400, ErrorCodes.VALIDATION, message);
  }
  if (isAppError(err)) {
    return fail(res, err.httpStatus, err.code, err.message, err.data);
  }
  try {
    createLogger().error(
      {
        err,
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        query: req.query,
        // 用户 ID 仅在 appAuth 已解析时存在
        userId: (req as { appAuth?: { uid?: number } }).appAuth?.uid,
      },
      "unhandled error",
    );
  } catch {
    console.error(err);
  }
  return fail(res, 500, ErrorCodes.INTERNAL, "服务器内部错误");
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers["x-request-id"] as string) || crypto.randomUUID();
  req.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}

import express from "express";
import cors from "cors";
import { buildCorsOptions, warnUnsafeCorsInProduction } from "./config/cors.js";
import { getEnv } from "./config/env.js";
import { getPool } from "./lib/db.js";
import { errorHandler, requestIdMiddleware } from "./middlewares/common.js";
import { ok } from "./lib/response.js";
import { asyncHandler } from "./middlewares/common.js";
import { adminAuthRouter, appAuthRouter } from "./modules/auth/routes.js";
import { appJiaowuHostedRouter } from "./modules/jiaowu-hosted/routes.js";
import { adminUsersRouter, appUsersRouter } from "./modules/users/routes.js";
import { appSettingsRouter } from "./modules/settings/routes.js";
import { appCourseExtRouter } from "./modules/course-ext/routes.js";
import { appCourseShareRouter } from "./modules/course-share/routes.js";
import {
  adminPostsRouter,
  appMyPostsRouter,
  appMyPostRepliesRouter,
  appPostsRouter,
} from "./modules/posts/routes.js";
import { adminVersionsRouter, appVersionsRouter } from "./modules/versions/routes.js";
import { adminDashboardRouter } from "./modules/dashboard/routes.js";
import { adminTrackRouter } from "./modules/track/routes.js";
import {
  adminTrackSampleRateRouter,
  appTrackSampleRateRouter,
} from "./modules/runtime-config/routes.js";
import { internalUsersRouter } from "./modules/users/internalRoutes.js";
import { adminLlmKeysRouter } from "./modules/llm-pool/routes.admin.js";
import { adminLlmChatRouter } from "./modules/llm-pool/routes.admin-proxy.js";
import { appLlmRouter } from "./modules/llm-pool/routes.app.js";
import { adminHomeGreetingsRouter, appHomeGreetingRouter } from "./modules/home-greeting/routes.js";
import {
  adminAgentChatSuggestionsRouter,
  appAgentChatSuggestionsRouter,
} from "./modules/agent-chat-suggestion/routes.js";
import { requireAppAuth } from "./middlewares/auth.js";

export function createApp() {
  const env = getEnv();
  const app = express();

  app.use(requestIdMiddleware);
  warnUnsafeCorsInProduction(env);
  app.use(cors(buildCorsOptions(env)));
  app.use(express.json({ limit: "2mb" }));

  app.get(
    "/health",
    asyncHandler(async (_req, res) => {
      let db: "up" | "down" = "down";
      try {
        await getPool().query("SELECT 1");
        db = "up";
      } catch {
        db = "down";
      }
      ok(res, { status: "ok", db });
    }),
  );

  app.use("/api/app/auth", appAuthRouter);
  app.use("/api/app/jiaowu", appJiaowuHostedRouter);
  app.use("/api/app/users/me/posts", appMyPostsRouter);
  app.use("/api/app/users/me/post-replies", appMyPostRepliesRouter);
  app.use("/api/app/users", appUsersRouter);
  app.use("/api/app/settings", appSettingsRouter);
  app.use("/api/app/course-ext", appCourseExtRouter);
  app.use("/api/app/course-share", appCourseShareRouter);
  app.use("/api/app/posts", appPostsRouter);
  app.use("/api/app/versions", appVersionsRouter);
  app.use("/api/app/home/greeting", appHomeGreetingRouter);
  app.use("/api/app/agent/chat-suggestions", appAgentChatSuggestionsRouter);
  app.use("/api/app/track/sample-rate", appTrackSampleRateRouter);
  app.use("/api/app/llm/v1", requireAppAuth, appLlmRouter);

  app.use("/api/admin/auth", adminAuthRouter);
  app.use("/api/admin/users", adminUsersRouter);
  app.use("/api/admin/posts", adminPostsRouter);
  app.use("/api/admin/app-versions", adminVersionsRouter);
  app.use("/api/admin/dashboard/track-sample-rate", adminTrackSampleRateRouter);
  app.use("/api/admin/dashboard", adminDashboardRouter);
  app.use("/api/admin/track", adminTrackRouter);
  app.use("/api/admin/llm/v1", adminLlmChatRouter);
  app.use("/api/admin/llm/keys", adminLlmKeysRouter);
  app.use("/api/admin/home-greetings", adminHomeGreetingsRouter);
  app.use("/api/admin/agent-chat-suggestions", adminAgentChatSuggestionsRouter);
  app.use("/api/internal/users", internalUsersRouter);

  app.use(errorHandler);
  return app;
}

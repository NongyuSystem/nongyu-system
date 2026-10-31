import { toast } from "@/components/ui/toast";
import { clearAgentConfig } from "@/storage/agentConfig";
import { clearCredentials } from "@/storage/secureCredentials";
import { clearAiTipMuted, clearSessionSnapshot } from "@/storage/mmkv";
import { useSessionStore } from "@/stores/session";
import { clearJiaowuToolSession } from "@/modules/jiaowu/auth/jiaowuSession";
import { clearWebVpnTicket } from "@/modules/jiaowu/auth/webvpnTicket";
import { clearSecondToolSession } from "@/modules/second/auth/secondSession";
import { refreshSecondAuthFlag } from "@/modules/second/hooks/useSecondAuth";
import { APP_AUTH_ERROR_CODES } from "@/api/appApiError";
import { clearAgentChatSessions } from "@/agent/session";
import { clearLocalCourses } from "@/modules/course/data/courseLocalStore";
import { clearLocalCourseExt } from "@/modules/course/data/courseExtRepository";
import { clearPersistedCourseBackground } from "@/modules/course/data/courseBackground";
import { useCourseUiStore } from "@/modules/course/store/courseUiStore";
import { clearWidgetSchedule } from "@/modules/course/widget/writeWidgetSchedule";

let lastToastAt = 0;
const TOAST_DEDUP_MS = 2500;

/**
 * 仅清本地会话（不过 Node logout），用于票已过期/作废场景。
 * invalidateNongyuAgent 用动态 import，避免 appClient → handleAuthInvalid → agent → tools → appClient 环。
 */
export async function clearLocalAuthSession(): Promise<void> {
  const studentId = useSessionStore.getState().profile?.studentId;
  if (studentId) {
    clearLocalCourses(studentId);
    clearLocalCourseExt(studentId);
    clearAgentChatSessions(studentId);
  }
  await clearPersistedCourseBackground();
  useCourseUiStore.getState().setBackgroundUri(null);
  await clearCredentials();
  await clearAgentConfig();
  const { invalidateNongyuAgent } = await import("@/agent/agent");
  invalidateNongyuAgent();
  clearJiaowuToolSession();
  await clearWebVpnTicket();
  clearSecondToolSession();
  refreshSecondAuthFlag();
  clearSessionSnapshot();
  clearAiTipMuted();
  useSessionStore.getState().clearSession();
  await clearWidgetSchedule();
}

/**
 * Token 过期或作废：完整本地登出 + Toast（短时去重）
 */
export async function handleAuthInvalid(code: number): Promise<void> {
  await clearLocalAuthSession();

  const now = Date.now();
  if (now - lastToastAt < TOAST_DEDUP_MS) return;
  lastToastAt = now;

  if (code === APP_AUTH_ERROR_CODES.TOKEN_EXPIRED) {
    toast.info("登录已过期，请重新登录");
  } else {
    toast.info("登录状态已失效，请重新登录");
  }
}

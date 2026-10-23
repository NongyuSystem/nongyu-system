import { QueryClient } from "@tanstack/react-query";
import { getPersonalInfo } from "nongyu-tool-jiaowu";
import { toast } from "@/components/ui/toast";
import { appAuthLogin, appAuthLogout } from "@/api/appAuth";
import { parseAppUserRole } from "@/api/parseAppUserRole";
import { clearAgentConfig } from "@/storage/agentConfig";
import { clearCredentials, saveCredentials } from "@/storage/secureCredentials";
import { clearSessionSnapshot, clearAiTipMuted, saveSessionSnapshot } from "@/storage/mmkv";
import { trackClick, shutdownForLogout } from "@/modules/telemetry";
import { loadCourses } from "@/modules/course/data/courseRepository";
import { clearLocalCourses } from "@/modules/course/data/courseLocalStore";
import { clearLocalCourseExt } from "@/modules/course/data/courseExtRepository";
import { clearPersistedCourseBackground } from "@/modules/course/data/courseBackground";
import { useCourseUiStore } from "@/modules/course/store/courseUiStore";
import { clearWidgetSchedule } from "@/modules/course/widget/writeWidgetSchedule";
import { useSessionStore } from "@/stores/session";
import { personalInfoToSessionProfile } from "@/modules/jiaowu/auth/personalInfoMap";
import { invalidateNongyuAgent } from "@/agent/agent";
import { clearAgentChatSessions } from "@/agent/session";
import {
  bridgeJiaowuLoginByCas,
  bridgeSetLoginData,
  clearJiaowuToolSession,
  persistCurrentAspCookie,
} from "./jiaowuSession";
import { clearSecondToolSession } from "@/modules/second/auth/secondSession";
import { refreshSecondAuthFlag } from "@/modules/second/hooks/useSecondAuth";

export type PerformJiaowuLoginInput = {
  studentId: string;
  password: string;
  /** 用户看图输入的图形验证码 */
  captchaCode: string;
  /** 与验证码配套的 uuid（取图时获得） */
  captchaUuid: string;
  queryClient?: QueryClient;
};

export type PerformJiaowuLoginResult = {
  ok: boolean;
  message?: string;
  /** Node 登录是否成功（失败不影响本地教务会话） */
  nodeOk: boolean;
  /** 是否需要立刻换一张验证码（验证码错误/过期时置位） */
  needRefreshCaptcha?: boolean;
};

/**
 * 完整登录流程：统一身份认证校验 → 档案 →（best-effort）Node → 持久化
 *
 * 教务系统自 2026-10-23 起取消首页账号密码登录，只能走统一身份认证；
 * 每次登录都必须带一次用户输入的图形验证码，因此本流程无法在后台静默完成。
 */
export async function performJiaowuLogin(
  input: PerformJiaowuLoginInput,
): Promise<PerformJiaowuLoginResult> {
  const { studentId, password, captchaCode, captchaUuid, queryClient } = input;
  const trimmedId = studentId.trim();
  const trimmedPwd = password.trim();
  const trimmedCode = captchaCode.trim();

  if (!trimmedId || !trimmedPwd) {
    return { ok: false, message: "请输入学号和密码", nodeOk: false };
  }
  if (!trimmedCode) {
    return { ok: false, message: "请输入图形验证码", nodeOk: false };
  }

  const loginResult = await bridgeJiaowuLoginByCas({
    studentId: trimmedId,
    password: trimmedPwd,
    captchaCode: trimmedCode,
    captchaUuid,
  });
  if (!loginResult.success) {
    return {
      ok: false,
      message: loginResult.message || "教务登录失败",
      nodeOk: false,
      needRefreshCaptcha: loginResult.needRefreshCaptcha,
    };
  }

  const personal = await getPersonalInfo();
  if (!personal.success || !personal.result) {
    return {
      ok: false,
      message:
        ("message" in personal && typeof personal.message === "string" && personal.message) ||
        "获取个人档案失败，请稍后重试",
      nodeOk: false,
    };
  }

  const info = personal.result;
  const profile = personalInfoToSessionProfile(info, trimmedId);

  if (!profile.name) {
    return {
      ok: false,
      message: "档案缺少姓名，无法完成登录",
      nodeOk: false,
    };
  }

  // Node 登录：失败仍可进入教务本地会话，但需提示具体原因便于联调
  let token: string | null = null;
  let role: 0 | 1 | 2 | null = null;
  let nodeOk = false;
  try {
    const auth = await appAuthLogin({
      studentNo: profile.studentId,
      name: profile.name,
      major: profile.major,
      college: profile.college,
      className: profile.className,
      grade: profile.grade,
      gender: profile.gender,
      hometown: profile.hometown,
      campus: profile.campus,
    });
    token = auth.token;
    role = parseAppUserRole(auth.user);
    nodeOk = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "农屿服务未接通";
    toast.info("农屿 Token 未签发", {
      description: `${message}（本地教务会话仍可用）`,
    });
  }

  await saveCredentials(trimmedId, trimmedPwd);
  bridgeSetLoginData(trimmedId, trimmedPwd);
  persistCurrentAspCookie();
  saveSessionSnapshot(JSON.stringify(profile), token, role);

  useSessionStore.getState().setSession({ profile, token, role });

  if (queryClient) {
    await queryClient.invalidateQueries({ queryKey: ["jiaowu"] });
    // 预热课表 Query：有本地则只读本地，无本地才打教务并落盘
    void queryClient.prefetchQuery({
      queryKey: ["jiaowu", "course", profile.studentId],
      staleTime: Number.POSITIVE_INFINITY,
      queryFn: async () => {
        const res = await loadCourses(profile.studentId);
        if (!res.success) {
          throw new Error(res.message || "课表获取失败");
        }
        return res.courses;
      },
    });
  }

  return { ok: true, nodeOk };
}

/**
 * 登出：清凭据、Cookie、会话与教务 Query 缓存。
 * 用户可见清单见 `logoutClearSummary.ts`，改清理项时请同步更新。
 */
export async function performJiaowuLogout(queryClient?: QueryClient): Promise<void> {
  const token = useSessionStore.getState().token;
  const studentId = useSessionStore.getState().profile?.studentId;
  if (token) {
    try {
      trackClick("logout");
      await shutdownForLogout();
    } catch {
      // 埋点失败不得挡住登出
    }
    try {
      await appAuthLogout(token);
    } catch {
      // 网络失败仍清本地，避免卡在脏会话
    }
  }

  if (studentId) {
    clearLocalCourses(studentId);
    clearLocalCourseExt(studentId);
    clearAgentChatSessions(studentId);
  }

  await clearPersistedCourseBackground();
  useCourseUiStore.getState().setBackgroundUri(null);

  await clearCredentials();
  await clearAgentConfig();
  invalidateNongyuAgent();
  clearJiaowuToolSession();
  clearSecondToolSession();
  refreshSecondAuthFlag();
  clearSessionSnapshot();
  clearAiTipMuted();
  useSessionStore.getState().clearSession();
  await clearWidgetSchedule();
  if (queryClient) {
    queryClient.removeQueries({ queryKey: ["jiaowu"] });
    queryClient.removeQueries({ queryKey: ["second"] });
    queryClient.removeQueries({ queryKey: ["course-ext"] });
  }
}

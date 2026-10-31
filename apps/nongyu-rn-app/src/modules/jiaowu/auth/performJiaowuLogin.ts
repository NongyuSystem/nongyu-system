import { QueryClient } from "@tanstack/react-query";
import { getPersonalInfo, setCookie } from "nongyu-tool-jiaowu";
import { toast } from "@/components/ui/toast";
import { appAuthLogin, appAuthLogout } from "@/api/appAuth";
import { enableJiaowuHosted, loginWithJiaowuHosted } from "@/api/jiaowuHosted";
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
  bridgeLoginWebVpnPortal,
  bridgeJiaowuLoginByPhone,
  bridgeSetLoginData,
  clearJiaowuToolSession,
  persistCurrentAspCookie,
} from "./jiaowuSession";
import { captureWebVpnTicket, clearWebVpnTicket } from "@/modules/jiaowu/auth/webvpnTicket";
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
  /** WebVPN 门户已登录，但教务会话还要再输一次验证码 */
  needJiaowuCaptcha?: boolean;
  /** 托管凭据失效，需要用户重新开启或改用手动方式 */
  needsReauth?: boolean;
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

  await captureWebVpnTicket();
  return finalizeJiaowuLogin({ studentId: trimmedId, password: trimmedPwd, queryClient });
}

/**
 * 校外先登 WebVPN 门户。门户成功且教务会话已建立时直接收尾；
 * 否则让界面再要一张教务验证码，第二次走 {@link performJiaowuLogin}。
 */
export async function performWebVpnPortalLogin(
  input: PerformJiaowuLoginInput,
): Promise<PerformJiaowuLoginResult> {
  const { studentId, password, captchaCode, captchaUuid, queryClient } = input;
  const trimmedId = studentId.trim();
  const trimmedPwd = password.trim();
  const portal = await bridgeLoginWebVpnPortal({
    studentId: trimmedId,
    password: trimmedPwd,
    captchaCode: captchaCode.trim(),
    captchaUuid,
  });
  if (!portal.success) {
    return {
      ok: false,
      message: portal.message,
      nodeOk: false,
      needRefreshCaptcha: portal.needRefreshCaptcha,
    };
  }
  await captureWebVpnTicket();
  if (portal.needJiaowuCaptcha) {
    return {
      ok: false,
      message: "WebVPN 已登录，请再输入教务验证码",
      nodeOk: false,
      needJiaowuCaptcha: true,
    };
  }
  return finalizeJiaowuLogin({ studentId: trimmedId, password: trimmedPwd, queryClient });
}

/**
 * 登录收尾：拿档案 → 农场屿 Token → 持久化 → 预热课表。
 *
 * 密码 / 验证码 / 短信 / 托管四条路径最终都汇到这里，避免行为分叉。
 */
async function finalizeJiaowuLogin(input: {
  studentId: string;
  password: string;
  queryClient?: QueryClient;
}): Promise<PerformJiaowuLoginResult> {
  const { studentId, password, queryClient } = input;
  const trimmedId = studentId;
  const trimmedPwd = password;

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

export type PerformPhoneLoginInput = {
  phone: string;
  smsCode: string;
  /** 学号仅用于档案展示与本地持久化；短信登录本身只认手机号 */
  studentId: string;
  queryClient?: QueryClient;
};

/**
 * 短信验证码登录：手机号 + 短信码换教务会话，再用档案补学号。
 *
 * 这条路径不经过服务端保存密码，适合不愿开托管、也不想每次看图形码的用户。
 */
export async function performPhoneJiaowuLogin(
  input: PerformPhoneLoginInput,
): Promise<PerformJiaowuLoginResult> {
  const { phone, smsCode, studentId, queryClient } = input;
  if (!phone.trim() || !smsCode.trim()) {
    return { ok: false, message: "请输入手机号和短信验证码", nodeOk: false };
  }

  const loginResult = await bridgeJiaowuLoginByPhone({ phone, smsCode });
  if (!loginResult.success) {
    return {
      ok: false,
      message: loginResult.message || "短信登录失败",
      nodeOk: false,
      needRefreshCaptcha: loginResult.needRefreshCaptcha,
    };
  }

  return finalizeJiaowuLogin({
    studentId: studentId.trim(),
    // 短信登录拿不到密码，本地不保存密码即可（saveCredentials 只存学号+密码，这里传空）
    password: "",
    queryClient,
  });
}

export type PerformHostedLoginInput = {
  studentNo: string;
  password: string;
  /** true = 首次开启托管（服务端校验密码后加密保存）；false = 已开启，直接换会话 */
  enableHosted: boolean;
  queryClient?: QueryClient;
};

/**
 * 托管登录：由服务端用加密保存的密码 + OCR 过验证码，换回教务会话。
 *
 * 用户侧不需要看验证码；失败时按 `ocrUnavailable` / `needsReauth`
 * 分别回落「手输验证码」或「重新开启托管」。
 */
export async function performHostedJiaowuLogin(
  input: PerformHostedLoginInput,
): Promise<PerformJiaowuLoginResult> {
  const { studentNo, password, enableHosted, queryClient } = input;
  const trimmedId = studentNo.trim();
  const trimmedPwd = password.trim();

  if (!trimmedId || !trimmedPwd) {
    return { ok: false, message: "请输入学号和密码", nodeOk: false };
  }

  try {
    let cookie: string;
    if (enableHosted) {
      const res = await enableJiaowuHosted(trimmedId, trimmedPwd);
      cookie = res.cookie;
    } else {
      const res = await loginWithJiaowuHosted();
      if (!res.success || !res.cookie) {
        return {
          ok: false,
          message: res.message || "自动登录失败",
          nodeOk: false,
          needRefreshCaptcha: res.ocrUnavailable === true,
          needsReauth: res.needsReauth === true,
        };
      }
      cookie = res.cookie;
    }
    if (!cookie) {
      return { ok: false, message: "服务端未返回教务会话", nodeOk: false };
    }
    setCookie(cookie);
  } catch (err) {
    const message = err instanceof Error ? err.message : "自动登录失败";
    return { ok: false, message, nodeOk: false };
  }

  return finalizeJiaowuLogin({ studentId: trimmedId, password: trimmedPwd, queryClient });
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
  await clearWebVpnTicket();
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

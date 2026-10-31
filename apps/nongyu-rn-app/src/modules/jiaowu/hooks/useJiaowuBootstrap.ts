import { useEffect } from "react";
import { loadCredentials } from "@/storage/secureCredentials";
import { loadSessionSnapshot } from "@/storage/mmkv";
import { useSessionStore, type SessionProfile } from "@/stores/session";
import {
  bridgeSetLoginData,
  restoreAspCookieFromStorage,
} from "@/modules/jiaowu/auth/jiaowuSession";
import { restoreWebVpnTicket } from "@/modules/jiaowu/auth/webvpnTicket";
import { appAuthMe } from "@/api/appAuth";
import { AppApiError, isAuthInvalidCode } from "@/api/appApiError";
import { handleAuthInvalid } from "@/api/handleAuthInvalid";
import { parseAppUserRole } from "@/api/parseAppUserRole";
import { saveSessionSnapshot } from "@/storage/mmkv";

/**
 * 解析冷启动档案；损坏数据则忽略
 */
function parseStoredProfile(raw: string | undefined, fallbackId: string): SessionProfile {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as SessionProfile;
      if (parsed?.studentId) {
        return {
          studentId: parsed.studentId,
          name: parsed.name || "",
          college: parsed.college,
          major: parsed.major,
          grade: parsed.grade,
          className: parsed.className,
          gender: parsed.gender,
          campus: parsed.campus,
          hometown: parsed.hometown,
          identity: parsed.identity,
          studentStatus: parsed.studentStatus,
          enrollmentDate: parsed.enrollmentDate,
          ethnicity: parsed.ethnicity,
          politicalStatus: parsed.politicalStatus,
          phone: parsed.phone,
          examId: parsed.examId,
        };
      }
    } catch {
      // ignore corrupt cache
    }
  }
  return { studentId: fallbackId, name: "" };
}

/**
 * App 冷启动：从 SecureStore / MMKV 恢复教务会话桥接与档案。
 * 有 Node Token 时调 /me 校验；过期/作废则完整本地登出。
 * 无凭据保持未登录，由 AuthRoot 只展示登录页。
 */
export function useJiaowuBootstrap() {
  const setHydrated = useSessionStore((s) => s.setHydrated);
  const setSession = useSessionStore((s) => s.setSession);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const creds = await loadCredentials();
        if (cancelled) return;

        if (creds) {
          bridgeSetLoginData(creds.studentId, creds.password);
          restoreAspCookieFromStorage();
          await restoreWebVpnTicket();
          const snapshot = loadSessionSnapshot();
          const profile = parseStoredProfile(snapshot.profileJson, creds.studentId);
          const token = snapshot.token ?? null;
          const cachedRole = snapshot.role ?? null;
          setSession({ profile, token, role: cachedRole });

          if (token) {
            try {
              const me = await appAuthMe(token, { skipAuthInvalidHandler: true });
              if (cancelled) return;
              const role = parseAppUserRole(me) ?? cachedRole;
              setSession({ profile, token, role });
              saveSessionSnapshot(JSON.stringify(profile), token, role);
            } catch (err) {
              if (cancelled) return;
              if (err instanceof AppApiError && isAuthInvalidCode(err.code)) {
                await handleAuthInvalid(err.code);
                return;
              }
              // 网络/5xx：保留本地会话
            }
          }
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setHydrated, setSession]);
}

import { isTrackWebAllowlisted } from "nongyu-track-contract";
import type { FastifyInstance } from "fastify";
import { inclusiveDaySpan, isToday, parseDate, statDate } from "../bizday.js";
import type { Config } from "../config/env.js";
import type { Jobs } from "../aggregate/jobs.js";
import type { Writer } from "../ingest/writer.js";
import { ErrQueueFull } from "../ingest/writer.js";
import type { RawEvent } from "../ingest/validate.js";
import { setOffline } from "../presence/scanner.js";
import {
  ErrBadTable,
  ErrEmpty,
  ErrForbidden,
  ErrMultiStmt,
  ErrNotSelect,
  ErrTooLong,
  MaxRows,
  prepare,
} from "../sqlguard/index.js";
import type { Store } from "../store/sqlite/db.js";
import {
  countByType,
  countDistinctDAU,
  dims,
  getMetricMap,
  listCrashes,
  listLlmProxyFails,
  liveDims,
  perfDimsInRange,
  trend,
  type DimFilter,
} from "../store/sqlite/metrics.js";
import { countOnline } from "../store/sqlite/presence.js";
import { queryReadOnly } from "../store/sqlite/sqlquery.js";
import type { Syncer } from "../usersync/index.js";
import { buildAuthPlugins } from "./auth.js";
import { Limiter } from "./rateLimit.js";
import { writeFail, writeOK } from "./respond.js";

const allowedTrend = new Set([
  "dau",
  "crash_count",
  "app_open_count",
  "screen_view_count",
  "online_peak",
]);
const allowedDims = new Set([
  "screen_views",
  "screen_dwell_avg",
  "button_clicks",
  "perf_p50",
  "perf_p95",
]);

export type ApiDeps = {
  cfg: Config;
  store: Store;
  writer: Writer;
  syncer: Syncer;
  jobs: Jobs;
  now?: () => Date;
};

type LiveCache = { date: string; at: number; value: Record<string, unknown> | null };

export async function registerRoutes(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const ipLim = new Limiter(deps.cfg.ipRatePerMin);
  const userLim = new Limiter(deps.cfg.userRatePerMin);
  const auth = buildAuthPlugins({
    jwtSecret: deps.cfg.jwtSecret,
    internalToken: deps.cfg.internalToken,
    webSiteKey: deps.cfg.webSiteKey,
    ipLimiter: ipLim,
    userLimiter: userLim,
  });

  let live: LiveCache = { date: "", at: 0, value: null };

  await app.register(auth.requestIdPlugin);
  await app.register(auth.ipRatePlugin);

  app.setErrorHandler((err, _req, reply) => {
    if (reply.sent) return;
    const msg = err instanceof Error ? err.message : "";
    if (msg === "unauthorized" || msg === "forbidden" || msg === "rate_limited") return;
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 413) {
      writeFail(reply, 413, "PAYLOAD_TOO_LARGE", "body too large");
      return;
    }
    writeFail(reply, 500, "INTERNAL", "internal error");
  });

  app.get("/health", async (_req, reply) => {
    try {
      deps.store.ping();
      writeOK(reply, 200, { status: "up", db: "ok" });
    } catch {
      writeFail(reply, 503, "INTERNAL", "db not ok");
    }
  });

  await app.register(
    async (track) => {
      await track.register(auth.appJwtPlugin);
      await track.register(auth.userRatePlugin);

      track.post("/events", async (req, reply) => {
        const body = req.body as { events?: RawEvent[] } | null;
        const events = body?.events;
        if (!Array.isArray(events) || events.length < 1 || events.length > 100) {
          writeFail(reply, 400, "BAD_REQUEST", "events length must be 1-100");
          return;
        }
        const authUser = req.appAuth!;
        try {
          const out = await deps.writer.enqueue({
            userId: authUser.userId,
            studentNo: authUser.studentNo,
            events,
            now: now(),
          });
          writeOK(reply, 200, {
            accepted: out.accepted,
            duplicated: out.duplicated,
            rejected: out.rejected,
            errors: out.errors,
          });
        } catch (err) {
          if (err === ErrQueueFull) {
            writeFail(reply, 503, "QUEUE_FULL", "write queue full");
            return;
          }
          writeFail(reply, 500, "INTERNAL", "ingest failed");
        }
      });

      track.post("/presence/offline", async (req, reply) => {
        try {
          setOffline(deps.store, deps.syncer, req.appAuth!.userId, now());
          writeOK(reply, 200, { user_id: req.appAuth!.userId, is_online: 0 });
        } catch {
          writeFail(reply, 500, "INTERNAL", "offline failed");
        }
      });
    },
    { prefix: "/v1/track" },
  );

  await app.register(
    async (web) => {
      await web.register(auth.webSiteKeyPlugin);

      web.post("/events", async (req, reply) => {
        const body = req.body as { events?: RawEvent[] } | null;
        const events = body?.events;
        if (!Array.isArray(events) || events.length < 1 || events.length > 20) {
          writeFail(reply, 400, "BAD_REQUEST", "events length must be 1-20");
          return;
        }
        const normalized: RawEvent[] = [];
        const earlyErrors: Array<{ event_id: string; code: string; message?: string }> = [];
        for (const raw of events) {
          const id = (raw.event_id ?? "").trim();
          const typ = (raw.event_type ?? "").trim();
          const name = (raw.event_name ?? "").trim();
          if (!isTrackWebAllowlisted(typ, name)) {
            earlyErrors.push({
              event_id: id || (raw.event_id ?? ""),
              code: "INVALID_EVENT",
              message: "event not allowlisted for web ingest",
            });
            continue;
          }
          const platform = (raw.platform ?? "").trim() || "web";
          if (platform !== "web") {
            earlyErrors.push({
              event_id: id,
              code: "INVALID_EVENT",
              message: "platform must be web",
            });
            continue;
          }
          normalized.push({ ...raw, platform: "web" });
        }
        if (normalized.length < 1) {
          writeOK(reply, 200, {
            accepted: 0,
            duplicated: 0,
            rejected: earlyErrors.length,
            errors: earlyErrors,
          });
          return;
        }
        try {
          const out = await deps.writer.enqueue({
            userId: 0,
            studentNo: "",
            events: normalized,
            now: now(),
            skipPresence: true,
          });
          writeOK(reply, 200, {
            accepted: out.accepted,
            duplicated: out.duplicated,
            rejected: out.rejected + earlyErrors.length,
            errors: [...earlyErrors, ...out.errors],
          });
        } catch (err) {
          if (err === ErrQueueFull) {
            writeFail(reply, 503, "QUEUE_FULL", "write queue full");
            return;
          }
          writeFail(reply, 500, "INTERNAL", "ingest failed");
        }
      });
    },
    { prefix: "/v1/track/web" },
  );

  await app.register(
    async (internal) => {
      await internal.register(auth.internalTokenPlugin);

      internal.post("/events", async (req, reply) => {
        const body = req.body as {
          user_id?: number;
          student_no?: string;
          events?: RawEvent[];
        } | null;
        const userId = Number(body?.user_id ?? 0);
        if (!Number.isFinite(userId) || userId <= 0) {
          writeFail(reply, 400, "BAD_REQUEST", "user_id required");
          return;
        }
        const events = body?.events;
        if (!Array.isArray(events) || events.length < 1 || events.length > 100) {
          writeFail(reply, 400, "BAD_REQUEST", "events length must be 1-100");
          return;
        }
        try {
          const out = await deps.writer.enqueue({
            userId,
            studentNo: body?.student_no ?? "",
            events,
            now: now(),
            skipPresence: true,
          });
          writeOK(reply, 200, {
            accepted: out.accepted,
            duplicated: out.duplicated,
            rejected: out.rejected,
            errors: out.errors,
          });
        } catch (err) {
          if (err === ErrQueueFull) {
            writeFail(reply, 503, "QUEUE_FULL", "write queue full");
            return;
          }
          writeFail(reply, 500, "INTERNAL", "ingest failed");
        }
      });
    },
    { prefix: "/v1/internal" },
  );

  await app.register(
    async (admin) => {
      await admin.register(auth.internalTokenPlugin);

      admin.get("/overview", async (req, reply) => {
        const date = String((req.query as { date?: string }).date ?? "");
        try {
          parseDate(date);
        } catch {
          writeFail(reply, 400, "BAD_REQUEST", "invalid date");
          return;
        }
        if (isToday(date, now())) {
          if (live.date === date && Date.now() - live.at < 5000 && live.value) {
            writeOK(reply, 200, live.value);
            return;
          }
          try {
            const dau = countDistinctDAU(deps.store, date);
            const appOpen = countByType(deps.store, date, "app_open");
            const screensAll = countByType(deps.store, date, "screen_view");
            const webScreens = countByType(deps.store, date, "screen_view", "web");
            const screens = screensAll - webScreens;
            const clicks = countByType(deps.store, date, "button_click");
            const crashes = countByType(deps.store, date, "crash");
            const { peak: onlinePeak, atMs: onlinePeakAtMs } = liveOnlinePeak(
              deps.store,
              date,
              now().getTime(),
            );
            const liveData = {
              date,
              dau,
              crash_count: crashes,
              app_open_count: appOpen,
              screen_view_count: screens,
              button_click_count: clicks,
              web_screen_view_count: webScreens,
              online_peak: onlinePeak,
              online_peak_at_ms: onlinePeakAtMs,
            };
            if (
              dau > 0 ||
              appOpen > 0 ||
              screens > 0 ||
              clicks > 0 ||
              crashes > 0 ||
              webScreens > 0 ||
              onlinePeak > 0
            ) {
              live = { date, at: Date.now(), value: liveData };
            }
            writeOK(reply, 200, liveData);
          } catch {
            writeFail(reply, 500, "INTERNAL", "live query failed");
          }
          return;
        }
        try {
          const metrics = getMetricMap(deps.store, date);
          const webScreens = countByType(deps.store, date, "screen_view", "web");
          writeOK(reply, 200, {
            date,
            dau: metrics.dau ?? 0,
            crash_count: metrics.crash_count ?? 0,
            app_open_count: metrics.app_open_count ?? 0,
            screen_view_count: metrics.screen_view_count ?? 0,
            button_click_count: metrics.button_click_count ?? 0,
            web_screen_view_count: webScreens,
            online_peak: metrics.online_peak ?? 0,
            online_peak_at_ms: metricAtOrNull(metrics.online_peak_at_ms),
          });
        } catch {
          writeFail(reply, 500, "INTERNAL", "query failed");
        }
      });

      admin.get("/metrics/trend", async (req, reply) => {
        const q = req.query as { metric?: string; from?: string; to?: string };
        const metric = q.metric ?? "";
        const from = q.from ?? "";
        const to = q.to ?? "";
        if (!allowedTrend.has(metric)) {
          writeFail(reply, 400, "BAD_REQUEST", "invalid metric");
          return;
        }
        let ft: Date;
        let tt: Date;
        try {
          ft = parseDate(from);
          tt = parseDate(to);
        } catch {
          writeFail(reply, 400, "BAD_REQUEST", "invalid from/to");
          return;
        }
        if (ft.getTime() > tt.getTime()) {
          writeFail(reply, 400, "BAD_REQUEST", "invalid from/to");
          return;
        }
        try {
          const rows = trend(deps.store, metric, from, to);
          const points: Array<{ date: string; value: number }> = rows.map((r) => ({
            date: r.statDate,
            value: r.value,
          }));
          const today = statDate(now());
          if (from <= today && today <= to) {
            const liveVal = liveTrendValue(deps.store, metric, today);
            let replaced = false;
            for (const p of points) {
              if (p.date === today) {
                p.value = liveVal;
                replaced = true;
                break;
              }
            }
            if (!replaced) points.push({ date: today, value: liveVal });
          }
          writeOK(reply, 200, points);
        } catch {
          writeFail(reply, 500, "INTERNAL", "query failed");
        }
      });

      admin.get("/metrics/dims", async (req, reply) => {
        const q = req.query as {
          metric?: string;
          date?: string;
          from?: string;
          to?: string;
          limit?: string;
          platform?: string;
          name_prefix?: string;
        };
        const metric = q.metric ?? "";
        if (!allowedDims.has(metric)) {
          writeFail(reply, 400, "BAD_REQUEST", "invalid metric");
          return;
        }

        const fromRaw = (q.from ?? "").trim();
        const toRaw = (q.to ?? "").trim();
        const dateRaw = (q.date ?? "").trim();
        let from = "";
        let to = "";

        if (fromRaw || toRaw) {
          if (!fromRaw || !toRaw) {
            writeFail(reply, 400, "BAD_REQUEST", "from and to must be paired");
            return;
          }
          try {
            parseDate(fromRaw);
            parseDate(toRaw);
          } catch {
            writeFail(reply, 400, "BAD_REQUEST", "invalid from/to");
            return;
          }
          if (fromRaw > toRaw) {
            writeFail(reply, 400, "BAD_REQUEST", "from must be <= to");
            return;
          }
          const span = inclusiveDaySpan(fromRaw, toRaw);
          if (span > 30) {
            writeFail(reply, 400, "BAD_REQUEST", "range must be <= 30 days");
            return;
          }
          if (fromRaw !== toRaw && metric !== "perf_p50" && metric !== "perf_p95") {
            writeFail(reply, 400, "BAD_REQUEST", "only perf_p50/perf_p95 support multi-day range");
            return;
          }
          from = fromRaw;
          to = toRaw;
        } else {
          try {
            parseDate(dateRaw);
          } catch {
            writeFail(reply, 400, "BAD_REQUEST", "invalid date");
            return;
          }
          from = dateRaw;
          to = dateRaw;
        }

        let limit = 50;
        if (q.limit) {
          const n = Number.parseInt(q.limit, 10);
          if (!Number.isFinite(n) || n < 1) {
            writeFail(reply, 400, "BAD_REQUEST", "invalid limit");
            return;
          }
          limit = Math.min(n, 100);
        }
        const platform = (q.platform ?? "").trim();
        if (platform && platform !== "ios" && platform !== "android" && platform !== "web") {
          writeFail(reply, 400, "BAD_REQUEST", "invalid platform");
          return;
        }
        const namePrefix = (q.name_prefix ?? "").trim();
        const filter: DimFilter | undefined =
          platform || namePrefix
            ? { platform: platform || undefined, namePrefix: namePrefix || undefined }
            : undefined;
        try {
          const rows =
            from !== to
              ? perfDimsInRange(deps.store, metric, from, to, limit, filter)
              : isToday(from, now()) || filter
                ? liveDims(deps.store, metric, from, limit, filter)
                : dims(deps.store, metric, from, limit);
          const body: Record<string, unknown> = {
            from,
            to,
            metric,
            items: rows.map((r) => ({
              dim_key: r.dimKey,
              dim_value: r.dimValue,
              metric_value: r.metricValue,
            })),
          };
          if (from === to) body.date = from;
          writeOK(reply, 200, body);
        } catch {
          writeFail(reply, 500, "INTERNAL", "query failed");
        }
      });

      admin.get("/crashes", async (req, reply) => {
        handlePagedEvents(req, reply, deps, "crash");
      });

      admin.get("/llm-proxy-fails", async (req, reply) => {
        handlePagedEvents(req, reply, deps, "llm_proxy_fail");
      });

      admin.post("/sql/query", async (req, reply) => {
        const body = req.body as { sql?: string } | null;
        let prepared;
        try {
          prepared = prepare(body?.sql ?? "");
        } catch (err) {
          const msg = err instanceof Error ? err.message : "invalid sql";
          // 对齐 Go：空/过长/拒写等均 INVALID_SQL
          void ErrEmpty;
          void ErrTooLong;
          void ErrMultiStmt;
          void ErrNotSelect;
          void ErrForbidden;
          void ErrBadTable;
          writeFail(reply, 400, "INVALID_SQL", msg);
          return;
        }
        try {
          const { columns, rows, truncated } = queryReadOnly(deps.store, prepared.execSQL, MaxRows);
          writeOK(reply, 200, {
            sql: prepared.execSQL,
            columns: columns ?? [],
            rows: rows ?? [],
            truncated,
            row_count: rows.length,
          });
        } catch (err) {
          if ((err as { code?: string }).code === "TIMEOUT") {
            writeFail(reply, 504, "TIMEOUT", "query timed out");
            return;
          }
          writeFail(reply, 400, "INVALID_SQL", "sql execution failed");
        }
      });

      admin.post("/jobs/aggregate", async (req, reply) => {
        const body = req.body as { stat_date?: string } | null;
        const stat = body?.stat_date ?? "";
        try {
          parseDate(stat);
        } catch {
          writeFail(reply, 400, "BAD_REQUEST", "invalid stat_date");
          return;
        }
        try {
          const { status } = deps.jobs.runAggregate(stat);
          writeOK(reply, 200, {
            job_name: "aggregate_daily",
            job_key: `stat_date=${stat}`,
            status,
          });
        } catch {
          writeFail(reply, 500, "INTERNAL", "aggregate failed");
        }
      });

      admin.post("/jobs/purge", async (_req, reply) => {
        try {
          const { deleted } = deps.jobs.runPurge();
          writeOK(reply, 200, {
            job_name: "purge_events",
            status: "success",
            deleted_estimate: deleted,
          });
        } catch {
          writeFail(reply, 500, "INTERNAL", "purge failed");
        }
      });
    },
    { prefix: "/v1/admin" },
  );
}

function metricAtOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function liveOnlinePeak(
  store: Store,
  date: string,
  nowMs: number,
): { peak: number; atMs: number | null } {
  const online = countOnline(store);
  const metrics = getMetricMap(store, date);
  const stored = metrics.online_peak ?? 0;
  const storedAt = metricAtOrNull(metrics.online_peak_at_ms);
  if (online > stored) return { peak: online, atMs: nowMs };
  return { peak: stored, atMs: storedAt };
}

function liveTrendValue(store: Store, metric: string, date: string): number {
  switch (metric) {
    case "dau":
      return countDistinctDAU(store, date);
    case "app_open_count":
      return countByType(store, date, "app_open");
    case "screen_view_count":
      return countByType(store, date, "screen_view");
    case "crash_count":
      return countByType(store, date, "crash");
    case "online_peak": {
      const online = countOnline(store);
      const metrics = getMetricMap(store, date);
      const peak = metrics.online_peak ?? 0;
      return online > peak ? online : peak;
    }
    default:
      return 0;
  }
}

function handlePagedEvents(
  req: { query: unknown },
  reply: import("fastify").FastifyReply,
  deps: ApiDeps,
  kind: "crash" | "llm_proxy_fail",
): void {
  const q = req.query as {
    from?: string;
    to?: string;
    page?: string;
    page_size?: string;
    error_code?: string;
  };
  const from = q.from ?? "";
  const to = q.to ?? "";
  try {
    parseDate(from);
  } catch {
    writeFail(reply, 400, "BAD_REQUEST", "invalid from");
    return;
  }
  try {
    parseDate(to);
  } catch {
    writeFail(reply, 400, "BAD_REQUEST", "invalid to");
    return;
  }
  let page = 1;
  let pageSize = 20;
  if (q.page) {
    const n = Number.parseInt(q.page, 10);
    if (!Number.isFinite(n) || n < 1) {
      writeFail(reply, 400, "BAD_REQUEST", "invalid page");
      return;
    }
    page = n;
  }
  if (q.page_size) {
    const n = Number.parseInt(q.page_size, 10);
    if (!Number.isFinite(n) || n < 1) {
      writeFail(reply, 400, "BAD_REQUEST", "invalid page_size");
      return;
    }
    pageSize = Math.min(n, 100);
  }
  const offset = (page - 1) * pageSize;
  try {
    const result =
      kind === "crash"
        ? listCrashes(deps.store, from, to, offset, pageSize)
        : listLlmProxyFails(deps.store, from, to, (q.error_code ?? "").trim(), offset, pageSize);
    const list = result.rows.map((c) => ({
      event_id: c.eventId,
      user_id: c.userId,
      student_no: c.studentNo,
      event_name: c.eventName,
      app_version: c.appVersion,
      platform: c.platform,
      device_brand: c.deviceBrand,
      client_ts_ms: c.clientTsMs,
      received_at_ms: c.receivedAtMs,
      stat_date: c.statDate,
      props: parseProps(c.propsJson),
    }));
    writeOK(reply, 200, { list, total: result.total, page, page_size: pageSize });
  } catch {
    writeFail(reply, 500, "INTERNAL", "query failed");
  }
}

function parseProps(v: string | null): unknown {
  if (!v) return null;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return null;
  }
}

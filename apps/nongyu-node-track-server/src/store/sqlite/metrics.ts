import type { Store } from "./db.js";
import { nullIfEmpty } from "./db.js";

export type Metric = { statDate: string; key: string; value: number };
export type DimRow = { dimKey: string; dimValue: string; metricValue: number };

export type DimFilter = {
  platform?: string;
  namePrefix?: string;
  /** 默认日聚合/App 大屏排除官网事件 */
  excludePlatform?: string;
};

export type CrashRow = {
  eventId: string;
  userId: number | null;
  studentNo: string | null;
  eventName: string;
  appVersion: string | null;
  platform: string | null;
  deviceBrand: string | null;
  clientTsMs: number | null;
  receivedAtMs: number;
  statDate: string;
  propsJson: string | null;
};

export function upsertMetric(
  store: Store,
  date: string,
  key: string,
  value: number,
  nowMs: number,
): void {
  store.db
    .prepare(
      `INSERT INTO daily_metrics (stat_date, metric_key, metric_value, updated_at_ms)
VALUES (?, ?, ?, ?)
ON CONFLICT(stat_date, metric_key) DO UPDATE SET
  metric_value=excluded.metric_value,
  updated_at_ms=excluded.updated_at_ms`,
    )
    .run(date, key, value, nowMs);
}

/** 峰值严格升高时写入首次达到时刻；并列与回落不改时刻。 */
export function bumpPeak(store: Store, date: string, sample: number, nowMs: number): void {
  store.withWriteTx(() => {
    const current = store.db
      .prepare(
        `SELECT metric_value FROM daily_metrics WHERE stat_date=? AND metric_key='online_peak'`,
      )
      .get(date) as { metric_value: number } | undefined;
    if (!current) {
      upsertMetric(store, date, "online_peak", sample, nowMs);
      if (sample > 0) upsertMetric(store, date, "online_peak_at_ms", nowMs, nowMs);
      return;
    }
    if (sample <= current.metric_value) return;
    upsertMetric(store, date, "online_peak", sample, nowMs);
    upsertMetric(store, date, "online_peak_at_ms", nowMs, nowMs);
  });
}

export function replaceDims(
  store: Store,
  date: string,
  metricKey: string,
  nowMs: number,
  rows: DimRow[],
): void {
  store.db
    .prepare(`DELETE FROM daily_dims WHERE stat_date=? AND metric_key=?`)
    .run(date, metricKey);
  const ins = store.db.prepare(
    `INSERT INTO daily_dims (stat_date, metric_key, dim_key, dim_value, metric_value, updated_at_ms)
VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    ins.run(date, metricKey, row.dimKey, row.dimValue, row.metricValue, nowMs);
  }
}

export function getMetricMap(store: Store, date: string): Record<string, number> {
  const rows = store.db
    .prepare(`SELECT metric_key, metric_value FROM daily_metrics WHERE stat_date=?`)
    .all(date) as Array<{ metric_key: string; metric_value: number }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.metric_key] = r.metric_value;
  return out;
}

export function trend(store: Store, metric: string, from: string, to: string): Metric[] {
  const rows = store.db
    .prepare(
      `SELECT stat_date, metric_key, metric_value FROM daily_metrics
WHERE metric_key=? AND stat_date>=? AND stat_date<=?
ORDER BY stat_date ASC`,
    )
    .all(metric, from, to) as Array<{
    stat_date: string;
    metric_key: string;
    metric_value: number;
  }>;
  return rows.map((r) => ({ statDate: r.stat_date, key: r.metric_key, value: r.metric_value }));
}

/** 从当日 events 实时汇总维度（今日 overview/大屏用）。带 platform/namePrefix 时亦用于历史日。 */
const APP_DIM_FILTER: DimFilter = { excludePlatform: "web" };

export function liveDims(
  store: Store,
  metric: string,
  date: string,
  limit: number,
  filter?: DimFilter,
): DimRow[] {
  let lim = limit;
  if (lim < 1) lim = 50;
  const effective =
    filter?.platform || filter?.namePrefix || filter?.excludePlatform ? filter : APP_DIM_FILTER;
  let rows: DimRow[];
  switch (metric) {
    case "screen_views":
      rows = countScreenEnters(store, date, effective);
      break;
    case "screen_dwell_avg":
      rows = avgScreenDwell(store, date, effective);
      break;
    case "button_clicks":
      rows = countByName(store, date, "button_click", effective);
      break;
    case "perf_p50":
    case "perf_p95": {
      rows = perfDimsInRange(store, metric, date, date, lim, effective);
      // perfDimsInRange 已排序截断；此处再走统一 sort/slice 无害
      break;
    }
    default:
      throw new Error(`unsupported live dim metric ${metric}`);
  }
  rows.sort((a, b) => {
    if (a.metricValue === b.metricValue) return a.dimValue < b.dimValue ? -1 : 1;
    return b.metricValue - a.metricValue;
  });
  return rows.length > lim ? rows.slice(0, lim) : rows;
}

export function dims(
  store: Store,
  metric: string,
  date: string,
  limit: number,
  filter?: DimFilter,
): DimRow[] {
  if (filter?.platform || filter?.namePrefix || filter?.excludePlatform) {
    return liveDims(store, metric, date, limit, filter);
  }
  const rows = store.db
    .prepare(
      `SELECT dim_key, dim_value, metric_value FROM daily_dims
WHERE stat_date=? AND metric_key=?
ORDER BY metric_value DESC, dim_value ASC
LIMIT ?`,
    )
    .all(date, metric, limit) as Array<{
    dim_key: string;
    dim_value: string;
    metric_value: number;
  }>;
  return rows.map((r) => ({
    dimKey: r.dim_key,
    dimValue: r.dim_value,
    metricValue: r.metric_value,
  }));
}

/** 对已排序样本取分位（与日聚合口径一致）。 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  let idx = Math.ceil((p / 100) * sorted.length) - 1;
  if (idx < 0) idx = 0;
  if (idx >= sorted.length) idx = sorted.length - 1;
  return sorted[idx]!;
}

export function countDistinctDAU(store: Store, date: string): number {
  const row = store.db
    .prepare(
      `SELECT COUNT(DISTINCT user_id) AS n FROM events
WHERE stat_date=? AND event_type='app_open' AND user_id IS NOT NULL`,
    )
    .get(date) as { n: number };
  return row.n;
}

export function countByType(
  store: Store,
  date: string,
  eventType: string,
  platform?: string,
): number {
  if (platform) {
    const row = store.db
      .prepare(`SELECT COUNT(*) AS n FROM events WHERE stat_date=? AND event_type=? AND platform=?`)
      .get(date, eventType, platform) as { n: number };
    return row.n;
  }
  const row = store.db
    .prepare(`SELECT COUNT(*) AS n FROM events WHERE stat_date=? AND event_type=?`)
    .get(date, eventType) as { n: number };
  return row.n;
}

function appendEventFilters(
  sql: string,
  args: unknown[],
  filter?: DimFilter,
): { sql: string; args: unknown[] } {
  let out = sql;
  const next = [...args];
  if (filter?.platform) {
    out += ` AND platform=?`;
    next.push(filter.platform);
  }
  if (filter?.excludePlatform) {
    out += ` AND (platform IS NULL OR platform!=?)`;
    next.push(filter.excludePlatform);
  }
  if (filter?.namePrefix) {
    out += ` AND event_name LIKE ?`;
    next.push(`${filter.namePrefix}%`);
  }
  return { sql: out, args: next };
}

export function countByName(
  store: Store,
  date: string,
  eventType: string,
  filter?: DimFilter,
): DimRow[] {
  const base = appendEventFilters(
    `SELECT event_name, COUNT(*) AS n FROM events
WHERE stat_date=? AND event_type=?`,
    [date, eventType],
    filter,
  );
  const rows = store.db.prepare(`${base.sql} GROUP BY event_name`).all(...base.args) as Array<{
    event_name: string;
    n: number;
  }>;
  return rows.map((r) => ({ dimKey: "name", dimValue: r.event_name, metricValue: r.n }));
}

export function countScreenEnters(store: Store, date: string, filter?: DimFilter): DimRow[] {
  const base = appendEventFilters(
    `SELECT event_name, COUNT(*) AS n FROM events
WHERE stat_date=? AND event_type='screen_view' AND duration_ms IS NULL`,
    [date],
    filter,
  );
  const rows = store.db.prepare(`${base.sql} GROUP BY event_name`).all(...base.args) as Array<{
    event_name: string;
    n: number;
  }>;
  return rows.map((r) => ({ dimKey: "name", dimValue: r.event_name, metricValue: r.n }));
}

export function avgScreenDwell(store: Store, date: string, filter?: DimFilter): DimRow[] {
  const base = appendEventFilters(
    `SELECT event_name, CAST(ROUND(AVG(duration_ms)) AS INTEGER) AS n FROM events
WHERE stat_date=? AND event_type='screen_view' AND duration_ms IS NOT NULL`,
    [date],
    filter,
  );
  const rows = store.db.prepare(`${base.sql} GROUP BY event_name`).all(...base.args) as Array<{
    event_name: string;
    n: number;
  }>;
  return rows.map((r) => ({ dimKey: "name", dimValue: r.event_name, metricValue: r.n }));
}

/** 单日 perf 时长样本（日聚合与 live 共用）。 */
export function perfDurations(
  store: Store,
  date: string,
  filter?: DimFilter,
): Map<string, number[]> {
  return perfDurationsInRange(store, date, date, filter);
}

/** 闭区间内 perf 原始 duration_ms，按 event_name 分组。 */
export function perfDurationsInRange(
  store: Store,
  from: string,
  to: string,
  filter?: DimFilter,
): Map<string, number[]> {
  const base = appendEventFilters(
    `SELECT event_name, duration_ms FROM events
WHERE stat_date>=? AND stat_date<=? AND event_type='perf' AND duration_ms IS NOT NULL`,
    [from, to],
    filter,
  );
  const rows = store.db.prepare(base.sql).all(...base.args) as Array<{
    event_name: string;
    duration_ms: number;
  }>;
  const out = new Map<string, number[]>();
  for (const r of rows) {
    const list = out.get(r.event_name) ?? [];
    list.push(r.duration_ms);
    out.set(r.event_name, list);
  }
  return out;
}

/**
 * 区间内对原始样本重算 perf_p50 / perf_p95（禁止合并日聚合分位）。
 * 默认排除 platform=web，与 liveDims 单日口径一致。
 */
export function perfDimsInRange(
  store: Store,
  metric: string,
  from: string,
  to: string,
  limit: number,
  filter?: DimFilter,
): DimRow[] {
  let lim = limit;
  if (lim < 1) lim = 50;
  const effective =
    filter?.platform || filter?.namePrefix || filter?.excludePlatform ? filter : APP_DIM_FILTER;
  const p = metric === "perf_p95" ? 95 : 50;
  const perf = perfDurationsInRange(store, from, to, effective);
  const rows: DimRow[] = [];
  for (const [name, vals] of perf) {
    const sorted = [...vals].sort((a, b) => a - b);
    rows.push({ dimKey: "name", dimValue: name, metricValue: percentile(sorted, p) });
  }
  rows.sort((a, b) => {
    if (a.metricValue === b.metricValue) return a.dimValue < b.dimValue ? -1 : 1;
    return b.metricValue - a.metricValue;
  });
  return rows.length > lim ? rows.slice(0, lim) : rows;
}

function listEventsByType(
  store: Store,
  eventType: string,
  from: string,
  to: string,
  eventName: string,
  offset: number,
  limit: number,
): { rows: CrashRow[]; total: number } {
  let countSQL = `SELECT COUNT(*) AS n FROM events WHERE event_type=? AND stat_date>=? AND stat_date<=?`;
  let listSQL = `SELECT event_id, user_id, student_no, event_name, app_version, platform, device_brand,
       client_ts_ms, received_at_ms, stat_date, props_json
FROM events
WHERE event_type=? AND stat_date>=? AND stat_date<=?`;
  const argsCount: unknown[] = [eventType, from, to];
  const argsList: unknown[] = [eventType, from, to];
  if (eventName) {
    countSQL += ` AND event_name=?`;
    listSQL += ` AND event_name=?`;
    argsCount.push(eventName);
    argsList.push(eventName);
  }
  listSQL += ` ORDER BY received_at_ms DESC LIMIT ? OFFSET ?`;
  argsList.push(limit, offset);

  const total = (store.db.prepare(countSQL).get(...argsCount) as { n: number }).n;
  const raw = store.db.prepare(listSQL).all(...argsList) as Array<{
    event_id: string;
    user_id: number | null;
    student_no: string | null;
    event_name: string;
    app_version: string | null;
    platform: string | null;
    device_brand: string | null;
    client_ts_ms: number | null;
    received_at_ms: number;
    stat_date: string;
    props_json: string | null;
  }>;
  const rows = raw.map((c) => ({
    eventId: c.event_id,
    userId: c.user_id,
    studentNo: c.student_no,
    eventName: c.event_name,
    appVersion: c.app_version,
    platform: c.platform,
    deviceBrand: c.device_brand,
    clientTsMs: c.client_ts_ms,
    receivedAtMs: c.received_at_ms,
    statDate: c.stat_date,
    propsJson: c.props_json,
  }));
  return { rows, total };
}

export function listCrashes(store: Store, from: string, to: string, offset: number, limit: number) {
  return listEventsByType(store, "crash", from, to, "", offset, limit);
}

export function listLlmProxyFails(
  store: Store,
  from: string,
  to: string,
  errorCode: string,
  offset: number,
  limit: number,
) {
  return listEventsByType(store, "llm_proxy_fail", from, to, errorCode, offset, limit);
}

export function purgeEvents(store: Store, cutoffMs: number): number {
  let deleted = 0;
  store.withWriteTx(() => {
    const res = store.db.prepare(`DELETE FROM events WHERE received_at_ms < ?`).run(cutoffMs);
    deleted = res.changes;
  });
  try {
    store.db.exec("PRAGMA optimize");
  } catch {
    /* ignore */
  }
  return deleted;
}

export function recordJob(
  store: Store,
  name: string,
  key: string,
  status: string,
  nowMs: number,
  detail: string,
): void {
  store.db
    .prepare(
      `INSERT INTO meta_jobs (job_name, job_key, status, finished_at_ms, detail_json)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(job_name, job_key) DO UPDATE SET
  status=excluded.status,
  finished_at_ms=excluded.finished_at_ms,
  detail_json=excluded.detail_json`,
    )
    .run(name, key, status, nowMs, nullIfEmpty(detail));
}

export function jobStatus(
  store: Store,
  name: string,
  key: string,
): { status: string; ok: boolean } {
  const row = store.db
    .prepare(`SELECT status FROM meta_jobs WHERE job_name=? AND job_key=?`)
    .get(name, key) as { status: string } | undefined;
  if (!row) return { status: "", ok: false };
  return { status: row.status, ok: true };
}

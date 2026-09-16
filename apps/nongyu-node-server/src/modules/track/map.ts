const SENSITIVE_KEY = /password|token|authorization/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : null;
}

/** 峰值时刻 UTC ms；缺省/非法/非正数一律 null，禁止当 0。 */
function asPeakAtMs(value: unknown): number | null {
  const n = asNullableNumber(value);
  if (n === null || n <= 0) return null;
  return n;
}

/** 去掉 props 中疑似密钥的键，避免大屏把 Token 渲染出来。 */
export function stripSensitiveProps(props: unknown): Record<string, unknown> | null {
  if (!isRecord(props)) return null;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (SENSITIVE_KEY.test(key)) continue;
    next[key] = value;
  }
  return next;
}

export function mapOverview(raw: unknown): {
  date: string;
  dau: number;
  crashCount: number;
  appOpenCount: number;
  screenViewCount: number;
  onlinePeak: number;
  onlinePeakAtMs: number | null;
  buttonClickCount?: number;
  webScreenViewCount?: number;
} {
  const record = isRecord(raw) ? raw : {};
  const mapped: {
    date: string;
    dau: number;
    crashCount: number;
    appOpenCount: number;
    screenViewCount: number;
    onlinePeak: number;
    onlinePeakAtMs: number | null;
    buttonClickCount?: number;
    webScreenViewCount?: number;
  } = {
    date: asString(record.date),
    dau: asNumber(record.dau),
    crashCount: asNumber(record.crash_count),
    appOpenCount: asNumber(record.app_open_count),
    screenViewCount: asNumber(record.screen_view_count),
    onlinePeak: asNumber(record.online_peak),
    onlinePeakAtMs: asPeakAtMs(record.online_peak_at_ms),
  };
  if (record.button_click_count !== undefined) {
    mapped.buttonClickCount = asNumber(record.button_click_count);
  }
  if (record.web_screen_view_count !== undefined) {
    mapped.webScreenViewCount = asNumber(record.web_screen_view_count);
  }
  return mapped;
}

export function mapDims(raw: unknown): {
  date?: string;
  from?: string;
  to?: string;
  metric: string;
  items: { dimKey: string; dimValue: string; metricValue: number }[];
} {
  const record = isRecord(raw) ? raw : {};
  const itemsRaw = Array.isArray(record.items) ? record.items : [];
  const mapped: {
    date?: string;
    from?: string;
    to?: string;
    metric: string;
    items: { dimKey: string; dimValue: string; metricValue: number }[];
  } = {
    metric: asString(record.metric),
    items: itemsRaw.map((item) => {
      const row = isRecord(item) ? item : {};
      return {
        dimKey: asString(row.dim_key),
        dimValue: asString(row.dim_value),
        metricValue: asNumber(row.metric_value),
      };
    }),
  };
  if (record.date !== undefined && record.date !== null && asString(record.date)) {
    mapped.date = asString(record.date);
  }
  if (record.from !== undefined && record.from !== null && asString(record.from)) {
    mapped.from = asString(record.from);
  }
  if (record.to !== undefined && record.to !== null && asString(record.to)) {
    mapped.to = asString(record.to);
  }
  return mapped;
}

export function mapCrashes(
  raw: unknown,
  page: number,
  pageSize: number,
): {
  list: Array<{
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
    props: Record<string, unknown> | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
} {
  const record = isRecord(raw) ? raw : {};
  const listRaw = Array.isArray(record.list) ? record.list : [];
  return {
    list: listRaw.map((item) => {
      const row = isRecord(item) ? item : {};
      return {
        eventId: asString(row.event_id),
        userId: asNullableNumber(row.user_id),
        studentNo: asNullableString(row.student_no),
        eventName: asString(row.event_name),
        appVersion: asNullableString(row.app_version),
        platform: asNullableString(row.platform),
        deviceBrand: asNullableString(row.device_brand),
        clientTsMs: asNullableNumber(row.client_ts_ms),
        receivedAtMs: asNumber(row.received_at_ms),
        statDate: asString(row.stat_date),
        props: stripSensitiveProps(row.props),
      };
    }),
    total: asNumber(record.total),
    page: asNumber(record.page, page),
    pageSize: asNumber(record.page_size, pageSize),
  };
}

export function mapTrend(raw: unknown): { points: { date: string; value: number }[] } {
  const rows = Array.isArray(raw) ? raw : [];
  return {
    points: rows.map((item) => {
      const row = isRecord(item) ? item : {};
      return { date: asString(row.date), value: asNumber(row.value) };
    }),
  };
}

export function mapSqlQuery(raw: unknown): {
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  rowCount: number;
} {
  const record = isRecord(raw) ? raw : {};
  const columns = Array.isArray(record.columns) ? record.columns.map((col) => asString(col)) : [];
  const rowsRaw = Array.isArray(record.rows) ? record.rows : [];
  const rows = rowsRaw.filter(isRecord);
  return {
    sql: asString(record.sql),
    columns,
    rows,
    truncated: record.truncated === true,
    rowCount: asNumber(record.row_count, rows.length),
  };
}

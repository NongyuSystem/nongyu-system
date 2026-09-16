import type { GridItemLayout } from "../types/dashboard";

export const WIDGET_IDS = [
  "kpi-total-users",
  "kpi-dau",
  "kpi-online",
  "kpi-online-peak",
  "kpi-today-new",
  "kpi-web-pv",
  "chart-user-growth",
  "chart-dau-trend",
  "chart-online-peak-trend",
  "chart-active-days-ranking",
  "chart-gender",
  "chart-college",
  "chart-grade",
  "chart-device",
  "chart-screen-views",
  "chart-screen-dwell",
  "chart-button-clicks",
  "chart-perf",
  "chart-web-vitals",
  "table-crashes",
] as const;

export type WidgetId = (typeof WIDGET_IDS)[number];

export type GridBreakpoint = "lg" | "md" | "xs";

function item(
  i: WidgetId,
  x: number,
  y: number,
  w: number,
  h: number,
  minW: number,
  minH: number,
): GridItemLayout {
  return { i, x, y, w, h, minW, minH };
}

const kpi = (id: WidgetId, x: number, y: number, w: number) => item(id, x, y, w, 2, 2, 2);
const chart = (id: WidgetId, x: number, y: number, w: number, h: number) =>
  item(id, x, y, w, h, 3, 3);
const table = (id: WidgetId, x: number, y: number, w: number, h: number) =>
  item(id, x, y, w, h, 4, 4);

/** 默认布局：此刻 KPI → 体量 → 趋势 → 排行 → 用户是谁 → 行为 → 健康 */
export const DEFAULT_LAYOUTS: Record<GridBreakpoint, GridItemLayout[]> = {
  lg: [
    kpi("kpi-online", 0, 0, 3),
    kpi("kpi-online-peak", 3, 0, 3),
    kpi("kpi-dau", 6, 0, 3),
    kpi("kpi-today-new", 9, 0, 3),
    kpi("kpi-total-users", 0, 2, 6),
    kpi("kpi-web-pv", 6, 2, 6),
    chart("chart-user-growth", 0, 4, 12, 4),
    chart("chart-dau-trend", 0, 8, 6, 4),
    chart("chart-online-peak-trend", 6, 8, 6, 4),
    chart("chart-active-days-ranking", 0, 12, 12, 5),
    chart("chart-gender", 0, 17, 4, 4),
    chart("chart-grade", 4, 17, 4, 4),
    chart("chart-device", 8, 17, 4, 4),
    chart("chart-college", 0, 21, 12, 5),
    chart("chart-screen-views", 0, 26, 6, 5),
    chart("chart-screen-dwell", 6, 26, 6, 5),
    chart("chart-button-clicks", 0, 31, 12, 5),
    chart("chart-perf", 0, 36, 6, 5),
    chart("chart-web-vitals", 6, 36, 6, 7),
    table("table-crashes", 0, 43, 12, 5),
  ],
  md: [
    kpi("kpi-online", 0, 0, 4),
    kpi("kpi-online-peak", 4, 0, 4),
    kpi("kpi-dau", 0, 2, 4),
    kpi("kpi-today-new", 4, 2, 4),
    kpi("kpi-total-users", 0, 4, 4),
    kpi("kpi-web-pv", 4, 4, 4),
    chart("chart-user-growth", 0, 6, 8, 4),
    chart("chart-dau-trend", 0, 10, 8, 4),
    chart("chart-online-peak-trend", 0, 14, 8, 4),
    chart("chart-active-days-ranking", 0, 18, 8, 5),
    chart("chart-gender", 0, 23, 4, 4),
    chart("chart-grade", 4, 23, 4, 4),
    chart("chart-device", 0, 27, 8, 4),
    chart("chart-college", 0, 31, 8, 5),
    chart("chart-screen-views", 0, 36, 8, 5),
    chart("chart-screen-dwell", 0, 41, 8, 5),
    chart("chart-button-clicks", 0, 46, 8, 5),
    chart("chart-perf", 0, 51, 8, 5),
    chart("chart-web-vitals", 0, 56, 8, 7),
    table("table-crashes", 0, 63, 8, 5),
  ],
  xs: [
    kpi("kpi-online", 0, 0, 4),
    kpi("kpi-online-peak", 0, 2, 4),
    kpi("kpi-dau", 0, 4, 4),
    kpi("kpi-today-new", 0, 6, 4),
    kpi("kpi-total-users", 0, 8, 4),
    kpi("kpi-web-pv", 0, 10, 4),
    chart("chart-user-growth", 0, 12, 4, 4),
    chart("chart-dau-trend", 0, 16, 4, 4),
    chart("chart-online-peak-trend", 0, 20, 4, 4),
    chart("chart-active-days-ranking", 0, 24, 4, 5),
    chart("chart-gender", 0, 29, 4, 4),
    chart("chart-grade", 0, 33, 4, 4),
    chart("chart-device", 0, 37, 4, 4),
    chart("chart-college", 0, 41, 4, 5),
    chart("chart-screen-views", 0, 46, 4, 5),
    chart("chart-screen-dwell", 0, 51, 4, 5),
    chart("chart-button-clicks", 0, 56, 4, 5),
    chart("chart-perf", 0, 61, 4, 5),
    chart("chart-web-vitals", 0, 66, 4, 7),
    table("table-crashes", 0, 73, 4, 5),
  ],
};

export const GRID_BREAKPOINTS = { lg: 1200, md: 768, xs: 0 };
export const GRID_COLS = { lg: 12, md: 8, xs: 4 };
export const GRID_ROW_HEIGHT = 56;

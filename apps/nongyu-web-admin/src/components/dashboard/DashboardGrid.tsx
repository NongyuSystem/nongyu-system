import { useEffect, useRef } from "react";
import { Grid, Select } from "antd";
import {
  Responsive as ResponsiveRaw,
  WidthProvider as WidthProviderRaw,
  type Layout,
  type Layouts,
} from "react-grid-layout";
import type {
  DashboardOverview,
  DashboardPrefsV1,
  GrowthRange,
  PerfRange,
  TrackCrashPage,
  TrackDimItem,
  TrackOverview,
  TrackTrend,
  UserDistribution,
  UserGrowth,
} from "../../types/dashboard";
import {
  GRID_BREAKPOINTS,
  GRID_COLS,
  GRID_ROW_HEIGHT,
  type WidgetId,
} from "../../lib/dashboardLayout";
import { formatOnlinePeakHint } from "../../lib/perfRange";
import { ActiveDaysRankingCard } from "./ActiveDaysRankingCard";
import { ChartCard } from "./ChartCard";
import { CrashesTable } from "./CrashesTable";
import {
  barOption,
  buttonClicksBarOption,
  dimBarOption,
  dwellBarOption,
  growthOption,
  perfOption,
  pieOption,
  trackTrendOption,
  webVitalsOption,
} from "./dashboardCharts";
import { EchartsBlock } from "./EchartsBlock";
import { KpiCard } from "./KpiCard";
import { SortableChartCard } from "./SortableChartCard";
import { WebVitalsGuide } from "./WebVitalsGuide";

/** CJS 命名导出偶发带着 `.default`；解包后再交给 WidthProvider，避免 React #130 */
function unwrapCjsComponent<T>(mod: T | { default: T }): T {
  if (
    mod &&
    typeof mod === "object" &&
    "default" in mod &&
    typeof (mod as { default: unknown }).default === "function"
  ) {
    return (mod as { default: T }).default;
  }
  return mod as T;
}

const ResponsiveGridLayout = unwrapCjsComponent(WidthProviderRaw)(
  unwrapCjsComponent(ResponsiveRaw),
);

const RANGE_OPTIONS = [
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "90d", label: "近 90 天" },
  { value: "180d", label: "近半年" },
  { value: "365d", label: "近一年" },
];

const PERF_RANGE_OPTIONS = [
  { value: "1d", label: "今天" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
];

export type DashboardGridData = {
  overview: DashboardOverview | null;
  growth: UserGrowth | null;
  distribution: UserDistribution | null;
  trackOverview: TrackOverview | null;
  dauTrend: TrackTrend | null;
  onlinePeakTrend: TrackTrend | null;
  screenViews: TrackDimItem[];
  screenDwell: TrackDimItem[];
  buttonClicks: TrackDimItem[];
  perfP50: TrackDimItem[];
  perfP95: TrackDimItem[];
  webVitalP50: TrackDimItem[];
  webVitalP95: TrackDimItem[];
  crashes: TrackCrashPage | null;
};

export function DashboardGrid({
  prefs,
  data,
  coreLoading,
  trackLoading,
  trackTrendLoading,
  perfLoading,
  crashLoading,
  coreError,
  trackError,
  onLayoutsChange,
  onLayoutPersist,
  onGrowthRangeChange,
  onPerfRangeChange,
  onTrackTrendRangeChange,
  onCrashPageChange,
}: {
  prefs: DashboardPrefsV1;
  data: DashboardGridData;
  coreLoading: boolean;
  trackLoading: boolean;
  trackTrendLoading: boolean;
  perfLoading: boolean;
  crashLoading: boolean;
  coreError: string | null;
  trackError: string | null;
  onLayoutsChange: (layouts: Layouts) => void;
  onLayoutPersist: () => void;
  onGrowthRangeChange: (range: GrowthRange) => void;
  onPerfRangeChange: (range: PerfRange) => void;
  onTrackTrendRangeChange: (range: GrowthRange) => void;
  onCrashPageChange: (page: number) => void;
}) {
  const screens = Grid.useBreakpoint();
  /** ≥ lg(992) 才允许拖拽/缩放；窄屏仅浏览 */
  const canEditLayout = screens.lg ?? false;
  /** 忽略挂载/断点切换时 RGL 自动 compact 触发的 onLayoutChange，避免覆盖 localStorage 布局 */
  const layoutTouchedRef = useRef(false);
  /** RGL 先 onDragStop/onResizeStop 再 onLayoutChange；持久化必须等 layout 变更后再写 */
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, []);

  function scheduleLayoutPersist() {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      onLayoutPersist();
    }, 80);
  }

  return (
    <ResponsiveGridLayout
      className="dashboard-grid"
      layouts={prefs.layouts as Layouts}
      breakpoints={GRID_BREAKPOINTS}
      cols={GRID_COLS}
      rowHeight={GRID_ROW_HEIGHT}
      margin={canEditLayout ? [16, 16] : [10, 10]}
      compactType="vertical"
      isDraggable={canEditLayout}
      isResizable={canEditLayout}
      draggableHandle=".dashboard-drag-handle"
      draggableCancel=".dashboard-no-drag,input,button,textarea,.ant-select,.ant-pagination,.ant-segmented"
      onLayoutChange={(_current: Layout[], all: Layouts) => {
        if (!layoutTouchedRef.current) return;
        onLayoutsChange(all);
        scheduleLayoutPersist();
      }}
      onDragStart={() => {
        layoutTouchedRef.current = true;
      }}
      onResizeStart={() => {
        layoutTouchedRef.current = true;
      }}
    >
      {renderWidgets({
        data,
        coreLoading,
        trackLoading,
        trackTrendLoading,
        perfLoading,
        crashLoading,
        coreError,
        trackError,
        growthRange: prefs.growthRange,
        perfRange: prefs.perfRange ?? "1d",
        trackTrendRange: prefs.trackTrendRange ?? "7d",
        layoutEditable: canEditLayout,
        onGrowthRangeChange,
        onPerfRangeChange,
        onTrackTrendRangeChange,
        onCrashPageChange,
      })}
    </ResponsiveGridLayout>
  );
}

function renderWidgets(args: {
  data: DashboardGridData;
  coreLoading: boolean;
  trackLoading: boolean;
  trackTrendLoading: boolean;
  perfLoading: boolean;
  crashLoading: boolean;
  coreError: string | null;
  trackError: string | null;
  growthRange: GrowthRange;
  perfRange: PerfRange;
  trackTrendRange: GrowthRange;
  layoutEditable: boolean;
  onGrowthRangeChange: (range: GrowthRange) => void;
  onPerfRangeChange: (range: PerfRange) => void;
  onTrackTrendRangeChange: (range: GrowthRange) => void;
  onCrashPageChange: (page: number) => void;
}) {
  const ids: WidgetId[] = [
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
  ];
  return ids.map((id) => <div key={id}>{widgetBody(id, args)}</div>);
}

function trackTrendRangeSelect(range: GrowthRange, onChange: (range: GrowthRange) => void) {
  return (
    <Select
      size="small"
      value={range}
      options={RANGE_OPTIONS}
      onChange={(value) => onChange(value as GrowthRange)}
      className="min-w-28"
    />
  );
}

function widgetBody(
  id: WidgetId,
  args: {
    data: DashboardGridData;
    coreLoading: boolean;
    trackLoading: boolean;
    trackTrendLoading: boolean;
    perfLoading: boolean;
    crashLoading: boolean;
    coreError: string | null;
    trackError: string | null;
    growthRange: GrowthRange;
    perfRange: PerfRange;
    trackTrendRange: GrowthRange;
    layoutEditable: boolean;
    onGrowthRangeChange: (range: GrowthRange) => void;
    onPerfRangeChange: (range: PerfRange) => void;
    onTrackTrendRangeChange: (range: GrowthRange) => void;
    onCrashPageChange: (page: number) => void;
  },
) {
  const { data, layoutEditable } = args;
  if (id === "kpi-total-users") {
    return (
      <KpiCard
        title="总用户数"
        value={data.overview?.totalUsers ?? null}
        hint={data.overview ? `其中管理员 ${data.overview.totalAdmins}` : "含管理员子集"}
        loading={args.coreLoading}
        error={args.coreError}
        layoutEditable={layoutEditable}
      />
    );
  }
  if (id === "kpi-dau") {
    return (
      <KpiCard
        title="今日日活"
        value={data.trackOverview?.dau ?? null}
        hint="当日至少一次打开 App"
        loading={args.trackLoading}
        error={args.trackError}
        layoutEditable={layoutEditable}
      />
    );
  }
  if (id === "kpi-online") {
    return (
      <KpiCard
        title="当前在线"
        value={data.overview?.onlineUsers ?? null}
        hint="近 10 分钟有心跳"
        loading={args.coreLoading}
        error={args.coreError}
        layoutEditable={layoutEditable}
      />
    );
  }
  if (id === "kpi-online-peak") {
    const peak = data.trackOverview ? (data.trackOverview.onlinePeak ?? 0) : null;
    return (
      <KpiCard
        title="今日最高同时在线"
        value={peak}
        hint={
          peak === null
            ? "当日定时采样峰值"
            : formatOnlinePeakHint(peak, data.trackOverview?.onlinePeakAtMs ?? null)
        }
        hintTitle="当日定时采样峰值；时刻为首次达到该人数的时间"
        loading={args.trackLoading}
        error={args.trackError}
        layoutEditable={layoutEditable}
      />
    );
  }
  if (id === "kpi-today-new") {
    return (
      <KpiCard
        title="今日新增"
        value={data.overview?.todayNewUsers ?? null}
        hint="今日完成注册的用户"
        loading={args.coreLoading}
        error={args.coreError}
        layoutEditable={layoutEditable}
      />
    );
  }
  if (id === "kpi-web-pv") {
    return (
      <KpiCard
        title="今日官网访问"
        value={data.trackOverview?.webScreenViewCount ?? null}
        hint="每次打开/刷新官网计 1 次（PV），不含 App 页面浏览"
        loading={args.trackLoading}
        error={args.trackError}
        layoutEditable={layoutEditable}
      />
    );
  }
  if (id === "chart-user-growth") {
    const option = data.growth ? growthOption(data.growth) : null;
    return (
      <ChartCard
        title="用户增长趋势"
        loading={args.coreLoading}
        error={args.coreError}
        empty={!option}
        layoutEditable={layoutEditable}
        extra={
          <Select
            size="small"
            value={args.growthRange}
            options={RANGE_OPTIONS}
            onChange={(value) => args.onGrowthRangeChange(value as GrowthRange)}
            className="min-w-28"
          />
        }
      >
        {option ? <EchartsBlock option={option} /> : null}
      </ChartCard>
    );
  }
  if (id === "chart-dau-trend") {
    const option = trackTrendOption(data.dauTrend);
    return (
      <ChartCard
        title="日活趋势"
        loading={args.trackLoading || args.trackTrendLoading}
        error={args.trackError}
        empty={!option}
        layoutEditable={layoutEditable}
        extra={trackTrendRangeSelect(args.trackTrendRange, args.onTrackTrendRangeChange)}
      >
        {option ? <EchartsBlock option={option} /> : null}
      </ChartCard>
    );
  }
  if (id === "chart-online-peak-trend") {
    const option = trackTrendOption(data.onlinePeakTrend);
    return (
      <ChartCard
        title="最高同时在线趋势"
        loading={args.trackLoading || args.trackTrendLoading}
        error={args.trackError}
        empty={!option}
        layoutEditable={layoutEditable}
        extra={trackTrendRangeSelect(args.trackTrendRange, args.onTrackTrendRangeChange)}
      >
        {option ? <EchartsBlock option={option} /> : null}
      </ChartCard>
    );
  }
  if (id === "chart-active-days-ranking") {
    return <ActiveDaysRankingCard layoutEditable={layoutEditable} />;
  }
  if (id === "chart-gender") {
    return (
      <SortableChartCard
        title="性别分布"
        loading={args.coreLoading}
        error={args.coreError}
        layoutEditable={layoutEditable}
        buildOption={(sortOrder) =>
          data.distribution ? pieOption(data.distribution.gender, sortOrder) : null
        }
      />
    );
  }
  if (id === "chart-college") {
    return (
      <SortableChartCard
        title="学院分布"
        loading={args.coreLoading}
        error={args.coreError}
        layoutEditable={layoutEditable}
        buildOption={(sortOrder) =>
          data.distribution ? barOption(data.distribution.college, true, sortOrder) : null
        }
      />
    );
  }
  if (id === "chart-grade") {
    return (
      <SortableChartCard
        title="年级分布"
        loading={args.coreLoading}
        error={args.coreError}
        layoutEditable={layoutEditable}
        buildOption={(sortOrder) =>
          data.distribution ? barOption(data.distribution.grade, false, sortOrder) : null
        }
      />
    );
  }
  if (id === "chart-device") {
    return (
      <SortableChartCard
        title="设备品牌分布"
        loading={args.coreLoading}
        error={args.coreError}
        layoutEditable={layoutEditable}
        buildOption={(sortOrder) =>
          data.distribution ? pieOption(data.distribution.deviceBrand, sortOrder) : null
        }
      />
    );
  }
  if (id === "chart-screen-views") {
    return (
      <SortableChartCard
        title="页面使用次数"
        loading={args.trackLoading}
        error={args.trackError}
        layoutEditable={layoutEditable}
        buildOption={(sortOrder) => dimBarOption(data.screenViews, sortOrder)}
      />
    );
  }
  if (id === "chart-screen-dwell") {
    return (
      <SortableChartCard
        title="页均停留时长"
        loading={args.trackLoading}
        error={args.trackError}
        layoutEditable={layoutEditable}
        buildOption={(sortOrder) => dwellBarOption(data.screenDwell, sortOrder)}
      />
    );
  }
  if (id === "chart-button-clicks") {
    return (
      <SortableChartCard
        title="按钮点击分布"
        loading={args.trackLoading}
        error={args.trackError}
        layoutEditable={layoutEditable}
        buildOption={(sortOrder) => buttonClicksBarOption(data.buttonClicks, sortOrder)}
      />
    );
  }
  if (id === "chart-perf") {
    return (
      <SortableChartCard
        title="应用性能"
        loading={args.trackLoading || args.perfLoading}
        error={args.trackError}
        layoutEditable={layoutEditable}
        extraBeforeSort={
          <Select
            size="small"
            value={args.perfRange}
            options={PERF_RANGE_OPTIONS}
            onChange={(value) => args.onPerfRangeChange(value as PerfRange)}
            className="min-w-24"
          />
        }
        buildOption={(sortOrder) => perfOption(data.perfP50, data.perfP95, sortOrder)}
      />
    );
  }
  if (id === "chart-web-vitals") {
    return (
      <SortableChartCard
        title="官网 Web Vitals"
        loading={args.trackLoading}
        error={args.trackError}
        layoutEditable={layoutEditable}
        buildOption={(sortOrder) => webVitalsOption(data.webVitalP50, data.webVitalP95, sortOrder)}
        footer={<WebVitalsGuide />}
      />
    );
  }
  return (
    <ChartCard
      title="错误捕获"
      loading={args.crashLoading && !data.crashes}
      error={args.trackError}
      empty={false}
      layoutEditable={layoutEditable}
    >
      <CrashesTable
        data={data.crashes}
        loading={args.crashLoading}
        onPageChange={args.onCrashPageChange}
      />
    </ChartCard>
  );
}

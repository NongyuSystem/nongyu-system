import { HolderOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";

export function ChartCard({
  title,
  extra,
  loading,
  error,
  empty,
  emptyText = "暂无数据",
  children,
  layoutEditable = true,
}: {
  title: string;
  extra?: ReactNode;
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyText?: string;
  children: ReactNode;
  /** 窄屏禁拖时隐藏手柄 */
  layoutEditable?: boolean;
}) {
  return (
    <div className="ny-glass flex h-full min-h-0 flex-col rounded-2xl p-3.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div
          className={
            layoutEditable
              ? "dashboard-drag-handle flex min-h-9 min-w-0 flex-1 cursor-grab items-center gap-2 rounded-lg px-0.5 active:cursor-grabbing"
              : "flex min-h-9 min-w-0 flex-1 items-center gap-2 px-0.5"
          }
          title={layoutEditable ? "按住标题拖动卡片" : undefined}
        >
          {layoutEditable ? (
            <HolderOutlined className="shrink-0 text-sm text-muted" aria-hidden />
          ) : null}
          <h2 className="truncate text-[13px] font-semibold text-ink">{title}</h2>
        </div>
        {extra ? <div className="dashboard-no-drag shrink-0">{extra}</div> : null}
      </div>
      <div className="min-h-0 flex-1">
        {error ? (
          <p className="text-[13px] text-amber-800">{error}</p>
        ) : loading ? (
          <p className="text-[13px] text-muted">加载中…</p>
        ) : empty ? (
          <p className="text-[13px] text-muted">{emptyText}</p>
        ) : (
          <div className="h-full min-h-[160px]">{children}</div>
        )}
      </div>
    </div>
  );
}

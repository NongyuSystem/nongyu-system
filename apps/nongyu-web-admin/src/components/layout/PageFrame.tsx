import type { ReactNode } from "react";

type PageFrameProps = {
  title: string;
  description?: string;
  /** 标题行主操作（新建 / 刷新等），不要放搜索与筛选 */
  actions?: ReactNode;
  /** 内容区顶部工具栏：搜索、筛选 */
  toolbar?: ReactNode;
  /** 去掉默认外层白底（如内嵌 iframe、大屏） */
  bare?: boolean;
  children: ReactNode;
  className?: string;
};

/**
 * 管理端统一页框：页名只出现在这里（顶栏不重复）。
 * 标题行 = 页名 + 主操作；工具栏 = 筛选 / 搜索，画在内容区内顶部。
 */
export function PageFrame({
  title,
  description,
  actions,
  toolbar,
  bare = false,
  children,
  className = "",
}: PageFrameProps) {
  const toolbarBlock = toolbar ? (
    <div className="mb-4 flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center [&_.ant-input-affix-wrapper]:w-full [&_.ant-select]:w-full sm:[&_.ant-input-affix-wrapper]:w-auto sm:[&_.ant-select]:w-auto">
      {toolbar}
    </div>
  ) : null;

  return (
    <div className={`mx-auto flex w-full max-w-[1400px] min-w-0 flex-col ${className}`.trim()}>
      <div className="mb-4 flex shrink-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-[20px] font-semibold leading-7 tracking-tight text-ink sm:text-[22px] sm:leading-8 md:text-[24px]">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex w-full min-w-0 shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap lg:w-auto lg:justify-end [&_button]:w-full sm:[&_button]:w-auto lg:[&_a]:w-auto">
            {actions}
          </div>
        ) : null}
      </div>
      {bare ? (
        <div className="min-h-0 min-w-0 flex-1">
          {toolbarBlock}
          {children}
        </div>
      ) : (
        <div className="ny-glass min-w-0 rounded-2xl p-3 sm:p-4 md:p-5">
          <div className="min-w-0 overflow-x-auto overscroll-x-contain">
            {toolbarBlock}
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

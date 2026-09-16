import {
  ApiOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  FileTextOutlined,
  GlobalOutlined,
  KeyOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  RobotOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Dropdown, Menu, Spin, Tooltip } from "antd";
import type { MenuProps } from "antd";
import { Suspense, lazy, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { ChangePasswordModal } from "../components/ChangePasswordModal";
import { ResizeHandle } from "../components/ResizeHandle";
import {
  ROUTES,
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from "../lib/constants";
import { useIsLg } from "../lib/responsive";
import {
  clampSidebarWidth,
  readShellLayout,
  writeShellLayout,
  type ShellLayoutPrefs,
} from "../lib/shellLayoutPrefs";
import { NongyuLogo } from "../components/brand/NongyuLogo";
import { useAuthStore } from "../stores/authStore";

/** 仅在已登录 AuthedApp 内懒加载，避免工作台首访就拉 agent-sdk */
const AssistantPanel = lazy(() =>
  import("../assistant/AssistantPanel").then((m) => ({ default: m.AssistantPanel })),
);
const MENU_ITEMS: MenuProps["items"] = [
  { key: ROUTES.workspace, icon: <AppstoreOutlined />, label: "工作台" },
  { key: ROUTES.dashboard, icon: <BarChartOutlined />, label: "数据大屏" },
  { key: ROUTES.users, icon: <TeamOutlined />, label: "用户管理" },
  { key: ROUTES.content, icon: <FileTextOutlined />, label: "内容管理" },
  { key: ROUTES.homeGreetings, icon: <MessageOutlined />, label: "首页问候" },
  { key: ROUTES.agentChatSuggestions, icon: <RobotOutlined />, label: "AI 建议" },
  { key: ROUTES.llmKeys, icon: <ApiOutlined />, label: "LLM Key 池" },
  { key: ROUTES.relatedSites, icon: <GlobalOutlined />, label: "相关网站" },
];

const MENU_KEYS = new Set(
  MENU_ITEMS.flatMap((item) => (item && "key" in item && item.key ? [String(item.key)] : [])),
);

function SideMenu({
  selectedKey,
  onSelect,
  collapsed,
}: {
  selectedKey: string;
  onSelect: (key: string) => void;
  collapsed?: boolean;
}) {
  return (
    <Menu
      className="admin-side-menu border-none bg-transparent"
      mode="inline"
      inlineCollapsed={collapsed}
      selectedKeys={MENU_KEYS.has(selectedKey) ? [selectedKey] : []}
      items={MENU_ITEMS}
      onClick={(info) => onSelect(info.key)}
    />
  );
}

function BrandBlock({ collapsed }: { collapsed?: boolean }) {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center px-1 pb-4 pt-1">
        <NongyuLogo size={36} className="rounded-lg shadow-sm" />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 px-3 pb-5 pt-1">
      <NongyuLogo size={44} className="shrink-0 shadow-sm" />
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">Nongyu</p>
        <p className="mt-0.5 text-[17px] font-semibold leading-6 tracking-tight text-ink">管理台</p>
      </div>
    </div>
  );
}

export function AdminShell() {
  const isLg = useIsLg();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantEverOpened, setAssistantEverOpened] = useState(false);
  const [layout, setLayout] = useState<ShellLayoutPrefs>(() => readShellLayout());
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const userName = user?.name ?? "管理员";
  const isBootstrap = user?.bootstrap === true;
  const logout = useAuthStore((state) => state.logout);

  const sidebarCollapsed = layout.sidebarCollapsed;
  const sidebarWidth = sidebarCollapsed
    ? SIDEBAR_WIDTH_COLLAPSED
    : clampSidebarWidth(layout.sidebarWidth);

  /** 窄屏打开侧栏/助手时锁住背后滚动，避免手势冲突 */
  useEffect(() => {
    if (isLg) return;
    const shouldLock = isDrawerOpen || assistantOpen;
    if (!shouldLock) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isLg, isDrawerOpen, assistantOpen]);

  function persistLayout(next: ShellLayoutPrefs) {
    setLayout(next);
    writeShellLayout(next);
  }

  function handleSelect(key: string) {
    navigate(key);
    setIsDrawerOpen(false);
  }

  async function handleLogout() {
    await logout();
    navigate(ROUTES.login, { replace: true });
  }

  const userMenuItems: MenuProps["items"] = [
    {
      key: "password",
      icon: <KeyOutlined />,
      label: isBootstrap ? (
        <Tooltip title="请先在农屿 App 使用该学号登录完成建档">
          <span>修改密码</span>
        </Tooltip>
      ) : (
        "修改密码"
      ),
      disabled: isBootstrap,
      onClick: () => {
        if (!isBootstrap) setPasswordOpen(true);
      },
    },
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: "登出",
      onClick: () => {
        void handleLogout();
      },
    },
  ];

  return (
    <div className="relative z-[1] min-h-screen min-h-[100dvh] bg-transparent">
      <div className="ny-canvas-wash" aria-hidden />
      {isLg ? (
        <aside
          className="ny-glass ny-glass-chrome fixed bottom-0 left-0 top-0 z-20 flex flex-col rounded-none border-y-0 border-l-0 border-r pt-[env(safe-area-inset-top)]"
          style={{ width: sidebarWidth }}
        >
          <div className="relative flex min-h-0 flex-1 flex-col px-2 py-4">
            <BrandBlock collapsed={sidebarCollapsed} />
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
              <SideMenu
                selectedKey={location.pathname}
                onSelect={handleSelect}
                collapsed={sidebarCollapsed}
              />
            </div>
            <button
              type="button"
              className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-line-soft bg-surface text-sm text-ink transition-colors hover:bg-elev"
              aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
              onClick={() => persistLayout({ ...layout, sidebarCollapsed: !sidebarCollapsed })}
            >
              {sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              {sidebarCollapsed ? null : <span>收起</span>}
            </button>
            {!sidebarCollapsed ? (
              <ResizeHandle
                edge="right"
                value={layout.sidebarWidth}
                min={SIDEBAR_WIDTH_MIN}
                max={SIDEBAR_WIDTH_MAX}
                defaultValue={SIDEBAR_WIDTH_DEFAULT}
                onChange={(next) =>
                  persistLayout({ ...layout, sidebarWidth: clampSidebarWidth(next) })
                }
              />
            ) : null}
          </div>
        </aside>
      ) : null}

      {!isLg && isDrawerOpen ? (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            className="absolute inset-0 bg-ink/30 backdrop-blur-sm"
            aria-label="关闭菜单"
            onClick={() => setIsDrawerOpen(false)}
          />
          <div className="ny-glass ny-glass-chrome absolute bottom-0 left-0 top-0 flex w-[min(280px,86vw)] flex-col overscroll-contain rounded-none px-2 pb-[env(safe-area-inset-bottom)] pt-[max(1rem,env(safe-area-inset-top))]">
            <BrandBlock />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SideMenu selectedKey={location.pathname} onSelect={handleSelect} />
            </div>
          </div>
        </div>
      ) : null}

      {/* 顶栏与侧栏同为 fixed：sticky 会被 overflow-x-hidden 与 backdrop-filter 带跑 */}
      <header
        className="ny-glass ny-glass-chrome fixed top-0 z-30 flex min-h-14 items-center justify-between gap-2 rounded-none border-x-0 border-t-0 px-3 pb-0 pt-[env(safe-area-inset-top)] sm:gap-3 sm:px-4 md:px-6"
        style={{ left: isLg ? sidebarWidth : 0, right: 0 }}
      >
        <div className="flex h-14 min-w-0 items-center gap-2.5">
          {isLg ? null : (
            <button
              type="button"
              className="ny-hit inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line-soft bg-surface text-ink transition-colors hover:bg-elev active:bg-elev"
              aria-label="打开菜单"
              onClick={() => setIsDrawerOpen(true)}
            >
              <MenuOutlined />
            </button>
          )}
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold leading-5 text-ink">农屿管理台</p>
          </div>
        </div>

        <div className="flex h-14 items-center gap-2">
          <button
            type="button"
            className={`ny-hit inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-ink transition-colors active:bg-elev ${
              assistantOpen
                ? "border-brand/40 bg-elev text-brand"
                : "border-line-soft bg-surface hover:bg-elev"
            }`}
            aria-label={assistantOpen ? "关闭智慧助手" : "打开智慧助手"}
            onClick={() => {
              setAssistantOpen((prev) => {
                const next = !prev;
                if (next) setAssistantEverOpened(true);
                return next;
              });
            }}
          >
            <RobotOutlined />
          </button>

          <Dropdown trigger={["click"]} menu={{ items: userMenuItems }}>
            <button
              type="button"
              aria-label={userName}
              className="ny-hit inline-flex h-11 max-w-[7.5rem] items-center gap-2 rounded-xl border border-line-soft bg-surface px-2.5 text-sm font-medium text-ink transition-colors hover:bg-elev active:bg-elev sm:max-w-none sm:px-3"
            >
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-muted text-[11px] font-semibold text-brand">
                {userName.slice(0, 1)}
              </span>
              <span className="hidden truncate sm:inline">{userName}</span>
              {isBootstrap ? (
                <span className="hidden text-xs font-normal text-muted md:inline">未建档</span>
              ) : null}
            </button>
          </Dropdown>
        </div>
      </header>

      <div
        className="flex min-h-screen min-h-[100dvh] min-w-0 flex-col overflow-x-clip pt-[calc(3.5rem+env(safe-area-inset-top,0px))]"
        style={isLg ? { marginLeft: sidebarWidth } : undefined}
      >
        <main className="flex-1 px-3 py-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-4 md:px-6 md:py-6">
          {isBootstrap ? (
            <div className="mb-4 rounded-xl border border-amber-200/80 bg-amber-50 px-4 py-3 text-[13px] leading-5 text-amber-950">
              当前为超级管理员引导会话：可浏览工作台，业务管理接口需先在农屿 App
              使用该学号登录完成建档。
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>

      <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
      {assistantEverOpened ? (
        <Suspense
          fallback={
            assistantOpen ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 backdrop-blur-[1px]">
                <Spin size="large" tip="加载智慧助手…" />
              </div>
            ) : null
          }
        >
          <AssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} />
        </Suspense>
      ) : null}
    </div>
  );
}

import {
  ApiOutlined,
  BarChartOutlined,
  FileTextOutlined,
  GlobalOutlined,
  MessageOutlined,
  RobotOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ROUTES } from "../lib/constants";
import { useAuthStore } from "../stores/authStore";

type ModuleCard = {
  to: string;
  title: string;
  description: string;
  icon: ReactNode;
};

/** 与侧栏除「工作台」外的菜单顺序一致 */
const MODULES: ModuleCard[] = [
  {
    to: ROUTES.dashboard,
    title: "数据大屏",
    description: "运行指标与用户行为",
    icon: <BarChartOutlined />,
  },
  {
    to: ROUTES.users,
    title: "用户管理",
    description: "角色、状态与档案",
    icon: <TeamOutlined />,
  },
  {
    to: ROUTES.content,
    title: "内容管理",
    description: "公告、反馈与建议",
    icon: <FileTextOutlined />,
  },
  {
    to: ROUTES.homeGreetings,
    title: "首页问候",
    description: "App 打招呼第二句",
    icon: <MessageOutlined />,
  },
  {
    to: ROUTES.agentChatSuggestions,
    title: "AI 建议",
    description: "空态快捷建议配置",
    icon: <RobotOutlined />,
  },
  {
    to: ROUTES.llmKeys,
    title: "LLM Key 池",
    description: "代理密钥与失败记录",
    icon: <ApiOutlined />,
  },
  {
    to: ROUTES.relatedSites,
    title: "相关网站",
    description: "云厂商、官网与发版入口",
    icon: <GlobalOutlined />,
  },
];

export function WorkspacePage() {
  const name = useAuthStore((state) => state.user?.name ?? "管理员");

  return (
    <div className="mx-auto max-w-[1100px]">
      <section className="ny-glass relative rounded-2xl px-4 py-5 sm:px-5 sm:py-6 md:px-7 md:py-8">
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-2xl bg-brand/70"
          aria-hidden
        />
        <p className="text-[11px] font-semibold tracking-[0.14em] text-brand">工作台</p>
        <h1 className="mt-2 text-[22px] font-semibold leading-7 tracking-tight text-ink sm:text-[26px] sm:leading-8 md:text-[28px]">
          你好，{name}
        </h1>
        <p className="mt-2 max-w-xl text-[14px] leading-6 text-muted">
          从这里进入各业务模块。
          <span className="hidden lg:inline">侧栏可随时切换；</span>
          <span className="lg:hidden">左上角菜单可切换模块；</span>
          右上角可打开智慧助手做只读问数。
        </p>
      </section>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:mt-5 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((mod) => (
          <Link
            key={mod.to}
            to={mod.to}
            className="ny-glass ny-glass-lift group flex min-h-[4.5rem] items-start gap-3.5 rounded-2xl p-4"
          >
            <span className="ny-module-mark inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-base">
              {mod.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold leading-5 text-ink">
                {mod.title}
              </span>
              <span className="mt-1 block text-[13px] leading-5 text-muted">{mod.description}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

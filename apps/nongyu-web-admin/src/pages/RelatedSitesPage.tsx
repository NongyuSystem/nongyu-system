import { ExportOutlined, LinkOutlined } from "@ant-design/icons";
import {
  RELATED_SITE_ALIYUN_URL,
  RELATED_SITE_GITHUB_URL,
  RELATED_SITE_NONGYU_URL,
  RELATED_SITE_PUSHY_URL,
  RELATED_SITE_TENCENT_URL,
} from "../lib/constants";
import { PageFrame } from "../components/layout/PageFrame";

const LINKS = [
  { name: "阿里云", url: RELATED_SITE_ALIYUN_URL, hint: "云资源与控制台" },
  { name: "腾讯云", url: RELATED_SITE_TENCENT_URL, hint: "云资源与控制台" },
  { name: "农屿官网", url: RELATED_SITE_NONGYU_URL, hint: "品牌官网实时预览" },
  { name: "Pushy", url: RELATED_SITE_PUSHY_URL, hint: "App 热更与发版控制台" },
  {
    name: "GitHub",
    url: RELATED_SITE_GITHUB_URL,
    hint: "农屿 monorepo 源码仓库",
  },
] as const;

/**
 * 相关网站：云厂商 / Pushy / GitHub 外链 + 农屿官网手机尺寸 iframe 预览
 * Spec：docs/nongyu-web-admin/specs/相关网站.md
 */
export function RelatedSitesPage() {
  return (
    <PageFrame
      title="相关网站"
      description="云厂商、农屿官网、Pushy 与 GitHub 便捷入口。农屿官网以下方手机框实时预览；若嵌入被拦截，请用外链打开。"
      bare
    >
      <div className="flex flex-col gap-8">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink">快捷跳转</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {LINKS.map((item) => (
              <a
                key={item.name}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ny-glass ny-glass-lift group flex min-h-[5.5rem] flex-col justify-between rounded-2xl p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[15px] font-semibold text-ink">{item.name}</span>
                  <ExportOutlined className="text-muted transition-colors group-hover:text-brand" />
                </div>
                <p className="mt-2 text-[13px] leading-5 text-muted">{item.hint}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand">
                  <LinkOutlined />
                  新窗口打开
                </span>
              </a>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">农屿官网 · 手机预览</h2>
            <a
              href={RELATED_SITE_NONGYU_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-line-soft bg-surface px-3 text-sm text-ink transition-colors hover:bg-elev"
            >
              <ExportOutlined />
              新窗口打开
            </a>
          </div>

          <div className="flex justify-center sm:justify-start">
            <div className="w-full max-w-[390px]">
              <div className="overflow-hidden rounded-[2rem] border-[10px] border-ink bg-ink shadow-panel">
                <div className="flex h-7 items-center justify-center bg-ink">
                  <span className="h-1.5 w-16 rounded-full bg-white/25" />
                </div>
                <div className="bg-canvas h-[min(70dvh,780px)] sm:h-[780px]">
                  <iframe
                    title="农屿官网手机预览"
                    src={RELATED_SITE_NONGYU_URL}
                    className="h-full w-full border-0"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </div>
              </div>
            </div>
          </div>
          <p className="mt-3 max-w-xl text-[12px] leading-5 text-muted">
            预览约 390×844。目标站若设置禁止嵌入或当前页为 HTTPS 而目标为 HTTP，iframe
            可能空白，请使用上方外链。
          </p>
        </section>
      </div>
    </PageFrame>
  );
}

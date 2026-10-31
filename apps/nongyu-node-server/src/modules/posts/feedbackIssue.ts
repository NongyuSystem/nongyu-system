import { getEnv } from "../../config/env.js";
import { createLogger } from "../../lib/logger.js";
import { createGitHubIssue, parseRepoSlug } from "../../lib/github/issueClient.js";

const logger = createLogger();

/** 反馈墙 subtype → 中文标签；未知值原样展示 */
const FEEDBACK_SUBTYPE_LABELS: Record<string, string> = {
  feedback: "反馈",
  suggestion: "建议",
  bug: "Bug",
};

export type FeedbackSyncInput = {
  postId: number;
  subtype: string;
  title: string;
  content: string;
};

/** Issue 标题：统一 `[反馈墙]` 前缀，便于仓库内按前缀检索 */
export function buildIssueTitle(title: string): string {
  const trimmed = title.trim();
  return `[反馈墙] ${trimmed}`;
}

/** 反馈内容全文按代码块包裹，保留换行并避免 Markdown 结构被内容破坏 */
export function buildIssueBody(input: FeedbackSyncInput): string {
  const subtypeLabel = FEEDBACK_SUBTYPE_LABELS[input.subtype] ?? input.subtype;
  const lines = [
    "### 反馈内容",
    "",
    "```text",
    input.content.trim(),
    "```",
    "",
    "---",
    "",
    "| 项目 | 值 |",
    "| --- | --- |",
    `| 帖子 ID | ${input.postId} |`,
    `| 分区 | 反馈墙 |`,
    `| 标签 | ${subtypeLabel} |`,
    "",
    "> 由农屿反馈墙帖子自动同步生成，请勿手动关闭以外的方式删除。",
  ];
  return lines.join("\n");
}

/** 配置是否就绪：Token 与 Repo 均非空才启用同步 */
export function isFeedbackIssueSyncEnabled(): boolean {
  const env = getEnv();
  return Boolean(env.GITHUB_TOKEN.trim() && env.GITHUB_REPO.trim());
}

/**
 * 异步把反馈墙帖子同步为 GitHub Issue。
 * 永不抛错：发帖主流程不受影响，失败仅记录日志。
 */
export function syncFeedbackIssueAsync(input: FeedbackSyncInput): void {
  void runSyncFeedbackIssue(input).catch((err) => {
    logger.error({ err, postId: input.postId }, "feedback issue sync failed");
  });
}

async function runSyncFeedbackIssue(input: FeedbackSyncInput): Promise<void> {
  const env = getEnv();
  const repoSlug = parseRepoSlug(env.GITHUB_REPO);
  if (!repoSlug) {
    logger.warn({ repo: env.GITHUB_REPO }, "GITHUB_REPO 格式非法，跳过反馈墙同步");
    return;
  }

  const labels = env.GITHUB_ISSUE_LABEL.trim() ? [env.GITHUB_ISSUE_LABEL.trim()] : [];

  const created = await createGitHubIssue(repoSlug, {
    title: buildIssueTitle(input.title),
    body: buildIssueBody(input),
    labels,
  });

  logger.info(
    { postId: input.postId, issueNumber: created.number, issueUrl: created.htmlUrl },
    "feedback issue created",
  );
}

import { getEnv } from "../../config/env.js";
import { createLogger } from "../logger.js";

/** GitHub REST API 根地址 */
const GITHUB_API_BASE = "https://api.github.com";
/** 连续两次失败之间的退避间隔 */
const RETRY_DELAY_MS = 300;
/** GitHub issue title 上限 */
const MAX_TITLE_LENGTH = 256;
/** GitHub issue body 上限为 65536，预留余量后截断正文 */
const MAX_BODY_LENGTH = 60_000;

export type GitHubRepoSlug = {
  owner: string;
  repo: string;
};

export type GitHubIssueInput = {
  title: string;
  body: string;
  labels: string[];
};

export type GitHubIssueCreated = {
  number: number;
  htmlUrl: string;
  title: string;
};

const logger = createLogger();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max);
}

/**
 * 解析 `owner/name` 仓库标识；非法（缺斜杠、多段、含空段）返回 null。
 * 仓库标识走环境变量，必须在拼 URL 前做格式校验，避免请求打到非预期路径。
 */
export function parseRepoSlug(raw: string): GitHubRepoSlug | null {
  const value = raw.trim();
  if (!value) return null;
  const match = /^([A-Za-z0-9._-]{1,100})\/([A-Za-z0-9._-]{1,100})$/.exec(value);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/** 组装 issue URL；repo 必须是 parseRepoSlug 校验过的值 */
export function issueApiUrl(repo: GitHubRepoSlug): string {
  return `${GITHUB_API_BASE}/repos/${repo.owner}/${repo.repo}/issues`;
}

/**
 * 在仓库上创建一条 issue。
 *
 * - Token 未配置直接抛错，不发请求。
 * - 网络异常 / 5xx / 429 会退避后重试一次；其余 4xx（Token 无权限等）不重试。
 * - 抛出的错误只带状态码与 GitHub 返回片段，不含 Token。
 */
export async function createGitHubIssue(
  repo: GitHubRepoSlug,
  input: GitHubIssueInput,
): Promise<GitHubIssueCreated> {
  const env = getEnv();
  const token = env.GITHUB_TOKEN.trim();
  if (!token) {
    throw new Error("GITHUB_TOKEN 未配置，无法创建 GitHub Issue");
  }

  const url = issueApiUrl(repo);
  const payload = JSON.stringify({
    title: clipText(input.title.trim(), MAX_TITLE_LENGTH),
    body: clipText(input.body, MAX_BODY_LENGTH),
    labels: input.labels,
  });

  let lastError: unknown = new Error("GitHub Issue 创建未执行");
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const isLastAttempt = attempt === 2;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: payload,
        signal: AbortSignal.timeout(env.GITHUB_ISSUE_TIMEOUT_MS),
      });

      if (response.ok) {
        const data: unknown = await response.json();
        if (!isRecord(data)) {
          throw new Error("GitHub Issue 创建响应格式非法");
        }
        const htmlUrl = typeof data.html_url === "string" ? data.html_url : "";
        return {
          number: Number(data.number ?? 0),
          htmlUrl,
          title: typeof data.title === "string" ? data.title : "",
        };
      }

      const text = await response.text().catch(() => "");
      lastError = new Error(
        `GitHub Issue 创建失败 status ${response.status}: ${text.slice(0, 200)}`,
      );

      // 4xx（除 429 限流）多为权限/参数问题，重试无意义，直接结束
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw lastError;
      }
    } catch (err) {
      lastError = err;
    }

    logger.warn({ attempt, url, err: lastError }, "github issue create attempt failed");
    if (!isLastAttempt) {
      await sleep(RETRY_DELAY_MS);
    }
  }

  throw lastError;
}

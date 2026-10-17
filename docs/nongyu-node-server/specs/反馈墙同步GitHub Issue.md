# Spec：反馈墙帖子自动同步 GitHub Issue

> 状态：**已确认并实现**（单测已通过）
> 需求归类：**基建需求**（GitHub 集成能力，挂在既有发帖链路上）
> 服务：`nongyu-node-server`
> 关联文档：`docs/nongyu-node-server/接口文档概览.md`、`docs/nongyu-node-server/部署与发布.md`
> 日期：2026-08-22

---

## 1. 背景

农屿 App「广场 · 反馈墙」是用户反馈的主入口。目前反馈只落在 MySQL `posts` 表（`post_type='feedback'`），
管理员需要在后台逐条翻阅，缺漏与追踪都不方便，也无法沉淀为可指派、可标记完成的工单。

仓库 `NongyuSystem/nongyu-system` 的 GitHub Issues 已是本项目的需求/工单追踪面（见
`docs/agents/issue-tracker.md`）。把每条反馈墙帖子同步成一条关联 Issue，即可复用现有的 label、
指派、评论、关闭体系来跟进用户反馈。

本次只做「新增」方向：帖子发出即建 Issue；帖子后续被作者删除**不**级联删除 Issue，Issue 永久保留。

## 2. 目标

- App 端 `POST /api/app/posts` 发出 `postType=feedback` 的帖子并落库成功后，自动在配置的
  GitHub 仓库创建一条关联 Issue。
- Issue 内容与该帖子基本对齐：标题取帖子标题，正文含帖子 ID、分区、标签（subtype）与反馈内容全文。
- 仅 `feedback` 生效；`courtyard`（大院）与管理端发的 `announcement` 不建 Issue。
- 建 Issue 失败绝不影响发帖主流程：不阻塞响应、不回滚帖子、不把错误抛给客户端，仅写服务端日志。
- 凭证通过环境变量注入，不硬编码、不入库。

## 3. 边界（非目标）

| 非目标                       | 说明                                                       |
| ---------------------------- | ---------------------------------------------------------- |
| 删除 / 关闭 / 编辑同步       | 本版只新增；作者删帖不动 Issue；管理员后台操作也不同步     |
| 帖子编辑同步                 | `POST /api/app/posts` 无编辑入口（发布后不可改），故不需要 |
| 反查回写 Issue 号            | 不在 `posts` 加 `github_issue_number` 字段、不做 migration |
| 防重 / 去重                  | 不加幂等判断，每发一帖建一条 Issue                         |
| 跨仓库 / 自定义模板界面      | 仓库与 label 走 env 配置；不做管理端配置页                 |
| `courtyard` / `announcement` | 不建 Issue                                                 |
| 作者身份入库                 | Issue 不带学号/姓名，延续广场对用户匿名的口径              |

## 4. 详细需求

### 4.1 环境变量（基建配置）

| 变量                      | 必填 | 默认       | 说明                                                                                          |
| ------------------------- | ---- | ---------- | --------------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`            | 否   | 空         | GitHub Personal Access Token（`repo` 权限）。**为空则该能力整体关闭**，发帖行为与现网完全一致 |
| `GITHUB_REPO`             | 否   | 空         | 目标仓库，格式 `owner/name`，如 `NongyuSystem/nongyu-system`。与 Token 同时非空才生效         |
| `GITHUB_ISSUE_LABEL`      | 否   | `feedback` | 新 Issue 附带 label；留空则只建不打标                                                         |
| `GITHUB_ISSUE_TIMEOUT_MS` | 否   | `8000`     | 单次调用 GitHub API 超时                                                                      |

- `GITHUB_TOKEN` / `GITHUB_REPO` 只写 `.env`（已 gitignore），并补进 `.env.example` 说明。

### 4.2 触发点

`appPostsRouter.post("/")`（`src/modules/posts/routes.ts`）在 `insertPost` 返回后：

```text
if (postType === "feedback") → 异步触发同步（不 await，不阻塞响应）
```

异步任务内部自行 catch 一切异常：

- 未配置 Token/Repo → 静默跳过（不视为错误）
- Repo 格式非法 → warn 日志，跳过
- 调用失败（网络错误、非 2xx、超时）→ error 日志，最多重试 1 次
- 任何情况下不向响应链路抛错，不改发帖接口返回结构（仍为 `{ id }`）

### 4.3 Issue 内容映射

| Issue 字段 | 来源                                           | 规则                                                                               |
| ---------- | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `title`    | `posts.title`                                  | `[反馈墙] {title}`；trim；超长按 GitHub 256 上限截断                               |
| `body`     | `posts.id` / `posts.subtype` / `posts.content` | Markdown：标题行 + 元信息表（帖子 ID、分区=反馈墙、标签）+ 反馈内容全文 + 说明尾注 |
| `labels`   | env                                            | `GITHUB_ISSUE_LABEL` 非空时 `[label]`                                              |

`subtype` → 中文标签映射：`feedback=反馈`、`suggestion=建议`、`bug=Bug`，未知值原样展示。

**不写入**：作者学号、姓名、设备号等身份信息（广场对用户彼此匿名，Issue 公开可读）。

### 4.4 实现约束

- GitHub 调用用原生 `fetch` + `AbortSignal.timeout`，不引第三方 SDK；无新依赖。
- 代码拆分：
  - `src/lib/github/issueClient.ts`：通用 GitHub Issue 创建客户端（URL/鉴权/重试/日志）。
  - `src/modules/posts/feedbackIssue.ts`：反馈墙字段 → Issue 内容的映射与异步编排。
  - `src/modules/posts/routes.ts`：发帖成功后按条件触发。
  - `src/config/env.ts`：新增 4 个 env 字段（均有默认值，不影响既有部署）。
- 日志用 `createLogger()`（pino），不打 Token。

## 5. 业务流程

```text
App 用户在反馈墙发帖
  → POST /api/app/posts（App JWT）
  → Zod 校验 → insertPost 落库
  → 返回 { id }（不等 GitHub）
  └─(异步) postType === "feedback" 且已配置 GITHUB_TOKEN + GITHUB_REPO
       → POST https://api.github.com/repos/{owner}/{repo}/issues
         Authorization: Bearer TOKEN
       → 成功 / 失败均只写日志
```

## 6. 验收标准与测试方案

### 6.1 验收

| #   | 场景                                   | 期望                                                                                                                      |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | 未配置 `GITHUB_TOKEN`                  | 发 `feedback` 帖照常成功，无网络请求、无错误日志噪声                                                                      |
| 2   | 已配置 Token + Repo                    | 发 `feedback` 帖成功，仓库新增一条 Issue，标题 `[反馈墙] {标题}`，正文含帖子 ID 与内容全文，带 `GITHUB_ISSUE_LABEL` label |
| 3   | 发 `courtyard` 帖                      | 不创建 Issue                                                                                                              |
| 4   | 管理端 `POST /api/admin/posts`（公告） | 不创建 Issue                                                                                                              |
| 5   | 作者删帖后                             | 已创建的 Issue 仍存在，不被删除、不被关闭                                                                                 |
| 6   | GitHub 不可达 / Token 失效             | 发帖仍返回成功；服务端日志记录失败（含重试）                                                                              |
| 7   | `GITHUB_REPO` 格式非法（如 `abc`）     | 跳过并 warn，不影响发帖                                                                                                   |
| 8   | Issue 内容                             | 不含作者学号/姓名                                                                                                         |

### 6.2 测试方案

- Vitest 单测（`tests/feedbackIssue.test.ts`）：映射函数输出、开关判定、URL 组装、非法 repo 处理。
- 联调：本机 `.env` 填真实 Token + `GITHUB_REPO`，App/联调 Token 发一条 feedback 帖，确认 Issue 落地。
- CI 不跑外网调用（单测只覆盖纯函数与开关判定）。

## 7. 已对齐决策摘要

- 基建需求；只做新增，不做删除/编辑同步；删帖不删 Issue。
- 仅 `feedback`；异步不阻塞；失败仅日志。
- Token + Repo 走 env，空则整体关闭；label 可配置。
- Issue 内容对齐帖子（标题/正文/帖子 ID/标签），不含作者身份。
- 无 DB 变更、无新依赖。

---

**本 Spec 已由用户确认，代码已按此实现：**

- `src/lib/github/issueClient.ts`：`parseRepoSlug` / `issueApiUrl` / `createGitHubIssue`
- `src/modules/posts/feedbackIssue.ts`：`buildIssueTitle` / `buildIssueBody` / `isFeedbackIssueSyncEnabled` / `syncFeedbackIssueAsync`
- `src/modules/posts/routes.ts`：`POST /api/app/posts` 落库后按条件异步触发
- `src/config/env.ts`：`GITHUB_TOKEN` / `GITHUB_REPO` / `GITHUB_ISSUE_LABEL` / `GITHUB_ISSUE_TIMEOUT_MS`
- `tests/feedbackIssue.test.ts`：14 个单测（映射、开关、URL 组装、非法 repo）

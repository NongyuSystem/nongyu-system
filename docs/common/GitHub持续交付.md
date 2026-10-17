# 农屿 · GitHub Actions 持续交付

| 项       | 内容                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------- |
| 状态     | 已落地（2026-08-21）                                                                               |
| 需求类型 | 基建                                                                                               |
| 范围     | 官网、管理端、Node 业务后端、Node 埋点后端（Go 埋点已下线，不在 CD 内）；**不含** RN / EAS / Pushy |
| 原则     | 只做持续交付。CR、lint、单测、type-check 在开发者本机 commit 前完成（husky + 本地门禁）            |

---

## 1. 行为

`main` 收到 push 后，按路径判断四个线上项目是否有代码变更；有则在 GitHub-hosted Ubuntu 上构建 Linux 产物，SSH 覆盖现网目录，并做**带健康检查的重启/回滚**。

| 线上项目      | 监听路径                                                                                                                       | 发布动作                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| 官网          | `apps/nongyu-web-site/**`                                                                                                      | Vite `dist` → `/var/www/site`，nginx reload   |
| 管理端        | `apps/nongyu-web-admin/**`、`packages/nongyu-agent-sdk/**`、`packages/nongyu-tool-jiaowu/**`、`packages/nongyu-tool-second/**` | 先编 workspace 依赖再 Vite → `/var/www/admin` |
| Node 业务后端 | `apps/nongyu-node-server/**`                                                                                                   | `tsup` dist + `package.json`，systemd 重启    |
| Node 埋点后端 | `apps/nongyu-node-track-server/**`、`packages/nongyu-track-contract/**`                                                        | `tsup` dist + `package.json`，systemd 重启    |

四个 job **互不绑定**：只改官网不会动 Node / Track。可并行。同一目标并发用 `concurrency` 排队，不取消进行中的发布。

手动补发：Actions → **CD** → Run workflow，选 `all` / `site` / `admin` / `node` / `track`。

## 2. 不做

- 不在 Actions 里跑 oxlint、vitest、`go test`、业务 CR
- 不自动 `migrate`、不同步服务器 `.env`、不上传 SQLite / `node_modules`
- 不在 Track 机编译、不在 WEB 机装 pnpm
- 不发布 RN / EAS / Pushy
- 本机保存文件不会触发发布；只有 push 到 `origin/main`（或手动 dispatch）

## 3. 安全重启

- **静态站**：解压到 `.next` 目录，确认存在 `index.html` 后再 rsync/交换进直播目录；随后 `nginx -t && reload`
- **Node / Track**：先备份当前 `dist` / 二进制，重启后轮询本机 `/health`；失败则用备份恢复并再次重启，job 失败

## 4. 仓库 Secrets（Settings → Secrets and variables → Actions）

明文 IP / 私钥 **禁止入库**。三项各一套：

| Secret           | 含义                         |
| ---------------- | ---------------------------- |
| `WEB_SSH_HOST`   | 官网/管理端机公网 IP         |
| `WEB_SSH_USER`   | SSH 用户（现网多为 `root`）  |
| `WEB_SSH_KEY`    | 部署专用私钥全文（含首尾行） |
| `NODE_SSH_HOST`  | Node 业务机公网 IP           |
| `NODE_SSH_USER`  | SSH 用户                     |
| `NODE_SSH_KEY`   | 部署专用私钥全文             |
| `TRACK_SSH_HOST` | Track 机公网 IP              |
| `TRACK_SSH_USER` | SSH 用户                     |
| `TRACK_SSH_KEY`  | 部署专用私钥全文             |

公钥须已写入对应机 `authorized_keys`。远端目录与单元名与现网文档一致，写死在 workflow 中，不进 Secret：

- 官网 `/var/www/site`，管理端 `/var/www/admin`
- Node `/opt/nongyu-node`，单元 `nongyu-node.service`，健康检查 `http://127.0.0.1:3000/health`
- Track `/usr/local/bin/nongyu-track`，单元 `nongyu-track.service`，健康检查 `http://127.0.0.1:8081/health`

## 5. 本机脚本

`scripts/deploy-nongyu-*.ps1` 仍作断网/密钥应急。日常以 GitHub CD 为准。

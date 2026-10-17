# Go 埋点后端迁移至 Node 技术方案

| 项        | 内容                                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态      | **决策已锁定**；Spec/计划已确认；**实施中**                                                                                                                |
| 关联计划  | `docs/nongyu-go-track-server/plans/埋点服务迁移至Node.md`                                                                                                  |
| 需求类型  | **基建**                                                                                                                                                   |
| 文档范围  | **用 Node 埋点服务替换** 现网 Go 埋点；仍部署在 **原 Track 独立机**                                                                                        |
| 关联 Spec | `docs/nongyu-go-track-server/specs/埋点服务迁移至Node.md`                                                                                                  |
| 依据      | `接口文档.md`、`tech/埋点服务技术方案.md`、`技术选型.md`、`tech/埋点迁移压测报告.md`（原 `scripts/track-migration-bench/REPORT.md`，脚本已随迁移完成清理） |
| 非目标    | 不把埋点原始事件并入业务 MySQL；**永不**与业务 `nongyu-node-server` 同机部署或同进程合并                                                                   |

---

## 0. 部署铁律（先读）

| 铁律                       | 说明                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **替换，不是并存长期双栈** | Node 埋点上线并验证通过后，**下线 Go 埋点**；目标是同一职责换实现语言                                                                    |
| **机器专属**               | Track 那台云主机 **只有埋点相关进程**（Nginx + Track 服务 + SQLite）；**没有**、也 **不会有** 业务 Node / MySQL 等同机计划               |
| **与业务 Node 的关系**     | 仅通过 **公网/内网 HTTP** 交互（BFF 查指标、Track 回写在线态）；两台机器、两套发布，职责分离不变                                         |
| **代码仓库**               | monorepo 内用 **独立 package**（如 `apps/nongyu-node-track-server`），即使与业务同仓，也 **不得** 做成「部署到业务机」或「并进业务进程」 |

---

## 1. 背景与决策依据

### 1.1 现状

- Track 跑在 **独立轻量云**（约 2C2G），该机专用于埋点；Nginx 终止 TLS，进程监听 `127.0.0.1:8081`。
- 实现：Go + SQLite（WAL）+ systemd `nongyu-track`。
- 调用关系（跨机）：
  - App → Track：`POST /v1/track/events`（App JWT）
  - 业务 Node / 内部 → Track：`POST /v1/internal/events`（Internal Token）
  - Admin → 业务 Node BFF → Track Admin API（Internal Token）
  - Track → 业务 Node：在线态回写 `users.is_online` / `last_active_at`

### 1.2 为何考虑迁移

- 团队以 TypeScript / 前端为主，Go 增加发布链路、排障与协作成本。
- 农屿规模（≤1000 用户量级）下，Go 相对 Node 的性能优势用不满。
- **2026-08-29 在 Track 独立机上的写入压测**（约 30 batch/s × 40 事件 ≈ 1200 events/s，高于千人预估峰值）：
  - Go / Node+SQLite 最小 PoC 均为 100% 成功；
  - 延迟 p95 均为个位数 ms；
  - 压测中 RSS 峰值约 62MB vs 68MB。
- 结论：**性能侧不构成必须保留 Go 的硬约束**；迁移主收益是技术栈统一。**部署拓扑不变：仍是「一机一埋点」。**

### 1.3 迁移原则（硬约束）

| 原则     | 说明                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------- |
| 原地替换 | 在 **同一台 Track 机** 上用 Node 进程替换 Go 进程；公网入口 / Nginx / 数据目录沿用                   |
| 契约优先 | HTTP 路径、鉴权、请求/响应形状、错误码与 `接口文档.md` **保持兼容**，避免强制 App / Admin / BFF 大改 |
| 存储不变 | 继续 **嵌入式 SQLite**；继续使用现有 `track.db` schema（迁移脚本可复用现网 migrations）              |
| 机器隔离 | Track 机 **禁止** 部署业务 Node、业务 MySQL 或其他业务服务（现网如此，迁移后仍如此）                 |
| 可回滚   | 切换窗口内保留 Go 二进制与 db 备份，失败可分钟级切回                                                 |
| 分阶段   | 契约对等 → 影子验证 → 切流量 → 下线 Go；**不包含**与业务合并部署的阶段                               |

---

## 2. 目标架构（迁移后）

```text
                    【业务机 — 永不与 Track 同机】
┌─────────────────────────────────────────────┐
│  nongyu-node-server（业务 API + MySQL）       │
│    ▲ BFF 查指标          │ 在线态回写         │
└────┼─────────────────────┼──────────────────┘
     │                     │
     │              【Track 独立机 — 整机只跑埋点】
     │         ┌───────────┴───────────────────┐
公网 App ──HTTPS──► Nginx :443                  │
                   │ proxy_pass                 │
                   ▼                            │
            127.0.0.1:8081                      │
            nongyu-node-track（Node 替换原 Go）   │
                   │                            │
                   ▼                            │
            SQLite /var/lib/nongyu-track/       │
            └───────────────────────────────────┘
```

### 2.1 代码包

| 项   | 锁定                                                        |
| ---- | ----------------------------------------------------------- |
| 路径 | `apps/nongyu-node-track-server`（独立 package）             |
| 进程 | Track 机上 **唯一** 业务应用进程（外加 Nginx）              |
| 禁止 | 与 `nongyu-node-server` 同机、同 systemd 单元、同 Node 进程 |

> 与业务同属 monorepo 只为共享工程规范与 CI 模板；**运行时与机器边界与现网 Go Track 完全一致。**

---

## 3. 功能对等清单（必须 100% 覆盖）

### 3.1 HTTP 面

| 模块                              | 路径                                      | 优先级         |
| --------------------------------- | ----------------------------------------- | -------------- |
| Health                            | `GET /health`                             | P0             |
| App 上报                          | `POST /v1/track/events`                   | P0             |
| App 离线                          | `POST /v1/track/presence/offline`         | P0             |
| 内部写入                          | `POST /v1/internal/events`                | P0             |
| Admin 概览/趋势/维度/崩溃/LLM失败 | `/v1/admin/*`                             | P0（BFF 依赖） |
| Admin SQL                         | `POST /v1/admin/sql/query`                | P0             |
| 运维任务                          | `POST /v1/admin/jobs/aggregate`、`/purge` | P1             |

响应包继续使用 Track 约定 `{ ok, data }` / `{ ok:false, error }`，**不要**改成 Node 业务的 `{ code, message, data }`。

### 3.2 核心领域行为

| 能力           | 现网行为（须保留）                                                 |
| -------------- | ------------------------------------------------------------------ |
| 事件校验       | `event_type` 白名单、字段校验、props 大小截断策略与现网一致        |
| 幂等           | `event_id` UNIQUE；重复计入 `duplicated`                           |
| 写入模型       | **单 writer 串行**（队列 + 批量事务）；队列满返回 `503 QUEUE_FULL` |
| Presence       | App 通道更新本地 `user_presence`；内部通道可 `SkipPresence`        |
| 超时离线扫描   | 定时扫描超时在线用户 → 置离线 → 回写 Node                          |
| usersync       | 合并/重试回写 Node internal presence API；离线优先 flush           |
| 日聚合         | 每日 00:10 聚合昨日；启动补跑未成功任务                            |
| 在线峰值       | 定时采样 `CountOnline` → `BumpPeak`                                |
| 清理           | 定时 purge 超期原始事件（现网约 30 天）                            |
| 限流           | IP / User 令牌桶；默认量级与现网接近（可 env 化）                  |
| 今日 live 查询 | overview/dims/trend 对「今天」走 events 实时统计 + 短缓存策略对齐  |

### 3.3 明确不做（含长期禁止）

- 改 SQLite → MySQL
- 改 App 上报 URL 协议（除切到同一公网入口）
- 多实例水平扩展写
- 用 Worker 线程重写一切（先单进程跑通，再按需优化）
- **业务 Node 与埋点 Node 同机部署 / 同进程合并**（现在不做，以后也不做）
- 在 Track 机上安装/运行业务 MySQL 或其他业务服务

---

## 4. 技术选型（Node 侧）

| 项       | 建议                                              | 说明                                                                                                                                                   |
| -------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 运行时   | **与业务 Node 同版本**                            | 锁定与 `nongyu-node-server` 现网一致（当前业务机为 **Node v21.7.3**）；`engines`、CD `setup-node`、Track 机安装路径均对齐；业务升主版本时 Track 同步升 |
| HTTP     | **Fastify**（已锁定）                             | 相对 Express 更偏轻量/高性能 JSON API；埋点服务不追求与业务 Express 同构                                                                               |
| SQLite   | **better-sqlite3**（已锁定）                      | 单 writer 友好；Track 机需具备编译原生模块的工具链（gcc 等，现网已有）                                                                                 |
| 事件类型 | **与埋点 SDK 类型对齐**                           | 见 §4.2；共享契约，禁止各写一套 drift                                                                                                                  |
| 鉴权     | 复用与业务相同的 JWT 校验逻辑（`typ=app`、`uid`） | 与 Go 一样不强制实时 tokenVersion（一期契约）                                                                                                          |
| 配置     | dotenv / systemd `EnvironmentFile`                | 键名尽量兼容现 `/etc/nongyu-track.env`                                                                                                                 |
| 日志     | pino（JSON）                                      | 对齐可观测习惯                                                                                                                                         |
| 构建     | tsup 编译为 `dist`（与业务 Node 同手法）          | 发布物不要依赖源码直跑                                                                                                                                 |
| 测试     | Vitest + 契约回归（ingest / admin / sqlguard）    | 优先把 Go 现有测试语义迁成 TS                                                                                                                          |

### 4.1 单 writer 设计（关键）

SQLite 写入仍应串行，避免 `SQLITE_BUSY` 风暴：

```text
HTTP handlers
   │ enqueue(batch)
   ▼
memory queue (bounded)
   │
   ▼
单 worker：BEGIN → 校验/插入/presence → COMMIT → 回包
```

语义对齐 Go：`Enqueue` 阻塞等待结果；队列满 → `QUEUE_FULL`。

### 4.2 与埋点 SDK 的类型对齐

| 项         | 约定                                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 真相源     | App 侧现有 `apps/nongyu-rn-app/src/modules/telemetry/types.ts`（`TrackEvent` / `TrackEventType` / `TrackIngestResult` 等）                                |
| 落地方式   | 抽到 monorepo 共享包（建议 `packages/nongyu-track-contract`），**RN Telemetry 与 Node Track 共同依赖**；禁止复制粘贴两份                                  |
| 字段风格   | 继续 **snake_case**，与 Track HTTP 契约一致                                                                                                               |
| 服务端扩展 | Go 现网另支持内部事件 `llm_proxy_fail`：在共享包中以 **可辨识扩展**（如 `TrackServerEventType` = SDK 类型 ∪ `"llm_proxy_fail"`）表达，避免 SDK 客户端误用 |
| 校验       | Node ingest 用 zod（或等价）从共享类型生成/对齐 schema，单测锁定与 SDK 常量 `TRACK_EVENT_TYPES` 一致                                                      |

### 4.3 Go 代码与文档保留策略

| 项   | 约定                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------- |
| 线上 | Go 埋点 **下线**（不再承载流量）                                                                                |
| 仓库 | `apps/nongyu-go-track-server` **保留**（只读参考 / 历史实现），不删除                                           |
| 文档 | `docs/nongyu-go-track-server/**` **保留**；新增/主导文档标明「实现已迁 Node」，选型与部署文档增补 Node 现行路径 |
| CI   | **生产 CD 不再编译/发布 Go 二进制**；改为发布 Node Track（见 §8）                                               |

---

## 5. 数据与兼容

### 5.1 库文件

- 路径继续：`DB_PATH=/var/lib/nongyu-track/track.db`（或现 env 值）
- **直接接管现网 db 文件**，不重建空库（否则历史大屏数据丢失）
- 上线前：停写窗口内 `sqlite3 .backup` 冷备一份到 `/var/backups/nongyu-track/`

### 5.2 Schema

- 复用 `apps/nongyu-go-track-server/migrations/*.sql`
- Node 启动时跑同等迁移版本表（自建 `schema_migrations` 或沿用现机制）
- 禁止无迁移的 `CREATE IF NOT EXISTS` 漂移

### 5.3 时区 / 业务日

- 继续：`Asia/Shanghai` 日历日 → `stat_date`
- 库内时间继续 UTC ms

---

## 6. 工程落地结构（建议）

```text
apps/nongyu-node-track-server/
  package.json
  src/
    index.ts
    config/env.ts
    http/           # Fastify routes + middleware（jwt/internal/rateLimit）
    ingest/         # validate + writer queue
    store/sqlite/   # db, events, presence, metrics, sqlquery
    presence/       # scanner
    usersync/       # coalesce notify 业务 Node
    aggregate/      # daily jobs + purge
    sqlguard/       # 只读 SQL 白名单（对齐现网）
  migrations/       # 从 Go 拷贝或共享
  deploy/
    nongyu-track.service.example   # ExecStart → node dist/index.js

packages/nongyu-track-contract/   # 与 RN Telemetry 共享
  src/types.ts                    # TrackEvent / TrackIngestResult / 服务端扩展类型
```

Monorepo：`pnpm` workspace 新增上述 package；CD 发布目标 **固定为 Track 独立机**（见 §8）。

---

## 7. 切换与回滚方案

### 7.1 阶段

| 阶段        | 内容                                                                                   | 出口标准                                        |
| ----------- | -------------------------------------------------------------------------------------- | ----------------------------------------------- |
| M1 契约实现 | P0 接口 + SQLite writer + 单测                                                         | 本地/预发契约测试绿                             |
| M2 影子验证 | Track 机另端口跑 Node，用内部脚本双打或回放；**不切公网**                              | 写入正确率、RSS/CPU 可接受                      |
| M3 切换     | **同一台 Track 机**：停 Go → 确认 db 备份 → 启 Node（仍 8081）→ Nginx 不变             | `/health` 通；App 抽样上报成功；BFF overview 通 |
| M4 观察     | 24–72h 盯错误日志、队列满、回写失败                                                    | 无持续性故障                                    |
| M5 收尾     | Go **下线**；CD 只发 Node；**仓库与文档中的 Go 实现保留**；部署文档标明现行路径为 Node | 生产无 Go 流量；误改 Go 目录不触发生产发布      |

### 7.2 回滚

1. `systemctl stop nongyu-node-track`（或新 unit 名）
2. 恢复 Go `ExecStart=/usr/local/bin/nongyu-track` + 原 env
3. 若 Node 已写入损坏数据：用切换前 backup 覆盖 `track.db`（会丢切换后增量，需在窗口决策）

**建议 unit 名**：可继续叫 `nongyu-track.service`（只改 ExecStart），减少运维心智负担。

### 7.3 客户端

- App `EXPO_PUBLIC_TRACK_BASE_URL`、Node `TRACK_BASE_URL` **可不变**（仍是 Track 公网 IP）
- 无需发版 App，只要服务端契约兼容

---

## 8. 运维、发布与 CI/CD 改造

### 8.1 运行时对比

| 项       | Go 现网（下线后）                    | Node 迁移后（现行）                               |
| -------- | ------------------------------------ | ------------------------------------------------- |
| 运行时   | 单二进制（保留在仓库，不再 CD 发布） | **与业务同版本的 Node** + `dist` + `node_modules` |
| 内存上限 | systemd `MemoryMax=512M`             | 可保持                                            |
| 机器     | Track 独立机                         | **同一台** Track 独立机                           |
| 备份     | db 文件备份                          | **相同**（不覆盖 SQLite）                         |

### 8.2 必须改写的 CI/CD 与脚本

| 资产                                                             | 现况                                            | 改造                                                                                                                                                         |
| ---------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.github/workflows/cd.yml` → `plan` path filter                  | `apps/nongyu-go-track-server/**` → `track=true` | 改为监听 **`apps/nongyu-node-track-server/**`**（及共享契约包路径，如 `packages/nongyu-track-contract/**`）                                                  |
| `deploy-track` job                                               | `actions/setup-go` + `go build` linux/amd64     | 改为与 `deploy-node` 同构：`setup-pnpm` → `pnpm --filter nongyu-node-track-server build` → 打包 `dist`（+ 必要时 `package.json`）                            |
| `scripts/cd/publish-track.sh`                                    | 备份/替换 **二进制** + health 回滚              | 改为类似 `publish-node.sh`：解压到 `/opt/nongyu-track`（或既定目录）、`npm/pnpm install --omit=dev`、重启 systemd、`/health` 失败回滚上一版 `dist`           |
| `scripts/deploy-nongyu-track.ps1` + `track-deploy.env(.example)` | 本机 Go 交叉编译 scp                            | 改为本机构建 Node `dist` 上传（应急通道）；字段从 `TRACK_GO_*` / `TRACK_REMOTE_BIN` 迁到 Node 路径语义                                                       |
| systemd unit                                                     | `ExecStart=/usr/local/bin/nongyu-track`         | `ExecStart=<与业务对齐的 node 绝对路径> /opt/nongyu-track/dist/index.js`；**复用** `nongyu-track.service` 名称；`EnvironmentFile` 仍 `/etc/nongyu-track.env` |
| 文档                                                             | `部署与发布.md` 以 Go 为准                      | 增补「现行 Node 发布」章节；Go 章节标注 **历史/回滚参考**                                                                                                    |

### 8.3 CD 行为约定

- `force_deploy=track` 仍可用，但发布物变为 **Node Track**。
- **不再**因仅改动 `apps/nongyu-go-track-server/**` 而触发生产 Track 发布（避免误发已下线的 Go）。
- Go 目录若需 CI：可另加 **非 deploy** 的可选 job（如 `go test`），与生产 CD 解耦；默认不做强制。
- SSH secrets（`TRACK_SSH_*`）可继续复用，目标仍是 Track 独立机。

### 8.4 切换收尾（M5）与仓库保留

1. 生产流量切到 Node Track 且观察通过后，**停止 Go 进程**，systemd 仅保留 Node `ExecStart`。
2. 仓库 **保留** `apps/nongyu-go-track-server` 与既有 Go 文档，供对照与紧急回滚参考。
3. 回滚窗口内可临时把 unit 指回 Go 二进制；窗口关闭后以 Node CD 为准。

---

## 9. 风险与缓解

| 风险                                | 缓解                                                            |
| ----------------------------------- | --------------------------------------------------------------- |
| 契约细节漂移（错误码/部分成功语义） | 以 `接口文档.md` 为验收；补契约测试；切换前用同一压测脚本打一遍 |
| SQLite 并发写                       | 强制单 writer；测 `QUEUE_FULL` 行为                             |
| better-sqlite3 原生编译             | 镜像/构建机预编译；或锁定 Node 22 `node:sqlite`                 |
| usersync 回写失败导致在线态卡住     | 保留现网：离线立即 flush + Node 侧 stale online 收敛            |
| 完整实现内存高于 PoC                | 上线前同机再压一轮「完整进程」；设 RSS 告警（如 >300MB）        |
| 文档/选型过时                       | 同步改 `技术选型.md`、部署文档、AGENTS 相关引用                 |

---

## 10. 工作量粗估（供排期）

| 模块                                            | 人日（约）     |
| ----------------------------------------------- | -------------- |
| 工程骨架 + env + health                         | 0.5            |
| ingest 校验 + writer 队列 + 两路 events         | 2              |
| presence + usersync + scanner                   | 1.5            |
| admin 查询 + sqlguard                           | 2              |
| aggregate/purge 定时任务                        | 1              |
| 部署/CD（改写 track job + publish/deploy 脚本） | 2              |
| 共享契约包 + RN 改引用                          | 0.5            |
| 契约测试与压测回归                              | 1.5            |
| **合计**                                        | **约 11 人日** |

（一人全职约 2 周；含联调缓冲可按 3 周排。）

---

## 11. 验收标准

1. 现网 `接口文档.md` 列出的 P0 接口行为一致（含批量部分成功、幂等、鉴权失败码）。
2. 接管现网 `track.db` 后，Admin 经 BFF 的 overview/趋势/崩溃可查历史数据。
3. App 真机上报、登出 offline、心跳在线回写业务库正常。
4. 同机压测不低于「千人预估峰值」：成功率 ≥ 99.9%，p95 &lt; 200ms，RSS 峰值 &lt; 300MB。
5. 故障可在 5 分钟内回滚到 Go。

---

## 12. 决策锁定（全部确认）

| 项        | 决策                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------ |
| 部署      | Node **原地替换** Go；Track 独立机；永不与业务同机                                               |
| Node 版本 | **与业务后端对齐**（现网业务 **v21.7.3**；随后随业务升级）                                       |
| HTTP      | **Fastify**                                                                                      |
| SQLite    | **better-sqlite3**                                                                               |
| 事件类型  | 共享包 **`packages/nongyu-track-contract`**，与 RN Telemetry 对齐；服务端扩展含 `llm_proxy_fail` |
| systemd   | **复用 `nongyu-track.service`**（只改 `ExecStart` 等）                                           |
| Go 去留   | **线上线下线**；**仓库代码 + 文档保留**                                                          |
| CI/CD     | **改写** Track 相关 CD/脚本，生产只发 Node 埋点                                                  |
| 研发流程  | **先 Spec（SDD）再编码**                                                                         |

---

## 13. 参考

- `docs/nongyu-go-track-server/接口文档.md`
- `docs/nongyu-go-track-server/tech/埋点服务技术方案.md`
- `docs/nongyu-go-track-server/部署与发布.md`
- `.github/workflows/cd.yml`（`deploy-track` / path filter）
- `scripts/cd/publish-track.sh`、`scripts/deploy-nongyu-track.ps1`
- `apps/nongyu-rn-app/src/modules/telemetry/types.ts`
- `docs/nongyu-go-track-server/tech/埋点迁移压测报告.md`（2026-08-29 写入压测；原 `scripts/track-migration-bench/REPORT.md`，脚本已清理）

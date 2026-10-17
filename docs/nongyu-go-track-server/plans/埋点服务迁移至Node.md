# 实施计划：埋点服务从 Go 迁移至 Node

| 项       | 内容                                                                             |
| -------- | -------------------------------------------------------------------------------- |
| 需求类型 | **基建**                                                                         |
| Spec     | `docs/nongyu-go-track-server/specs/埋点服务迁移至Node.md`（**已确认**）          |
| 技术方案 | `docs/nongyu-go-track-server/tech/Go埋点迁移至Node技术方案.md`（**决策已锁定**） |
| 状态     | **代码与 CD 已完成（A–E）**；待 Phase F 机上切换                                 |
| 预估     | 约 11 人日（一人全职约 2 周；含联调可按 3 周）                                   |

---

## 1. 实施目标

在 monorepo 落地 `apps/nongyu-node-track-server` + `packages/nongyu-track-contract`，契约对齐现网 Go Track；改写 Track CD；在 Track 独立机影子验证后切换，最终线上线下线 Go（仓库保留）。

---

## 2. 风险与缓解

| 风险                         | 等级 | 缓解                                                                     |
| ---------------------------- | ---- | ------------------------------------------------------------------------ |
| HTTP 错误码/部分成功语义漂移 | 高   | 以 `接口文档.md` + Go 测试语义迁 Vitest；切换前同脚本压测                |
| 接管 `track.db` 写坏         | 高   | 切换前冷备；窗口内可回滚 Go / 恢复备份                                   |
| better-sqlite3 原生编译失败  | 中   | Track 机预装 gcc/make；CD 或机上 `npm rebuild`；锁定 Node 版本与业务一致 |
| usersync 回写失败            | 中   | 对齐 Go：离线优先 flush + 重试                                           |
| 完整进程 RSS 高于 PoC        | 低   | M2 同机再压完整进程；MemoryMax=512M                                      |
| CD 误发 Go                   | 中   | path filter 切到 Node 包；Go 目录变更不触发生产发布                      |

---

## 3. 实施步骤（按序）

### Phase A — 共享契约（0.5d）

1. 新建 `packages/nongyu-track-contract`
   - 导出 `TRACK_EVENT_TYPES`、`TrackEvent`、`TrackEventInput`、`TrackEventType`、`TrackIngestResult`
   - 导出服务端扩展：`TRACK_SERVER_EVENT_TYPES`（含 `llm_proxy_fail`）、`TrackServerEventType`
2. `pnpm-workspace` / 根依赖纳入该包
3. `apps/nongyu-rn-app` Telemetry 改为依赖该包（删本地重复类型定义）
4. `pnpm type-check`（RN + contract）通过

### Phase B — Node Track 骨架（0.5d）

1. 新建 `apps/nongyu-node-track-server`
   - `package.json`：`fastify`、`better-sqlite3`、`jose`、`zod`、`pino`、`dotenv`；scripts 对齐业务（`tsx`/`tsup`/`vitest`）
   - `engines.node` 与业务对齐（现网业务 **v21.7.3**）
   - 目录：`config` / `http` / `ingest` / `store/sqlite` / `presence` / `usersync` / `aggregate` / `sqlguard` / `migrations`
2. `config/env.ts`：兼容现网 `/etc/nongyu-track.env` 键名
3. `GET /health` + 优雅启停（SIGINT/SIGTERM）
4. 拷贝 Go migrations SQL，启动跑 `schema_migrations`（`001_init`、`002_llm_proxy_fail`）

### Phase C — Ingest 与 Presence（约 3.5d）

1. **validate**：白名单、字段校验、props 截断 — 对齐 Go `ValidateOne`
2. **writer**：有界队列 + 单 worker + 事务写 events/presence；心跳 5min 采样；`QUEUE_FULL` → 503
3. **鉴权**：App JWT（`typ=app`/`uid`）、Internal Token
4. 路由：`POST /v1/track/events`、`/v1/track/presence/offline`、`/v1/internal/events`（`SkipPresence`）
5. **usersync**：合并通知业务 Node presence；离线优先 flush
6. **scanner**：超时离线扫描 + 回写
7. 限流：IP / User 令牌桶（env 可配，默认贴近现网）
8. Vitest：validate、幂等、SkipPresence、QUEUE_FULL

### Phase D — Admin / SQL / Jobs（约 3d）

1. Admin：`overview` / `metrics/trend` / `metrics/dims` / `crashes` / `llm-proxy-fails`
2. 今日 live 查询 + 短缓存策略对齐 Go
3. `sqlguard` + `POST /v1/admin/sql/query`
4. `jobs/aggregate`、`jobs/purge`；定时：日聚合 00:10、峰值采样、purge
5. Vitest：sqlguard 拒写、admin 关键路径语义

### Phase E — CD / 部署资产（约 2d）

1. 改 `.github/workflows/cd.yml`：`deploy-track` → 构建 Node Track；path filter → `apps/nongyu-node-track-server/**` + `packages/nongyu-track-contract/**`
2. 改 `scripts/cd/publish-track.sh`：发布 `/opt/nongyu-track`（dist + prod deps）、health 失败回滚
3. 改 `scripts/deploy-nongyu-track.ps1` + `track-deploy.env.example`：Node 语义
4. `deploy/nongyu-track.service.example`：复用 unit 名，`ExecStart=<node> /opt/nongyu-track/dist/index.js`
5. 更新 `部署与发布.md`：现行 Node 章节；Go 标为历史/回滚

### Phase F — 机上验证与切换（约 1.5d + 观察窗）

| 阶段    | 动作                                        | 出口                             |
| ------- | ------------------------------------------- | -------------------------------- |
| M2 影子 | Track 机另端口跑完整 Node；不切公网         | 写入正确、RSS/CPU 可接受         |
| M3 切换 | 冷备 db → 停 Go → 启 Node:8081 → Nginx 不变 | health + App 抽样 + BFF overview |
| M4 观察 | 24–72h                                      | 无持续 QUEUE_FULL / 回写失败     |
| M5 收尾 | 生产仅 Node；CD 只发 Node                   | 误改 Go 目录不发生产             |

回滚：systemd 指回 Go 二进制；必要时恢复切换前 db 备份。

---

## 4. 测试方案（对应 Spec §6）

| 类型                       | 内容                                                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单测                       | ingest 校验/幂等/SkipPresence；sqlguard；admin 关键断言                                                                                                               |
| type-check / lint / format | monorepo 门禁                                                                                                                                                         |
| 契约                       | 对照 `接口文档.md` 路径与错误码手工清单                                                                                                                               |
| 压测                       | 曾复用 `scripts/track-migration-bench`（迁移完成后脚本已清理，报告归档至 `tech/埋点迁移压测报告.md`）；完整进程达标：成功率 ≥99.9%，p95 &lt;200ms，RSS 峰值 &lt;300MB |
| CD                         | 仅改 Go 不发生产；改 Node Track 可走通发布+health 回滚                                                                                                                |

---

## 5. 文档同步（编码同期）

1. Spec / 本计划状态 → 实施中 → 完成
2. 技术方案状态 → 实施中
3. `部署与发布.md`、必要时 `技术选型.md` 标明现行实现为 Node
4. `docs/common/项目结构总览.md` 增补 `nongyu-node-track-server` / `nongyu-track-contract`（若该文档维护包清单）

---

## 6. 明确不做（本计划边界）

- 删除 Go 代码或文档
- Track 与业务同机
- 改 App 上报 URL 协议
- SQLite → MySQL、多实例写

---

## 7. 完成定义

- 本计划经用户确认后编码
- Phase A–E 合并可用；单测与 type-check 绿
- Phase F M3 切换成功且 M4 观察通过
- Spec 验收标准全部勾选

---

## 8. 请确认后开工

确认本计划无误后回复「通过」或列出修改点；**确认前不开始编码**。

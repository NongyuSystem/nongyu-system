# ⚠️ DEPRECATED — 历史 Go 埋点实现

本目录为**已下线**的 Go 埋点服务，生产 CD 不再发布（cd.yml 的 track job 已改监听 `apps/nongyu-node-track-server/**`）。

- **现行实现**：`apps/nongyu-node-track-server`（Fastify + better-sqlite3）
- **本目录用途**：迁移对照、历史行为核对、紧急回滚参考（见 `docs/nongyu-go-track-server/specs/埋点服务迁移至Node.md` 决议：**仓库保留、不删除**）
- **禁止**：把本目录当作现行源码修改，或因其变更触发发布

原迁移压测报告已归档至 `docs/nongyu-go-track-server/tech/埋点迁移压测报告*.md`；压测脚本（`scripts/track-migration-bench/`）已随迁移完成清理删除。

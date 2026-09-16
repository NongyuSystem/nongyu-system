# Spec：数据大屏 · DAU 趋势与在线峰值

| 项        | 内容                                                                                          |
| --------- | --------------------------------------------------------------------------------------------- |
| 应用      | `apps/nongyu-web-admin`（BFF：`nongyu-node-server`；Track：Node / Go track-server）           |
| 需求类型  | **业务**                                                                                      |
| PRD       | `docs/forhuman/rawprds/nongyu-web-admin/数据大屏DAU与在线峰值趋势PRD.md`                      |
| 上游 Spec | `数据大屏.md`；`docs/nongyu-node-server/specs/管理端Track指标代理.md`；Track overview / trend |
| 状态      | **已实现**                                                                                    |

---

## 1. 背景

大屏一期有「今日日活」「当前在线」，但未展示当日最高同时在线，也未调用已有的 `dau` / `online_peak` 趋势接口。埋点已定时采样并写入 `daily_metrics.online_peak`，BFF `GET /api/admin/track/trend` 已支持两 metric。本期补齐 KPI + 两张趋势卡。

---

## 2. 目标

1. 新增 KPI：**今日最高同时在线**（`kpi-online-peak`）。
2. 新增趋势卡：**日活趋势**（`chart-dau-trend`）、**最高同时在线趋势**（`chart-online-peak-trend`）。
3. 两趋势卡共用区间 `trackTrendRange`：`7d` / `30d` / `90d` / `180d` / `365d`，默认 `7d`，写入 dashboard prefs。
4. Track overview 增补 `online_peak`，BFF 映射为 `onlinePeak`；不新表、不改采样任务、不改 RN 上报。

---

## 3. 边界（非目标）

- 不做「区间最高 DAU」独立数字 / KPI；不做「最高日活」第二张日活 KPI。
- 不做 MAU；不改 presence 超时与 peak 采样周期。
- 不 bump prefs `version`（仍为 1）。
- 不写独立技术方案文档。
- 图表不做 dataZoom / 刷选。
- 不把 Track 在线峰值并入本库 `dashboard/overview`（仍走 Track overview）。

---

## 4. 详细需求

### 4.1 Track overview 增补

`GET /v1/admin/overview?date=` 的 `data` 增加：

| 字段（snake） | 含义                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `online_peak` | 该业务日最高同时在线。今日：`max(daily_metrics.online_peak, CountOnline())`；历史日：仅 metrics |

- **今日 live overview** 与 **历史 metrics overview** 均须带该字段。
- 口径与现有 `GET .../metrics/trend?metric=online_peak` 的今日 live 一致。
- **Node Track 与 Go Track 均改**，避免双实现漂移。

### 4.2 BFF

`GET /api/admin/track/overview` 成功 `data` 增补：

```ts
onlinePeak: number; // 来自 Track online_peak；缺省按 0
```

- `mapOverview` 映射 `online_peak` → `onlinePeak`。
- `GET /api/admin/track/trend` 已支持 `metric=dau|online_peak`，本需求不改契约，仅管理端调用。
- 同步 `docs/nongyu-node-server/接口文档概览.md` 与 `管理端Track指标代理.md` §4.4。

### 4.3 管理端类型与 prefs

- `TrackOverview` 增加 `onlinePeak: number`。
- `DashboardPrefsV1` 增加可选 `trackTrendRange?: GrowthRange`（与 `growthRange` 同枚举）。
- `readDashboardPrefs`：缺省或非法 → `"7d"`；仅缺该字段不整份回退。
- `defaultDashboardPrefs` / 「恢复默认布局」：`trackTrendRange = "7d"`。

### 4.4 卡片目录（增量）

| id                        | 标题             | 展示                                                                                  | 数据                                                      |
| ------------------------- | ---------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `kpi-online-peak`         | 今日最高同时在线 | 大数字；辅文峰值时刻见增量 Spec `管理端玻璃拟态排版与峰值时刻.md`                     | Track overview `onlinePeak` + `onlinePeakAtMs`            |
| `chart-dau-trend`         | 日活趋势         | 平滑折线；卡头 Select：7/30/90/180/365 天，与增长卡同风格；**共用** `trackTrendRange` | `GET /api/admin/track/trend?metric=dau&from=&to=`         |
| `chart-online-peak-trend` | 最高同时在线趋势 | 同上折线与 Select                                                                     | `GET /api/admin/track/trend?metric=online_peak&from=&to=` |

- `from`/`to`：与用户增长相同规则——按业务日闭区间，近 N 天含今天共 N 天（`today-(N-1)` … `today`）。日期格式 `YYYY-MM-DD`。
- 缺日：前端按区间补 `0` 或断点均可，但两卡须一致；推荐与增长趋势现网行为对齐（若增长卡对缺日补 0，则本两卡亦补 0）。
- 空区间全 0：卡片内「暂无数据」，不画假点。

### 4.5 布局

- `WIDGET_IDS` 纳入上述三 id。
- 默认布局建议：
  - KPI：`kpi-online-peak` 紧挨 `kpi-online` 一行内（lg 可调宽；md/xs 顺延换行）。
  - 趋势：两卡并排或上下紧挨，置于 `chart-user-growth` 附近（如其下）。
- 旧 localStorage 布局缺新 id：按现有 merge 策略并入默认位（与历史加卡一致）。

### 4.6 加载与失败隔离

- 进页 / 顶栏刷新：与现有 Track 拉取一并请求 overview（已含 `onlinePeak`）+ 两路 trend（`dau`、`online_peak`）。
- 切换 `trackTrendRange`：更新 prefs；**只重拉两路 trend**；两卡可共用一段 loading；其它卡不动。
- Track 失败：三卡各自空态 / 错误文案，本库 KPI 与分布图不受影响（与现大屏隔离策略一致）。

### 4.7 文案与口径提示

- `kpi-dau` 不变。
- `kpi-online-peak` 辅文须体现「采样峰值」，避免理解成当前瞬时在线。
- 趋势卡标题用「日活趋势」「最高同时在线趋势」，避免「最高日活」歧义。

---

## 5. 业务流程

```
管理员打开 /dashboard
  → 读 prefs（含 trackTrendRange，默认 7d）
  → 并行拉 dashboard/* 与 track/overview、track/trend×2 …
  → 渲染 KPI（含 onlinePeak）与两趋势折线

切换趋势区间 Select
  → 写 trackTrendRange
  → 仅重拉 dau + online_peak trend → 两卡更新

点刷新
  → 全量重拉（含 overview 与两 trend）
```

---

## 6. 验收标准

1. 大屏可见「今日最高同时在线」数字，与当日 trend 今日点（或采样后 DB）一致量级；辅文含采样说明。
2. 「日活趋势」「最高同时在线趋势」默认可切换五档区间；切换只影响这两卡；刷新后区间记忆。
3. 恢复默认布局后：`trackTrendRange=7d`，三新卡出现在默认位。
4. Track 宕机时两趋势 + 峰值 KPI 失败提示，本库总用户/当前在线等仍可用。
5. `pnpm lint` / `type-check` / `format` 通过；overview 契约文档已更新。

### 理想 UI

- KPI 行多一张卡，数字层级与现有 KPI 一致。
- 两趋势卡：平滑折线、色板沿用大屏绿金系、卡头小 Select 与「用户增长趋势」同风格。
- 无数据时卡内居中「暂无数据」。

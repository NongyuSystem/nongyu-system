# Spec：管理端 Track 指标代理

| 项        | 内容                                                                |
| --------- | ------------------------------------------------------------------- |
| 应用      | `apps/nongyu-node-server`                                           |
| 需求类型  | **业务**（服务管理端数据大屏）                                      |
| PRD       | `docs/forhuman/rawprds/nongyu-web-admin/农屿管理后台数据大屏PRD.md` |
| 上游契约  | `docs/nongyu-go-track-server/接口文档.md` §5                        |
| 配套 Spec | `docs/nongyu-web-admin/specs/数据大屏.md`                           |
| 状态      | **已实现**                                                          |

---

## 1. 背景

管理端数据大屏需要日活、页面使用、性能分位与崩溃列表。这些指标在 Track 的 `/v1/admin/*` 已具备，但 **禁止管理端浏览器直连 Track**（仅 Internal Token，且响应包为 `{ ok, data }`）。Node 已有本库大屏接口（总用户、在线、新增、增长、画像、设置分布），**不含** DAU / 行为 / 性能 / 崩溃。本刀补齐 Node BFF 代理，对外仍用 Node `{ code, message, data }` + camelCase。

---

## 2. 目标

1. 已登录管理员可通过 Node 读取 Track 当日概览、维度分布、崩溃列表（及可选趋势）。
2. Node 使用 `X-Internal-Token` 调用 Track；Token 与现网 `INTERNAL_TOKEN` 对齐（即 Track 的 `INTERNAL_TOKEN`，不是 `NODE_INTERNAL_TOKEN`）。
3. Track 不可达、超时、非 2xx 或 `ok: false` 时，接口失败且有明确错误码，**不影响**已有 `/api/admin/dashboard/*`。
4. 不改 Track 服务与业务 MySQL schema。

---

## 3. 边界（非目标）

- 不把 Track 指标并入 `GET /api/admin/dashboard/overview`（前端并行请求）。
- 不提供「用户使用时间分布」（Track 无该聚合）。
- 不对公网暴露 Track 运维接口（`/v1/admin/jobs/*`）。
- 不在 Node 做日聚合补算、不缓存跨请求的指标结果（可单次请求内并行，但禁止模块级可变缓存串请求）。
- 不改 `users.is_online` 口径；当前在线仍只走本库 dashboard overview。

---

## 4. 详细需求

### 4.1 环境变量

| 变量             | 必填 | 说明                                                 |
| ---------------- | ---- | ---------------------------------------------------- |
| `TRACK_BASE_URL` | 否   | Track 根地址，无尾斜杠。默认 `http://127.0.0.1:8082` |
| `INTERNAL_TOKEN` | 是   | 已有。请求 Track Admin 时作为 `X-Internal-Token`     |

`.env.example` 须补充 `TRACK_BASE_URL` 说明。未配置时用默认值，不因缺省拒绝启动。

### 4.2 鉴权

下列接口均需 **已建档管理员** JWT（与现有 dashboard 相同：`requireProvisionedAdminAuth`）。禁止用 App JWT。

### 4.3 调用 Track 约定

- 方法/路径：见各接口「上游」。
- Header：`X-Internal-Token: <INTERNAL_TOKEN>`，`Accept: application/json`。
- 超时：单次 **5s**（连接+响应）。超时视为 Track 不可达。
- 成功：HTTP 2xx 且 body `ok === true`，取 `data` 再映射为 camelCase。
- 失败映射：

| Track 侧                         | Node HTTP | `code`（建议）            | `message`（对管理员）                 |
| -------------------------------- | --------- | ------------------------- | ------------------------------------- |
| 超时 / DNS / 连接失败            | 503       | `50301` TRACK_UNAVAILABLE | 埋点服务暂不可用                      |
| HTTP 403 或 `FORBIDDEN`          | 503       | `50301`                   | 埋点服务暂不可用（不暴露 Token 细节） |
| HTTP 4xx 或 `ok: false` 其它业务 | 502       | `50201` TRACK_BAD_GATEWAY | 埋点指标查询失败                      |
| HTTP 5xx                         | 503       | `50301`                   | 埋点服务暂不可用                      |

实现须把 `50201` / `50301` 写入 `ErrorCodes`，并同步 `docs/nongyu-node-server/接口文档概览.md`。

### 4.4 `GET /api/admin/track/overview`

| Query  | 必填 | 说明                                    |
| ------ | ---- | --------------------------------------- |
| `date` | 否   | `YYYY-MM-DD`；缺省 = `BUSINESS_TZ` 当天 |

上游：`GET {TRACK_BASE_URL}/v1/admin/overview?date=`

成功 `data`：

```ts
{
  date: string;
  dau: number;
  crashCount: number;
  appOpenCount: number;
  screenViewCount: number;
  onlinePeak: number; // Track online_peak；缺省 0
  onlinePeakAtMs: number | null; // Track online_peak_at_ms；未知 null
  buttonClickCount?: number;
}
```

忽略 Track 的 `online`（在线人数只读本库）。`onlinePeak` 为当日最高同时在线（来自 Track `online_peak`）。`onlinePeakAtMs` 为首次达到该峰值的 UTC 毫秒；缺省或非法为 `null`。

### 4.5 `GET /api/admin/track/dims`

| Query        | 必填 | 说明                                                                                |
| ------------ | ---- | ----------------------------------------------------------------------------------- |
| `metric`     | 是   | `screen_views` \| `screen_dwell_avg` \| `button_clicks` \| `perf_p50` \| `perf_p95` |
| `date`       | 否   | 缺省当天；与 `from`/`to` 互斥用法见下                                               |
| `from`       | 否   | `YYYY-MM-DD`；须与 `to` 成对；仅 `perf_p50`/`perf_p95` 允许 `from < to`             |
| `to`         | 否   | 同上                                                                                |
| `limit`      | 否   | 默认 50，最大 100（与 Track 一致）                                                  |
| `platform`   | 否   | 透传 Track                                                                          |
| `namePrefix` | 否   | 透传为 Track `name_prefix`                                                          |

上游：`GET /v1/admin/metrics/dims`（Query 原样转发 `from`/`to`/`date`/`limit`/`platform`/`name_prefix`）。

**区间规则（Node 可做预校验，亦可依赖 Track 400）：**

- 缺省：无 `from`/`to` 时 `date = todayBusinessDate()`，行为与现网一致。
- `from`/`to` 成对；跨日仅允许 perf 分位；跨度 ≤ 30 天；校验失败 400 / `40001`，可不打 Track。
- 大屏「应用性能区间」见 `docs/nongyu-web-admin/specs/数据大屏-应用性能区间查询.md`；Track 口径见 `docs/nongyu-node-track-server/specs/应用性能dims区间分位.md`。

成功 `data`：

```ts
{
  date?: string;
  from?: string;
  to?: string;
  metric: string;
  items: {
    dimKey: string;
    dimValue: string;
    metricValue: number;
  }[];
}
```

映射：Track `from`/`to`/`date` 透传 camelCase；`items` 字段 camelCase 与现网一致。

非法 `metric`：400 / `40001`，不打 Track。

### 4.6 `GET /api/admin/track/crashes`

| Query      | 必填 | 说明                  |
| ---------- | ---- | --------------------- |
| `from`     | 否   | 业务日起；缺省 = 当天 |
| `to`       | 否   | 业务日止；缺省 = 当天 |
| `page`     | 否   | 默认 1                |
| `pageSize` | 否   | 默认 20，最大 100     |

上游：`GET /v1/admin/crashes`（`page_size` 由 Node 翻译）。

成功 `data`：与现网 Admin 列表相同的分页壳（`items` + `total` + `page` + `pageSize`），条目字段 camelCase：

```ts
{
  eventId: string;
  userId: number | null;
  studentNo: string | null;
  eventName: string;
  appVersion: string | null;
  platform: string | null;
  deviceBrand: string | null;
  clientTsMs: number | null;
  receivedAtMs: number;
  statDate: string;
  props: Record<string, unknown> | null;
}
```

`props` 原样转发（Track 已约定禁止明文密码）；管理端只展示截断文本，不在本接口再过滤键名（除非发现密钥类键，实现时可剥离 `password` / `token` / `authorization` 键，大小写不敏感）。

`from > to`：400 / `40001`。

### 4.7 `GET /api/admin/track/trend`（本期前端可不调用）

为与 Track 文档 §6.3 对齐一并提供，避免下刀再开 BFF。

| Query    | 必填 | 说明                                                                               |
| -------- | ---- | ---------------------------------------------------------------------------------- |
| `metric` | 是   | `dau` \| `crash_count` \| `app_open_count` \| `screen_view_count` \| `online_peak` |
| `from`   | 是   | `YYYY-MM-DD`                                                                       |
| `to`     | 是   | `YYYY-MM-DD`，含首尾                                                               |

成功 `data`：`{ points: { date: string; value: number }[] }`（缺日不补零，与 Track 推荐一致）。

大屏本期 **不依赖** 本接口；用户增长趋势仍走 `/api/admin/dashboard/user-growth`。

### 4.8 已有 dashboard 接口

`GET /api/admin/dashboard/overview|user-growth|user-distribution|settings-distribution` **行为不变**。  
`overview` 仍不含 `dau`。

---

## 5. 业务流程

```text
Admin JWT ──► Node /api/admin/track/*
                 │ 校验管理员
                 │ date 缺省 → BUSINESS_TZ 当天
                 ▼
              HTTP GET Track /v1/admin/* + X-Internal-Token
                 │
        ok:true ─┴─ 映射 camelCase ──► { code:0, data }
        失败 ─────► 502/503 + 50201/50301
```

---

## 6. 验收与测试

### 6.1 单元 / 集成（Node）

- [ ] `TRACK_BASE_URL` 未设置时服务能启动，请求走默认基址。
- [ ] overview 无 `date` 时，打到 Track 的 query 为上海业务日当天（测试可 mock 时钟或断言转发的 query 格式为 `YYYY-MM-DD`）。
- [ ] Track mock `ok: true` → 管理端拿到 camelCase，且 **无** `online` 字段。
- [ ] Track 连接拒绝 / 超时 → HTTP 503，`code=50301`，不把内部 URL 写进 `message`。
- [ ] Track `ok: false` → HTTP 502，`code=50201`。
- [ ] 非法 `metric` / `from>to` → 400，**零次**上游调用。
- [ ] 无 Admin JWT → 401（与现网一致）。
- [ ] `jobs/aggregate` **不存在**于 `/api/admin/track/*`。

### 6.2 联调

- Track 与 Node `INTERNAL_TOKEN` 一致时，本机 `curl` 带 Admin Bearer 可拿到非空或全 0 的 overview。
- Token 故意不一致 → 503，dashboard overview 仍 200。

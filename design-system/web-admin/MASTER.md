# Nongyu Admin Design System (MASTER)

## 1. Core Vision

- **Concept**: Academic Tech（学院派科技感）— 与农屿 RN「川农新绿」同源
- **Vibe**: Warm, Healing yet Serious（温暖治愈且严谨）
- **Target**: Students, Student-Admin, Developers
- **Environment**: Standalone Browser & React Native WebView（需高响应）

## 2. Visual Style

- **Pattern**: 贴边壳层 + 毛玻璃内容卡；工作台可用轻量 Bento，CRUD 页用统一 PageFrame
- **Material**: Greenhouse Frost（克制浅色玻璃）— 薄白填色 + 强 `backdrop-filter` + 内高光描边；**不是**深色 Liquid Glass，**不是**侧栏悬浮岛
- **Canvas**: 雾灰底 + **极淡**品牌光斑（`.ny-canvas-wash`）；禁止大面积饱和绿，禁止绿描边箍白卡
- **Border Radius**: 卡片 12–16px；控件 10–12px（避免过大圆角导致「玩具感」）
- **Shadows**: 内高光 + 极轻外漫射；玻璃靠折射与 1px 浅描边，忌厚重悬浮岛
- **Fallback**: `prefers-reduced-transparency` 或不支持 blur → 实心 `#FFFFFF`
- **Signature**: 侧栏选中项浅绿底 + 左侧品牌绿竖条

## 3. Color Palette（对齐 RN `green`）

| Token                 | Color (Hex)        | Usage                                |
| --------------------- | ------------------ | ------------------------------------ |
| **Primary**           | `#0A7C59`          | 主品牌、主按钮、选中态               |
| **Primary Container** | `#D4E9DF`          | 菜单选中底、轻强调底                 |
| **On Primary**        | `#FFFFFF`          | 主色上的文字                         |
| **Secondary**         | `#2E7D6E`          | 次强调、图表辅色                     |
| **Tertiary**          | `#8FBF9B`          | 装饰、图表浅色                       |
| **Background**        | `#E6E9E7`          | 雾灰画布；仅极淡绿意，禁止饱和绿铺底 |
| **Surface**           | `#FFFFFF`          | 玻璃回退实心 / 不透明控件底          |
| **Glass Fill**        | `#FFFFFF` @ 40–55% | 内容卡霜面（薄，才能看见折射）       |
| **Glass Chrome**      | `#FFFFFF` @ 50–65% | 贴边侧栏 / 顶栏 / 助手外框           |
| **Surface Variant**   | `#DEE5E1`          | 分区底、表格斑马可选                 |
| **Text Primary**      | `#1F2937`          | 标题与主文案                         |
| **Text Secondary**    | `#424945`          | 说明与元信息                         |
| **Outline**           | `#CFE3DA`          | 边框、分割线                         |
| **Danger**            | `#C62828`          | 危险操作（与 RN 一致）               |

> 历史 Emerald `#10B981` / Amber `#FBBF24` 不再作为管理端主色板。

## 4. Typography

- **UI / Display**: `Source Sans 3`（拉丁）+ `PingFang SC` / `Microsoft YaHei`（中文）
- **Data / Tabular**: 同族，`tabular-nums`
- **Scale（桌面）**:
  - 页标题：22–24px / 600
  - 区块标题：16px / 600
  - 正文：14px / 400
  - 辅助：12–13px / 400，`Text Secondary`
- **Base**: 14px（管理端桌面密度）；触控场景控件高度 ≥ 44px（`pointer: coarse` 或显式 `min-h-11`）
- 移动端：Drawer 全宽、Modal 留边、`viewport-fit=cover` + safe-area；窄屏禁用大屏拖拽缩放

## 5. Technical Specifications

### React + Ant Design

- `ConfigProvider` 覆盖 token：`colorPrimary: #0A7C59`，`borderRadius: 12`，`controlHeight: 40`
- Menu 选中：`itemSelectedBg: #D4E9DF`，`itemSelectedColor: #0A7C59`

### Tailwind CSS

- Token 色：`brand` / `brand-muted` / `canvas` / `ink` / `muted` / `line`
- 卡片：`rounded-xl` 或 `rounded-2xl`；统一 `.ny-glass`（内容卡）/ `.ny-glass-chrome`（贴边壳）/ `.ny-glass-lift`（可点卡 hover，只加边与影、不加实心底、不加 transform）
- 模糊：内容卡 `blur(32–40px) saturate(1.15–1.3)`（高 saturate 会把画布染绿）；壳层略强。填色超过约 60% 会发闷
- **禁止**在带 `backdrop-filter` 的同一节点上设 `overflow: hidden | auto`（WebKit 采成实心白）；滚动放内层
- **禁止**玻璃套玻璃、hover 实心底、霜面自身 `transform`、绿描边/绿投影箍白卡
- `.ny-glass-lift` 的 hover **仅** `(hover: hover) and (pointer: fine)`，避免触控粘滞
- 间距：壳层内容 `px-5 py-4`（窄屏 `px-3 py-4`）；卡片内 `p-4` / `p-5`
- 窄屏：输入 16px 防 iOS 缩放；控件 ≥44px；`100dvh` + safe-area；大屏禁拖拽；顶栏用户名可收起

### ECharts

- Colors: `['#0A7C59', '#2E7D6E', '#8FBF9B', '#D4E9DF', '#5A9A86', '#A8C9B8']`
- Line：`smooth: true`
- Tooltip：圆角 + 轻 blur

### Layout

- 侧栏贴边固定宽 ~220px，**禁止**大圆角悬浮侧栏岛；侧栏/顶栏用霜面，仍贴边
- 顶栏 `position: fixed` 贴顶（桌面 `left` = 侧栏宽），主区 `padding-top` 让位；**不重复页标题**（文案为产品名「农屿管理台」）
- 页标题仅出现在 `PageFrame`：22–24px / 600；标题行可放主操作；搜索/筛选放内容区工具栏
- CRUD：`PageFrame`（标题行 + 可选主操作 + 霜面内容 + 可选工具栏）；工作台可用轻量 Bento
- 数据大屏默认网格：先「此刻」（在线 / 峰值+时刻 / 日活 / 新增），再「体量」，再趋势与分布
- 触控目标最小 40×40；移动端侧栏抽屉

## 6. Anti-Patterns (Avoid)

- 不要用 RN 以外的翠绿 / 霓虹绿当主色
- 不要 0 圆角硬边，也不要 24px+ 圆角铺满所有卡片
- 不要深色玻璃、霓虹描边、强色散或把侧栏做成桌面悬浮岛
- 不要在纯白画布上叠纯白玻璃（材质不可读）
- 不要大面积饱和绿画布，或用绿描边/高 saturate 把霜面染成一块绿
- 不要把 `overflow` / `transform` 加在霜面节点上；不要玻璃套玻璃；不要 hover 盖实心底
- 不要控件统一 48px 高度造成桌面「虚胖」
- 不要仅 hover 才能完成的关键（须支持触控）
- 不要在 CRUD 页堆砌无意义 Bento 装饰

---

_Aligned with RN green palette · Nongyu System_

---

## 2026-09-05 · nongyu-web-site · 官网 PV / Web Vitals 大屏无数据

- **现象**：管理端大屏「今日官网访问」为 0，「官网 Web Vitals」空白；App 埋点指标正常。
- **根因**：现网官网构建未注入 `VITE_TRACK_WEB_URL`（包内无上报地址），`rumConfigured()` 恒假，PV/CWV 从不发送；官网 Nginx 亦缺 `/v1/track/web/` 反代时同源上报会 404。
- **修复**：客户端 URL 默认同源 `/v1/track/web/events`；支持 `rum-config.js` / `__NONGYU_RUM__` 注入 Site Key；文档强调 Nginx 反代必配。部署需：写入 Site Key（构建 env 或覆盖 `rum-config.js`）并启用官网 Nginx Track 反代后重新发布官网。

---

## 2026-09-04 · nongyu-web-admin · 用户详情「设为管理员」仍无弹窗

- **现象**：超管点击「设为管理员 / 取消管理员」按钮非禁用，但无确认框、无 Toast、无后续。
- **根因**：仅给静态 `Modal.confirm` 提高 `zIndex` 仍可能被 Drawer 遮罩/叠层吞掉，表现为「点了没反应」。
- **修复**：改为声明式受控 `Modal`，`getContainer={() => document.body}` 且 `zIndex=1100`；升权成功后再打开设密弹窗。

---

## 2026-09-04 · nongyu-web-admin · 去掉禁用后普通管理员看不到角色操作

- **现象**：去掉「禁用/启用」后，普通管理员打开普通用户详情，操作区为空。
- **根因**：「设为管理员」原先仅 `canManageRole`（超管）才渲染，与禁用按钮解绑后入口消失。
- **修复**：角色操作按钮对所有管理员始终展示；非超管禁用并 Tooltip「仅超级管理员可操作」。

---

## 2026-09-04 · nongyu-web-admin · 用户详情「设为管理员」点击无反应

- **现象**：用户详情抽屉内点击「设为管理员 / 取消管理员」无可见反馈。
- **根因**：`Modal.confirm` 与 `Drawer` 默认 `zIndex` 均为 1000，确认框被抽屉遮罩挡住。
- **修复**：确认框与设密弹窗 `zIndex` 提到 1100；同时按 Spec 去掉详情抽屉「禁用 / 启用」入口。

---

## 2026-09-04 · nongyu-web-admin · 登录后 React #130 白屏（Element type is object）

- **现象**：登录后 ErrorBoundary「管理台加载失败」；Minified React error #130，`args[]=object`。
- **根因**：`EchartsBlock` 使用 `echarts-for-react/lib/core`（CJS）；Rolldown 互操作后 JSX 拿到的仍是带 `default` 的 **object**，不是组件函数。大屏/助手图表一渲染即崩。
- **修复**：改 import `echarts-for-react/esm/core`；`AuthedApp` 改为 default export；`react-grid-layout` CJS 组件解包；`dashboardCharts` 对缺失数组短路。

---

- **现象**：回退懒加载后功能可用，但首屏仍约 2.7MB 单包，弱网长时间空白被感知为白屏。
- **根因**：业务页全量静态进入口；真正安全的拆法应是「登录静态 + 已登录 AuthedApp 整包 lazy」，且禁止对 AuthedApp 内部再二级拆页面（易循环依赖）。强制 vendor groups 曾加剧白屏。
- **修复**：`AuthedApp` 单一懒加载边界；助手在壳内再 lazy；保留 echarts 按需；入口增加 `AppErrorBoundary`。登录首包约 **1237KB / gzip ~398KB**（仅 `index.js`），工作台再拉 AuthedApp + Echarts，打开助手再拉 agent。

---

## 2026-09-04 · nongyu-web-admin · Bundle 优化后登录进工作台白屏

- **现象**：首屏 Bundle 优化上线后，登录页尚可，进入工作台（及已登录直达）白屏。
- **根因**：路由 `React.lazy` + Vite/Rolldown 分包使业务页 chunk **反向 import 入口 `index-*.js`**（共享 antd icons 等打进入口），运行时循环依赖导致渲染失败。
- **修复**：撤回路由/助手懒加载与强制 vendor `codeSplitting.groups`；保留 echarts 按需、`logoutCleanup` 动态导入、SDK `jiaowu`/`second` 子路径、字体非阻塞。后续若再拆路由须先保证懒加载页不依赖入口 chunk。

---

## 2026-09-04 · nongyu-web-admin · 首屏单包 3.2MB 导致加载 8–9 秒

- **现象**：管理端生产首屏约 8–9 秒；构建仅一个 `index.js` ≈ 3.2 MB（gzip ≈ 1.1 MB）。
- **根因**：路由与助手均为静态 import；`authStore` 同步引用 `logoutCleanup` → `agent` 把 SDK/SQL 打进入口；echarts 全量引入；无 Vite vendor 分包；SDK 主入口 re-export 教务/二课工具。
- **修复**：业务页 `React.lazy`；助手首次打开再加载；登出清理改为动态 import；`echarts/core` 按需注册；Vite `codeSplitting.groups`；SDK 拆 `nongyu-agent-sdk/jiaowu|second`；字体 stylesheet 非阻塞。优化后登录首屏 preload 仅 react/antd/入口（入口 gzip ≈ 26 KB；agent/echarts/markdown 延后）。

---

- **现象**：Android 点微信好友/朋友圈 Toast「ExpoNativeWechat.shareWebpage has been rejected」。
- **根因**：`coverUrl` 使用 `Image.resolveAssetSource(icon)` 的本地 URI；`expo-native-wechat` 原生用 OkHttp 下载缩略图，非 http(s) 同步抛 `IllegalArgumentException`，被 Expo Modules 包成 rejected。此前只改了落地页 http，未修缩略图。
- **修复**：缩略图改为 `http://nongyu.site/apple-touch-icon.png`；失败则无图重试；解析原生 `success:false`；Toast 文案可读化。

---

## 2026-09-01 · nongyu-rn-app · 分享/关于官网误用 https

- **现象**：复制链接得到 `https://nongyu.site/`；微信好友/朋友圈分享失败或打开异常。
- **根因**：`ABOUT_URL`（与 `SHARE_WEBPAGE_URL` 同源）在 4.0.0 误改为 `https://nongyu.site/`，现网官网仅提供 HTTP；Spec 同步写错。
- **修复**：改回 `http://nongyu.site/`；Spec「分享农屿」中 webpageUrl / 复制链接约定同步为 http。

---

## 2026-09-01 · nongyu-rn-app · 4.0.1 安装包仍含错误键盘逻辑 / 遮挡未修

- **现象**：用户反馈大院留言框仍被键盘挡住；怀疑「已修好」不成立。
- **根因**：EAS 生产包基于提交 `242661f`，其中 Android 路径仍是「resize 假定成立、仅垫 8px」；本地 overlap 修复未提交进包。且仅用 `screenY` 推算时，部分机型（如 ColorOS）在 resize 未生效时仍报 cover≈0，继续只垫 8px。
- **修复**：`useComposerKeyboardInset` 改为对比弹键盘前后 `Dimensions.window.height` 是否明显缩短：已缩短则仅呼吸间距，未缩短则与 AI 页一致按 `endCoordinates.height` 垫高；避免 screenY 误判与双重顶起。

---

## 2026-08-31 · nongyu-rn-app · 留言框修「顶过高」后反而被键盘盖住

- **现象**：大院详情调起键盘后，留言输入条不再被顶起，仍被键盘遮挡。
- **根因**：前一次修复假定 Android `softwareKeyboardLayoutMode: resize` 一定缩短窗口，键盘弹出时只垫 8px；部分机型 resize 未真正作用到该页布局，输入条仍贴原窗口底。
- **修复**：`useComposerKeyboardInset` 按 `window.height - endCoordinates.screenY` 计算真实遮挡；resize 生效时 cover≈0 仅留呼吸间距，未生效时按遮挡高度垫高；不再在 cover≈0 时回退全高 `height`。

---

## 2026-08-31 · nongyu-rn-app · 大院详情留言框被键盘顶得过高

- **现象**：帖子详情底部留言输入框调起键盘后，键盘顶部与输入条底部之间空隙过大。
- **根因**：Android 已用 `adjustResize`/`softwareKeyboardLayoutMode` 缩短窗口，`useComposerKeyboardInset` 仍按键盘全高 + `safeBottom` + 间距叠加 `paddingBottom`，与系统避让双重顶起；`overlapFromEvent` 还用 `screen` 高度取 max，edge-to-edge 下进一步虚高。
- **修复**：Android 键盘弹出时仅保留 8px 呼吸间距；iOS 仍用键盘高度；去掉 screen 推算；`app.json` 明确 `softwareKeyboardLayoutMode: resize`。

---

## 2026-08-31 · nongyu-web-admin · 登录页/侧栏品牌 logo 404

- **现象**：管理端登录页、左上角品牌图裂图；浏览器请求 `http://nongyu.site/nongyu-logo.png` 返回官网 HTML 而非图片。
- **根因**：生产 Vite `base=/admin/`，logo 与 favicon 产物在 `/admin/nongyu-logo.png`；`NongyuLogo` 写死站点根路径 `/nongyu-logo.png`，Nginx 走官网 `try_files` 回落到 `index.html`。
- **修复**：`NongyuLogo` 使用 `` `${import.meta.env.BASE_URL}nongyu-logo.png` ``；`index.html` favicon 改为 `%BASE_URL%favicon.png`。

---

## 2026-08-31 · nongyu-web-admin · 大屏部分卡片拖拽刷新后恢复默认位置

- **现象**：部分图表（如性别分布）拖放/缩放后，刷新页面又回到改动前位置。
- **根因**：① **RGL 事件顺序**：`onDragStop`/`onResizeStop` 先于最终 `onLayoutChange` 触发，在 stop 回调里写 localStorage 会持久化拖拽前布局（内存已是新位置，刷新后从 storage 读回旧值）；② 挂载/断点切换时 RGL compact 的 `onLayoutChange` 须忽略；③ 多 breakpoint 须增量 merge。
- **修复**：仅在用户交互后的 `onLayoutChange` 中防抖 `writeDashboardPrefs`（不再在 stop 回调里写）；`layoutsDraftRef` + `mergeDashboardLayouts`；忽略未交互前的 `onLayoutChange`。

---

## 2026-08-31 · nongyu-node-track-server · 远端发布后找不到 nongyu-track-contract

- **现象**：发布到 `/opt/nongyu-track` 后进程起不来：`Cannot find package 'nongyu-track-contract'`，health 失败回滚。
- **根因**：源码改为 `import ... from "nongyu-track-contract"` 后 tsup 未打进 `dist`；`package.deploy.json` 又删掉了该依赖。
- **修复**：`tsup.config.ts` 增加 `noExternal: ["nongyu-track-contract"]`，强制打进 bundle。

---

## 2026-08-31 · nongyu-node-server · `pnpm dev` 报 Invalid environment

- **现象**：本地 `pnpm --filter nongyu-node-server dev` 启动即 `MYSQL_HOST: Required; JWT_SECRET: Required...`，尽管 `.env` 已存在。
- **根因**：`ensureSuperAdmin.ts` 模块顶层 `createLogger()` → `getEnv()`，在 `index.ts` 的 `loadEnvFiles()` 之前执行（ESM import 提升）。
- **修复**：将 `createLogger()` 移入 `ensureSuperAdminRole()` 函数体内，待 env 加载后再取。

---

## 2026-08-31 · nongyu-node-track-server · Web 上报 platform=web 被当成重复

- **现象**：`POST /v1/track/web/events` 返回 200 但 `accepted=0`、`duplicated=1`（或静默丢事件）。
- **根因**：`migrations/003_platform_web.sql` 已写但未登记到 `runner.ts` 的 `STEPS`；表 CHECK 仍仅 `ios|android`。`INSERT OR IGNORE` 对 CHECK 失败也记为 `changes=0`，Writer 误判为 duplicate。
- **修复**：在 runner 注册 `003_platform_web`；`001_init.sql` 同步允许 `web`（新库）；补 Web ingest 单测。

---

## 2026-08-30 · nongyu-web-site · 顶栏「菜单」二字竖排

- **现象**：窄屏顶栏按钮「菜单」视觉上上下叠字，而非横排。
- **根因**：`.nav__menu-btn` 固定 `width: 2.5rem`，不足以容纳两字，被迫换行。
- **修复**：改为 `min-width` + 水平 padding，并设 `white-space: nowrap`。

---

## 2026-08-30 · nongyu-web-site · 功能截图一直显示「图片占位」

- **现象**：`public/features/*.jpg` 已就位且 URL 可 200 访问，功能区仍只显示占位文案。
- **根因**：`mountImage` 用离屏 `new Image()` + `loading="lazy"`，再等 `load` 才挂到 DOM；未入文档的 lazy 图不会真正加载，`load` 永不触发，占位无法移除。
- **修复**：先把 `img` 插入槽位再设 `src`；去掉离屏 lazy；兼容 `complete` 缓存命中立即揭幕。

---

- **现象**：大院留言 / 管理员回复的 `publishedAt` 回显与真实发送时刻不符（如本地 10:00 显示 18:00）。
- **根因**：`post_replies` 插入未显式写时间，依赖 `CURRENT_TIMESTAMP(3)`（跟 MySQL 会话/系统时区，现网多为东八区墙钟）；`mysql2` `timezone: "Z"` + `toIsoUtcRequired` 却按 UTC 解读并返回 ISO，RN `dayjs` 再转到本地 → 多加 8 小时。发帖 `published_at` 使用 `UTC_TIMESTAMP(3)` 故往往正常。
- **修复**：① `createComment` / `createAdminReply` 显式 `UTC_TIMESTAMP(3)`；② 连接池 `SET time_zone = '+00:00'`；③ 迁移 `011_fix_post_replies_created_at_utc.sql` 在东八区环境下将历史行 `CONVERT_TZ(+08→+00)`。前端回显逻辑无需改。

---

## 2026-08-26 · GitHub CD · Actions SSH Secret 误填 root 密码导致部署失败

- **现象**：`deploy-admin` / `deploy-node` 在 SCP/SSH 步骤失败；日志为 `Load key ... error in libcrypto` 或 `Permission denied (publickey,...)`，exit code 255。
- **根因**：`WEB_SSH_KEY` / `NODE_SSH_KEY` / `TRACK_SSH_KEY` 被误填为服务器 root 登录口令；当前 `cd.yml` 仅支持私钥认证，不支持密码登录。另常见误配：私钥格式损坏（缺首尾行、压成一行）、三台机器 Host/Key 混用（WEB `101.43.34.229`、NODE `8.137.82.17`、TRACK `47.108.74.61` 须各用对应 `id_ed25519_nongyu_*`）。
- **修复**：GitHub Secrets 填各机部署专用私钥全文（含 `BEGIN/END OPENSSH PRIVATE KEY`），Host/User 与 `scripts/ops/*-deploy.env` 一致；本机用 `ssh -i <key> root@<host> "echo ok"` 验证免密后再重跑 CD。口令仅用于首次手动登录装公钥，不进 Secret。

---

## 2026-08-19 · nongyu-agent-sdk · 工具 JSON Schema 丢失 union/literal、describe，且 optional 被标成 required

- **现象**：发给模型的 tools 里 `role`/`status` 变成 `"role": {}`；`z.string().optional().describe(...)` 的 description 全部缺失；所有字段都被塞进 `required`（含明确 `.optional()` 的 keyword/page/range/date）。
- **根因**：Zod 3 走手写 `convertZodToJSONSchema`：未处理 `ZodUnion`/`ZodLiteral`（兜底 `{}`）；`.optional().describe()` 的描述在 Optional 包装层，unwrap 时丢掉；用了不存在的 `_def.optionalValidator` 判断必填，导致 optional 一律进 required。
- **修复**：补全 literal/union（字面量联合折叠为 `enum`）、从包装层回填 description、按 `ZodOptional`/`ZodDefault` 排除 required；顺带带上 string/number 的 pattern、min/max、int。

---

## 2026-08-18 · nongyu-agent-gui / nongyu-agent-sdk · 开发脚本硬编码 LLM Key 入库

- **现象**：`packages/nongyu-agent-gui/dev/main.tsx`、`packages/nongyu-agent-sdk/test/debug-cli.ts` 含明文 DeepSeek Key（及注释中的智谱 Key），会随仓库扩散。
- **根因**：本地调试为图省事把 Key 写进源码，未走环境变量。
- **修复**：改为必填环境变量（GUI：`VITE_AGENT_API_KEY`；SDK debug：`AGENT_API_KEY`）；补 `.env.example` 占位；`vite` `envDir` 指向包根；`pnpm debug` 用 `--env-file=.env`。真实 Key 仅本机 `.env`（gitignore）。已泄露 Key 需在服务商侧轮换。

---

## 2026-08-17 · nongyu-rn-app / web-admin · 管理台 handoff 外链可盗用 + 内置 WebView 白屏

- **现象**：应用内打开管理台先闪登录框再白屏；外置浏览器正常。且 ticket 在 URL 中时，外链理论上可被他人在 TTL 内免密进入管理台。
- **根因**：① ticket 放在登录 URL query，可分享；② 内置 WebView 在 SPA 导航时用全屏白底 loading，`onLoadStart` 再次触发后易盖死且无错误提示。
- **修复**：ticket 改为仅 App 内存短时槽 + WebView `injectedJavaScriptBeforeContentLoaded` 注入；管理台强制 `forceInApp`；Web 仅认注入 ticket、忽略 URL ticket；WebView 仅首屏遮罩并展示加载失败文案。

---

## 2026-08-17 · nongyu-agent-sdk · web_search 国内不稳定

- **现象**：自有 Key 下 `web_search` 经常超时/失败，体感不稳定。
- **根因**：工具抓取 `html.duckduckgo.com`；国内网络对 DDG 普遍不可达（连接超时），失败即 throw，无备源。
- **修复**：主源改为 Bing 中国站 HTML，失败或 0 条时降级搜狗；双失败返回结构化空结果（含 `error`），不再依赖 DDG。

---

## 2026-08-17 · nongyu-agent-sdk · web_detail 教务 GBK 页乱码/失败

- **现象**：抓取 `jiaowu.sicau.edu.cn` 通知详情（`charset=gb2312`）乱码或工具两次失败；HTTP 日志 title 亦为乱码。
- **根因**：① SDK 未显式依赖/`import` `buffer`，RN 上 `iconv-lite` 解 GBK 不可靠；② Dev HTTP logger 对 HTML 用 `text()` 按 UTF-8 解码，日志误导且可能与调用方 `arrayBuffer()` 争用 body。
- **修复**：`WebDetailTool` 对齐教务工具 `import { Buffer } from "buffer"`，meta 声明 gb* 时优先 GBK；去掉不可靠的 `encodingExists` 预检；logger 非 JSON 改为记 byteLength；SDK 增加 `buffer` 依赖。

---

## 2026-08-17 · nongyu-rn-app · 下雨特效天气改为前台 5 分钟刷新

- **现象**：原策略进程内只拉一次天气，无法跟随天气变化；需求改为进 App、前台定时、拨开关都要拉。
- **根因**：产品策略变更。
- **修复**：去掉 `fetchedOnce` 阻断；`refreshFromProfile` + inFlight 去重；Bootstrap 前台立即拉并每 5 分钟定时、后台停表；设置开关切换时触发刷新。

---

## 2026-08-17 · nongyu-rn-app · 下雨特效改为学院校区天气驱动（启动拉一次）

- **现象**：原预览版开关即下雨，缺少真实天气；用户要求不定位、按学院映射校区。
- **根因**：产品策略调整，非缺陷。
- **修复**：学院/校区 → 雅安|成都|都江堰坐标；Open-Meteo 进程内仅启动拉取一次；`rainEnabled && isRaining` 才显示雨效。

---

## 2026-08-17 · nongyu-rn-app · 下雨特效预览崩溃（undefined is not a function）

- **现象**：开启雨效后 App 崩溃，报 `TypeError: undefined is not a function`（UI 线程）。
- **根因**：`RainDrop` 在 worklet 回调里递归调用闭包 `cycle()`；Reanimated/Worklets 无法把该递归函数正确带到 UI 运行时，调用时为 `undefined`（栈：`RainOverlay.tsx:122`）。
- **修复**：取消 UI 线程递归；着地后 `runOnJS`，用 `setTimeout` 在 JS 侧重启下落；保留雨丝数量与涟漪对象池优化。

---

## 2026-08-17 · nongyu-rn-app · 下雨特效开启后卡顿

- **现象**：开启全局雨效后滑动/切换页面体感卡顿。
- **根因**：32 路独立动画 + 每次着地 `runOnJS`/`setState` 增删涟漪节点，JS 线程被频繁打断并重渲染叠层。
- **修复**：雨丝降至 16；下落循环改 UI 线程 `withDelay` 递归；涟漪改为 5 槽对象池（无 setState）；着地仅约 32% 触发涟漪。

---

## 2026-08-17 · nongyu-rn-app · 下雨特效 Worklets 疯狂告警（modify key `current`）

- **现象**：开启全局雨效后持续刷屏 `[Worklets] Tried to modify key current of an object which has been already passed to a worklet`。
- **根因**：`RainDrop` 的 `withTiming` 完成回调在 UI 线程捕获了 `activeRef`，随后 JS 侧写 `activeRef.current` 触发「已序列化对象不可再改 current」。
- **修复**：完成回调仅判断 `finished` 后 `runOnJS`；着地、重启循环全部在 JS 线程用 `alive` 标志控制，不再把 React ref 传入 worklet。

---

## 2026-08-17 · nongyu-rn-app · 大院详情留言输入条未跟随键盘 / 多行顶布局

- **现象**：帖子详情底部留言框在键盘弹出后未贴齐键盘上沿（尤其 Android）；多行输入时布局跳动。
- **根因**：`KeyboardAvoidingView` 仅 iOS 设 `behavior`，Android 无顶起；`TextInput` 使用 `flex:1` 易把外层撑乱。
- **修复**：`useComposerKeyboardInset` 按键盘高度垫高输入条；Android `softwareKeyboardLayoutMode: pan`；输入框 `maxHeight` + 内部滚动、去掉 flex 撑高；UI 改为 surface 底栏。

---

## 2026-08-17 · nongyu-rn-app · 「留言与回复」顶栏显示路由路径

- **现象**：进入「我的 → 留言与回复」时，系统导航栏左上角文案为路由地址（如 `mine/replies`），与自绘顶栏叠在一起。
- **根因**：`app/_layout.tsx` 已注册 `mine/posts` 等栈屏并设 `headerShown: false`，但漏注册 `mine/replies`；Expo Router 回退为默认 Stack header，title 取路由名。
- **修复**：补注册 `<Stack.Screen name="mine/replies" options={{ title: "留言与回复", headerShown: false }} />`；页面改用 `SettingsPageShell` 统一顶栏与背景。

---

## 2026-08-17 · nongyu-rn-app · dev-client 无法预览（Require cycle + ExpoLinearGradient）

- **现象**：Metro 报 `chatRunner` / `appClient→agent` Require cycle；`Unable to get the view config for default view from module &s ExpoLinearGradient`；dev-client 内 App 无法正常预览。
- **根因**：① `AgentChatRuntimeHost` 从 `@/agent/chatRunner` barrel 自引用，启动时 `useAgentChatRunnerBridge` / `installAgentChatBackgroundKeepAlive` 可能未初始化。② `handleAuthInvalid` 静态依赖 `agent`，经 tools 回到 `appClient` 形成环。③ 当前 native 包未注册 `ExpoLinearGradient` view config（`&s` 为 expo-modules-core 日志格式串笔误）；渐变首屏易红屏。
- **修复**：Host 改为相对路径导入并调整 barrel 导出顺序；`invalidateNongyuAgent` 改为动态 import；`AppLinearGradient` 在 `expo.getViewConfig` 缺失时纯色兜底。完整渐变需重建含 `expo-linear-gradient` 的 dev-client。

---

## 2026-08-17 · nongyu-node-server · 广场回复上线前 CR：admin_reply 并发与删留言未绑 post_id

- **现象**：CR 发现 `createAdminReply` 仅锁 `post_replies`，首次无行时并发可双插；删留言未校验 URL `post_id`；轮询置位无行锁可重复 toast；迁移与 `002_course_ext` 撞号。
- **根因**：空结果集行锁不可靠；WHERE 缺 `post_id`；SELECT 未 `FOR UPDATE`；迁移序号未对齐。
- **修复**：事务内先 `posts FOR UPDATE` 再插；删留言绑定 `post_id`；轮询 `FOR UPDATE`；迁移改名 `009_post_replies.sql`。

---

## 2026-08-17 · nongyu-node-server / nongyu-go-track-server · 大屏「当前在线」虚高、日活/趋势易误解

- **现象**：无人使用时「当前在线」仍为 1；今日有登录体感但「今日日活」为 0；趋势今日点常缺/为 0。
- **根因**：①「当前在线」读 MySQL `users.is_online`；登录会置 1，离线依赖 Track→Node 回写。回写失败或 App 未打到 Track 时，在线位可永久卡住（生产复现：Track `user_presence` 已离线，业务库仍 `is_online=1` 且 `last_active_at` 为昨日）。② 今日 Track `events` 为空时日活为 0 属口径正确（需装带 `EXPO_PUBLIC_TRACK_BASE_URL` 的包才会上报）。③ 趋势接口只读 `daily_metrics`，今日无聚合则今日点不准。
- **修复**：Node `getOverview` 先按 10 分钟窗口清理过期在线，再按 `is_online=1 AND last_active_at` 新鲜度计数；Track `usersync` 离线立即 flush；趋势区间含今天时 live 填今日点；补测试与文档。

---

## 2026-08-16 · nongyu-go-track-server · 管理端今日日活一直为 0

- **现象**：管理后台「今日日活」长期显示 0；Track overview 在已有 `app_open` 事件时仍返回 `dau=0`。
- **根因**：`handleOverview` 用 `dau==0 && app_open_count==0` 判断是否走 live。当日 `daily_metrics` 一旦被误写入/联调聚合写成 `app_open_count>0` 且 `dau=0`，就会跳过实时统计，一直读脏指标。契约上今日本就不该依赖当日聚合结果（定时任务只落历史日）。
- **修复**：今日 overview **始终**对 `events` 实时统计；空结果不写 live 缓存；`user_id<=0` 入库为 NULL；补回归测试；清理本地脏 `daily_metrics`。

---

## 2026-08-16 · nongyu-go-track-server · 大屏页面使用/性能维度一直为空

- **现象**：数据大屏「页面使用」「关键性能」列表始终为空。
- **根因**：`handleDims` 只读 `daily_dims`；日聚合定时任务只落**昨天**，而大屏默认查**今天** → 正常运行下今日 dims 永远空。
- **修复**：今日 dims 对 `events` live 汇总（`screen_view`/`button_click` 计数、`perf` 分位）；历史日仍读 `daily_dims`；补回归测试。

---

## 2026-08-16 · nongyu-rn-app · 生产包未配置 Track Base URL 导致大屏无数据

- **现象**：远端 Track 已部署且 live 正常，管理端日活仍为 0、页面/性能为空。
- **根因**：生产 Track `events` 为空。RN `eas.json` / `.env` 未注入 `EXPO_PUBLIC_TRACK_BASE_URL`，默认 `http://127.0.0.1:8082`，真机事件到不了 `https://47.108.74.61`。
- **修复**：`eas.json` preview/production 与 `.env` 写入 `EXPO_PUBLIC_TRACK_BASE_URL=https://47.108.74.61`；需重新打包/重装 App 后事件才会进库。

---

## 2026-08-16 · nongyu-rn-app · CourseScreen 渲染中更新 CourseWidgetSyncHost

- **现象**：红屏/警告 `Cannot update a component (CourseWidgetSyncHost) while rendering a different component (CourseScreen)`。
- **根因**：`CourseWidgetSyncHost` 订阅 `queryCache`，课表页 `useQuery` 等在 render 路径同步触发 `updated`；订阅回调里立刻 `setCacheTick`。
- **修复**：`setCacheTick` 改为 `queueMicrotask` 延后，并合并同拍多次 notify。

---

## 2026-08-16 · nongyu-rn-app · 启动闪屏只显示中间小图

- **现象**：冷启动闪屏图缩在屏幕中央，未铺满（重打 dev-client 后依旧）。
- **根因**：Android 12+ / 当前 `expo-splash-screen@57` 把 `image` 当 **居中启动图标**（默认约 100～180dp），`enableFullScreenImage_legacy` **仅作用于 iOS**；把全屏竖图塞进该槽位会缩成中间一小块。
- **修复**：① 原生 Android 改用 `adaptive-icon` + 底色作极短过渡；iOS 仍可用 legacy 全屏图；② 新增 `BootSplashOverlay`：RN 起来后立即 `hide` 系统启动屏，用 `resizeMode: cover` 全屏展示 `splash-icon.jpg` 直到会话门禁就绪。JS 层改动 Metro 热更即可验；原生配置变更需重建壳。

---

## 2026-08-16 · nongyu-rn-app · 登录学号边输边校验

- **现象**：学号未满 9 位即标红，且主按钮不可点。
- **根因**：`JiaowuLoginForm` 在 `onChangeText` 实时校验并绑定 `canSubmit`。
- **修复**：输入中只清错误态；9 位规则与 Toast 仅在提交时触发；有密码即可点登录。

---

## 2026-08-16 · nongyu-rn-app / node-server · 登录后广场提示缺少 Token

- **现象**：教务登录成功进入 App 后，广场报「未登录或缺少联调 Token」。
- **根因**：① 登录门禁不强制 Node JWT，签发失败仍进主界面；② 长地址等字段超 Node schema 上限会导致签发 400；③ 部分构建 API Base 指向不可达的 `:3000` / 未注入 env；④ 错误文案误导为「联调」。
- **修复**：RN 登录体字段截断与性别清洗；`ensureAppAccessToken` 供广场重试补签发；文案去「联调」；`eas.json` preview/production 注入 `https://8.137.82.17`；Node `appLoginSchema` 超长截断、异常 gender 按未知。

---

## 2026-08-16 · nongyu-rn-app · EAS Gradle 打 JS 包找不到 babel-preset-expo

- **现象**：`eas:build:prod` 在 Run gradlew 的 `:app:createBundleReleaseJsAndAssets` 失败：`Cannot find module 'babel-preset-expo'`（EAGER_BUNDLE 已成功）。
- **根因**：pnpm 隔离下 Gradle 内 Babel 从 `@babel/core` 目录解析字符串 preset；`babel-preset-expo` 不是应用直接依赖。
- **修复**：直接安装 `babel-preset-expo` / `expo-font`；`babel.config.js` 改为 `require.resolve`；仓库 `.npmrc` hoist 该 preset；去掉小组件 `file:` 依赖以免与 `nativeModulesDir` 重复 autolink；删除已无效的 `android.edgeToEdgeEnabled`。

---

## 2026-08-16 · nongyu-rn-app · EAS Android Gradle 配置小组件失败

- **现象**：`eas:build:prod` 在 Run gradlew 阶段失败：`Failed to apply plugin 'expo-autolinking'`，并提示 `'android.defaultConfig.versionName' is not defined`。
- **根因**：本地模块 `nongyu-android-widget` 的 `android/build.gradle` 未声明 `defaultConfig.versionName`；模块原生目录入库后，EAS 才会真正配置该 library。
- **修复**：补齐 `versionCode 1` / `versionName "1.0.0"`。

---

## 2026-08-16 · nongyu-rn-app · EAS Android Bundle JavaScript 失败

- **现象**：`eas:build:prod` 在 Bundle JavaScript / EAGER_BUNDLE 阶段失败；日志提示找不到 `nongyu-tool-jiaowu` 的 `dist/index.js`。
- **根因**：workspace 包入口指向 `dist/`，而仓库根 `.gitignore` 忽略了 `dist/`，EAS 按 git 上传源码后远端没有构建产物；本地因已有 `dist/` 可过。
- **修复**：`apps/nongyu-rn-app` 增加 `eas-build-post-install`，在安装依赖后构建 `nongyu-tool-jiaowu` / `nongyu-tool-second` / `nongyu-agent-sdk`；上述包补齐 `tsup`/`typescript` 为自身 `devDependencies`。另将应用 `.gitignore` 的 `android/`/`ios/` 改为仅根目录 `/android/`/`/ios/`，避免本地 Expo 模块原生目录被误忽略。

---

## 2026-08-16 · nongyu-tool-jiaowu · 教学/竞赛通知清洗漏条与串区

- **现象**：教务首页「教学通知」「竞赛通知」解析不完整；带 `onclick` 的条目丢失，并可能混入长期公告/新闻动态。
- **根因**：① 正则要求 `title="..." >` 紧邻，无法匹配 `title` 与 `>` 之间的其它属性；② 教学通知从「教学通知」起向后扫到上限，未限制在首个 `ul.notice1`；③ 竞赛通知未用「竞赛通知内容结束」收口。
- **修复**：属性顺序无关的 `<a href+title>` 正则；教学通知只切首个 `notice1` 列表；竞赛通知在开始/结束注释之间切片；补充 fixture 校验脚本。

---

## 2026-08-16 · nongyu-rn-app · 打开课程详情 TypeError undefined is not a function

- **现象**：打开带考勤的课程详情红屏 / 报 `TypeError: undefined is not a function`。
- **根因**：`listAttendancesForCourse` 使用 `Array.prototype.toSorted`，Hermes 未实现。
- **修复**：改为 `.slice().sort(...)`。

---

## 2026-08-16 · nongyu-rn-app · 课程详情 VirtualizedList 嵌套警告

- **现象**：打开课程详情时控制台报 `VirtualizedLists should never be nested inside plain ScrollViews`。
- **根因**：备注/待办限高列表用 RNGH `FlatList`（VirtualizedList）嵌在 `BottomSheetScrollView` 内。
- **修复**：改回 RNGH `ScrollView` + `map` 渲染，保留滑动时锁定外层 sheet 滚动；手势策略不变。

---

## 2026-08-16 · nongyu-rn-app · 课程详情备注/待办列表无法滚动

- **现象**：详情弹层内备注（及待办）限高列表滑不动。
- **根因**：① 嵌套在 `BottomSheetScrollView` 内外层抢手势；② 待办整行 `Pressable` 吞掉纵向滑动。
- **修复**：列表改 RNGH `FlatList` + 滑动时锁定外层滚动；待办仅复选框可点切换，行容器改为 `View`。

---

## 2026-08-16 · nongyu-rn-app · 大卡片课表末行上课时间被底栏挡住

- **现象**：卡片大小为「大」时，左下角上课时间滚到底仍显示不全，易被悬浮 Tab 遮挡。
- **根因**：`WeekGrid` 表头在 `ScrollView` 外，但 `ScrollView` 仍用整页 `pageHeight` 作 `maxHeight`，可视区实际伸进底栏；且滚动内容无底部留白。
- **修复**：外层固定为 `pageHeight`，`ScrollView` 改为 `flex:1` 占满表头剩余高度；**仅大卡片**在 `contentContainerStyle` 增加底部 padding，中/小档不加额外留白。

---

## 2026-08-16 · nongyu-rn-app · Metro 无法解析 nongyu-android-widget

- **现象**：`expo start` 预览 bundling 失败：`Unable to resolve "nongyu-android-widget"`（`writeWidgetSchedule.ts`）。
- **根因**：依赖为 `file:./modules/nongyu-android-widget`；pnpm 在 Windows 上将其 junction 到空的 `.pnpm` store，Metro 只查 `node_modules` 因而解析失败。
- **修复**：`writeWidgetSchedule` 改为 `requireOptionalNativeModule`，不再 import 该包名；`metro.config.js` `extraNodeModules` 与 `tsconfig` paths 仍直指模块源码，避免其它入口再踩空 junction。

---

## 2026-08-16 · nongyu-rn-app · 小组件同步 Maximum update depth exceeded

- **现象**：bundling 通过后预览红屏，栈指向 `CourseWidgetSyncHost` 的 `setCacheTick`。
- **根因**：`queryCache.subscribe` 对 observer 类事件也 `setState`；子组件 setState 导致父树重渲染 → observer 再通知 → 无限循环。
- **修复**：订阅只处理 `added` / `updated` / `removed`。

---

## 2026-08-16 · nongyu-rn-app · 设置项变更缺少 Toast

- **现象**：课表卡片/字号、主题、启动页、网页跳转、Agent 上下文、开学日等改完无成功/失败反馈。
- **根因**：设置 UI 直接调 store setter，未统一 Toast。
- **修复**：各设置屏变更路径补 `toast.success` / `toast.error`；清除背景失败改为错误提示；退出登录失败补 error。

---

## 2026-08-16 · nongyu-rn-app · 删除日程/备注/待办成功无 Toast

- **现象**：确认删除后无成功反馈。
- **根因**：删除成功路径未调用 `toast.success`。
- **修复**：日程「日程已删除」；备注/待办确认删除后分别提示「备注已删除」「待办已删除」。

---

## 2026-08-16 · nongyu-rn-app · 添加/编辑日程成功无 Toast

- **现象**：保存自定义日程后弹层关闭，无成功反馈（仅重叠时有 info）。
- **根因**：`onSubmitSchedule` 成功路径未调用 `toast.success`。
- **修复**：新增成功提示「日程已添加」、编辑「日程已更新」；重叠 info 保留。

---

## 2026-08-15 · nongyu-rn-app · 日程删除无确认弹窗

- **现象**：编辑自定义日程时点「删除日程」直接删除，无二次确认。
- **根因**：`ScheduleFormSheet.handleDelete` 未走全局 `confirm`；备注/待办已有确认，日程遗漏。
- **修复**：删除前调用 `confirm`（destructive，文案对齐备注/待办）；Spec §4.8 同步约定。

---

## 2026-08-15 · nongyu-rn-app · 课表 Maximum update depth exceeded

- **现象**：进入课表 Tab 后报 `Maximum update depth exceeded`，页面卡死/红屏。
- **根因**：① `CourseScreen` 只读模式 `displaySchedules = []` 每次 render 新引用；② `useCourseExt` 在 `data` 未就绪时用内联 `{ schedules: [] }` 兜底，同样每帧新引用；二者进入依赖 `displaySchedules` 的 `useEffect` → `setMatrixTick` → 再渲染死循环。
- **修复**：模块级稳定空数组/`EMPTY_COURSE_EXT`；只读与未就绪路径复用同一引用。

---

## 2026-08-15 · nongyu-rn-app · 课表 Tab 进入即崩溃

- **现象**：点进课表 Tab 后页面崩溃红屏。
- **根因**：优化弹层时给 `BottomSheetModal` 传了 `containerHeight`；`@gorhom/bottom-sheet` v5 的 `usePropsValidator` 对该 prop 直接 `invariant`（已弃用，改用 `containerLayoutState`）。
- **修复**：去掉两处 Sheet 的 `containerHeight`，保留 `enableDynamicSizing={false}` 等其余优化。

---

## 2026-08-15 · nongyu-rn-app · 课表详情/日程弹层打开动画卡顿

- **现象**：点击课程卡或日程卡后 BottomSheet 上滑不够流畅、掉帧。
- **根因**：① `setState` 与 `present()` 同步执行，整页 `CourseScreen`/`WeekPager` 重渲与上滑动画抢 JS；② `@gorhom/bottom-sheet` v5 默认 `enableDynamicSizing` 仍测高；③ 详情扩展区（考勤/备注/待办）与动画同期挂载。
- **修复**：`present` 延到下一帧；Sheet 设 `enableDynamicSizing={false}`（勿传已弃用的 `containerHeight`）；`WeekPager` `memo`；详情扩展区在 `onChange` 到位后再挂载。

---

## 2026-08-15 · nongyu-rn-app · 二课登录成功仍停在登录页

- **现象**：二课登录成功后仍停留在登录页，未自动退出。
- **根因**：成功后的离页仅依赖 `canGoBack`/`replace`，对 expo-router 的 `returnTo` 数组形态与可 dismiss 栈处理不足。
- **修复**：`leaveSecondLoginPage`：优先 `returnTo` replace → `dismiss` → `back` → 兜底 replace `/home/second`。

---

## 2026-08-15 · nongyu-rn-app · 二课自动重登失败未强制手动登录

- **现象**：本地二课密码失效时自动重登失败，仅 Toast，未清无效密码也未进入登录页。
- **根因**：`onRefreshFailed` 只清了内存 token，未 `clearSecondPassword`，也未跳转 `/home/second/login`；冷启动学号仅依赖教务 SecureStore，缺 profile 兜底。
- **修复**：失败时清无效密码 + Toast + 跳转登录页；bootstrap 用 session.profile.studentId 兜底；文档同步验收点。

---

## 2026-08-15 · nongyu-rn-app / nongyu-tool-second · 二课 token 过期未无感重登

- **现象**：二课会话过期后业务请求失败，需用户手动再登；并发请求可能多次打登录。
- **根因**：工具层虽有简单重登，但缺并发排队、HTTP 401/403 触发、App 侧 MMKV 回写与失败提示；与旧版 RN 拦截器不对齐。
- **修复**：`request` 拦截器对齐旧版（code=5/过期文案/401·403 + 队列单飞 login）；`attachSecondAuthRefreshHooks` + App bridge 写 MMKV / Toast / 失败清会话。

---

## 2026-08-15 · nongyu-rn-app · 课表连堂未合并成一张卡

- **现象**：跨两大课区间的连堂（或教务拆成多行的相邻时段）显示为两张独立卡片，不像合并单元格。
- **根因**：① 教务常把 `1-2`/`3-4` 拆成多条 `CourseEntry`，`spanRows` 各为 1；② 跨行加高时未计入行缝，且下行会盖住溢出卡片。
- **修复**：`mergeAdjacentTimeEntries` + `mergeAdjacentCourseEntries`（映射与读本地缓存）；`WeekGrid` 跨行高度含 `ROW_GAP`，有 span 的行抬高 zIndex/elevation。

---

## 2026-08-15 · nongyu-rn-app · 课表弹层打开时返回键未先关闭弹层

- **现象**：课表点卡片打开详情/日程 BottomSheet 后，按 Android 返回键未优先关弹层，而是触发其它返回行为。
- **根因**：`@gorhom/bottom-sheet` 的 `BottomSheetModal` 不自动拦截 `hardwareBackPress`。
- **修复**：`CourseScreen` 在详情或日程表单打开时注册 `BackHandler`，先 `dismiss()` 并 `return true`。

---

## 2026-08-15 · nongyu-rn-app · 登录页时段问候写死「晚上好」

- **现象**：登录页欢迎语始终显示「晚上好」，与当前时刻无关。
- **根因**：`LoginScreen` 将整句欢迎文案写成常量，未按时段拼接。
- **修复**：复用 `guestGreeting()`，按小时生成「夜深了 / 早上好 / 中午好 / 下午好 / 晚上好」再拼副文案。

---

## 2026-08-15 · nongyu-rn-app · 退出登录后课表背景图仍保留

- **现象**：用户设置课表背景图后退出登录，再进课表仍显示原背景。
- **根因**：`performJiaowuLogout` / `clearLocalAuthSession` 只清了课表条目与扩展数据，未调用 `clearPersistedCourseBackground`，也未清 `courseUiStore` / MMKV 中的背景 URI。
- **修复**：两条登出路径均删除本地背景文件并 `setBackgroundUri(null)`；确认框清单补充「课表背景图」。

---

## 2026-08-15 · nongyu-rn-app · AI 页键盘弹出未顶起输入框

- **现象**：调起系统键盘后输入框仍被挡住，无法边看输入边打字。
- **根因**：`KeyboardAvoidingView` 在 Android 为 `behavior={undefined}` 且项目开启 `edgeToEdgeEnabled`，避让失效；iOS 仅靠小 offset 也不稳。
- **修复**：监听 `keyboardWill/DidShow|Hide`，用键盘高度显式增加 composer 的 `paddingBottom`（键盘升起时用 `keyboardHeight + 8`，收起后回落到 safe area）。

---

## 2026-08-15 · nongyu-node-server · migrate 在 002_course_ext 失败

- **现象**：`pnpm --filter nongyu-node-server migrate` 报 `BLOB, TEXT, GEOMETRY or JSON column 'weeks_list' can't have a default value`，后续 `004_course_share` 无法应用。
- **根因**：`002_course_ext.sql` 中 `weeks_list TEXT NOT NULL DEFAULT '[]'`，当前 MySQL 模式不允许 TEXT 列带非空默认值。
- **修复**：去掉 `weeks_list` 的 `DEFAULT '[]'`（插入路径始终写入 JSON 字符串）；重新执行 migrate。

---

## 2026-08-15 · nongyu-rn-app · Agent 页从卡片跳转返回后聊天被重置

- **现象**：在 AI 聊天中点击可交互卡片进入其他页面，返回后对话回到欢迎语/丢失当前消息。
- **根因**：`ai.tsx` 每次 `useFocusEffect` 先 `setAgent(undefined)`，卸载 `AiChatPanel`；同会话 hydrate 又因 `activeSessionId` 未变而跳过从 MMKV 刷新 `initialMessages`，面板用过期初始消息 remount。
- **修复**：焦点刷新 Agent 时不再先置 `undefined`（保活面板内存态）；用 `chatMountedRef` 区分「面板仍在」与「曾卸载」——仅后者强制从本地重载 messages；失焦仍 stop+落盘。
- **文档**：`specs/农屿Agent会话管理.md` 回页约定与验收补充。

---

## 2026-08-15 · nongyu-rn-app · `CourseScreen.tsx` 出现多处乱码导致 JSX 语法错误

- **现象**：`pnpm --filter nongyu-rn-app type-check` 报大量 `Unterminated string literal` / `JSX element 'Text' has no corresponding closing tag` / `Expression expected`，集中在 `src/modules/course/screens/CourseScreen.tsx`。
- **根因**：文件中多个中文字符串被替换为 Unicode 替换字符 `U+FFFD`（显示为 `?`），同时 `</Text>` 等闭合标签被连带破坏，导致字符串未闭合、JSX 标签不配对。
- **修复**：移除文件中的 `U+FFFD` 替换字符，修复损坏的字符串字面量（如“已保留本地课表”、“课表已更新”、“农屿课程表”、“设置开学日期”、“登录后加载课表”）及对应的 `</Text>` 闭合标签；随后类型检查通过。

---

## 2026-08-15 · nongyu-rn-app · 课表扩展数据无法同步到远程

- **现象**：用户自定义日程 / 课程备注 / 课程待办新增后，本地可见但远程数据库无对应记录；下次进课表后本地条目消失。
- **根因**：
  1. `id` 生成 fallback 不合法。`CourseScreen` / `ScheduleFormSheet` / `courseTools.ts` 三处的 `genExtId()` 在 `crypto.randomUUID` 不可用时回退为 `x-<timestamp>-<hex>`，非 RFC4122 UUID。Node 服务器 schema 为 `id: z.string().uuid()`，校验失败返回 400，`appFetch` 抛错被 repository `catch` 静默吞掉 → 本地有、远程无。RN/Hermes 运行时不保证全局 `crypto.randomUUID`。
  2. `pullCourseExt` 全量覆盖本地。远程拉取后直接 `writeLocalSchedules(...)` 覆盖本地，导致失败的写（含上面 uuid bug 产生的）在下次 pull 时被远程（无该条目）覆盖丢失。
- **修复**：
  1. 新增 `src/modules/course/model/genId.ts` 的 `newCourseExtId()`，复用项目 `telemetry/ids.ts` 同源思路（优先 `crypto.randomUUID`，否则用随机字节手搓 RFC4122 v4），三处全部改用此函数，保证服务器 uuid 校验通过。
  2. `pullCourseExt` 改为按 id 合并：远程权威覆盖同 id 本地，保留本地存在但远程尚未同步的条目（`mergeById`），避免失败写被全量覆盖丢失。
- **验证**：`pnpm --filter nongyu-rn-app type-check` 通过，course 模块 lint 无错误。

---

## 2026-08-15 · nongyu-rn-app + node-server · 课表扩展 outbox / tombstone 同步

- **现象**：远程写失败无重推；跨设备删除不传播（A 删后 B 本地仍保留）。
- **根因**：仅「失败静默保留本地」+「mergeById 保留本地独有项」，缺少失败队列与删除墓碑。
- **修复**：
  1. Node：`003_course_ext_tombstones.sql`；DELETE 幂等写 tombstone；`GET /api/app/course-ext/tombstones`（近 30 天）。
  2. RN：MMKV outbox / tombstones；写失败入队；删除写本地 tombstone；`pullCourseExt` 合并 tombstone 后 `flushOutbox`；`AppState` active 时 flush；登出清 outbox+tombstone。
- **文档**：`specs|tech|plans/课表扩展同步协议-Outbox与Tombstone.md`
- **验证**：RN / Node type-check 通过。

---

## 2026-08-15 · nongyu-rn-app · 主题设置页左上角显示路由路径

- **现象**：进入「主题与外观」时，系统导航头左上角显示类似 `mine/settings/theme` 的路径文案。
- **根因**：根 Stack 未注册 `mine/settings/theme`，未设 `headerShown: false`，Expo Router 回退默认 header（标题取路由名）。
- **修复**：在 `app/_layout.tsx` 补注册该屏，`title: "主题与外观"` 且 `headerShown: false`，仅保留 `SettingsPageShell` 自定义顶栏。

---

## 2026-08-15 · nongyu-rn-app · 主题改造后预览红屏 `Property 't' doesn't exist`

- **现象**：主题跟色改造后 Expo 预览红屏崩溃；堆栈指向 `TabsLayout` / `GlassPanel`。
- **根因**：批量迁移时曾把 `GlassPanel` 默认参数写成 `intensity = t.tabBar…`（`t` 仅存在于函数体/`useThemeTokens` 之后）；形参默认值在入参作用域求值，`t` 未定义 → Hermes `ReferenceError: Property 't' doesn't exist`。底栏一渲染即崩。
- **修复**：默认玻璃色改在函数体内 `useThemeTokens()` 后再 `??` 回退；`(tabs)/_layout` 使用 `theme` 取背景色；禁止再在形参默认值引用主题 hook 结果。

---

## 2026-08-15 · nongyu-rn-app · 首页通知栏常显固定占位、不像最新公告

- **现象**：通知栏长期显示「欢迎使用农屿，这是农屿的官方通知栏~」，不像在展示最新公告。
- **根因**：① 接口 `announcements/latest` 常返回 `data: null`（库无公告）或 Token 失败时按 Spec 回退固定占位；② `useNoticeBootstrap` 仅挂载拉一次，会话/Token 就绪晚于首次请求或失败后不会重试。
- **修复**：改为 React Query，等 `hydrated` 且有 Token 再请求；回到首页 `useFocusEffect` 触发 refetch。

---

## 2026-08-15 · nongyu-agent-sdk · RN 预览因 readline 打包失败闪退

- **现象**：Expo/Metro 预览 App 打开即闪退或白屏起不来；终端报 `You attempted to import the Node standard library module "readline" from packages/nongyu-agent-sdk/dist/index.js`。
- **根因**：主入口 `src/index.ts` 导出了仅 Node CLI 使用的 `StdioChannel`（依赖 `node:readline`），且 tsup 打成单文件主包；RN 引用 `createAgent`/`useAgentChat` 时仍会解析到 `readline`，Metro 打包失败。
- **修复**：主入口移除 `StdioChannel`；新增子路径入口 `nongyu-agent-sdk/stdio`（`src/stdio.ts` + `exports["./stdio"]`）；TECH-DESIGN §13.2 同步约定；重建 `dist` 后主包不再含 `readline`。

---

## 2026-08-15 · nongyu-agent-sdk · 并发同名工具调用结果回填错位

- **现象**：一条 assistant 消息内若模型并发调用多个同名工具（如两次 `weather_query`），`tool:result` 回来后结果会错填到第一条记录，导致卡片显示错乱或永远停留在 executing。
- **根因**：`useAgentChat.ts` 的 `tool:result` 分支用 `tc.toolName === chunk.toolName && tc.output === undefined` 匹配回填，同名并发时第一条 output 一旦填充，后续结果无法再匹配到第二条；且模型 `ToolCall.id` 已在 `AgentLoop` 解析但未透传到流式块与 `ToolCallRecord`。
- **修复**：
  1. `AgentStreamChunk` 的 `tool:call`/`tool:result`/`tool:error` 增加可选 `callId`（取自模型 `ToolCall.id`），`AgentLoop` 透传；
  2. `ToolCallRecord` 增加 `callId/status/error/renderComponent`；
  3. `useAgentChat` 改用 `matchCall` 优先按 `callId` 精确匹配回填，`callId` 缺失时降级为按 `toolName && output===undefined`（兼容旧调用方）。
- **关联**：见 `docs/nongyu-rn-app/tech/Agent生成UI渲染能力-技术方案.md` §4.2、`docs/nongyu-rn-app/plans/AI生成UI渲染能力-实施计划.md` S2/S3。

---

## 2026-08-15 · nongyu-rn-app · 课表 UI 偏离旧版观感

- **现象**：课表页出现玻璃拟态表头、叶脉色条卡片、英文 eyebrow、「本周课表」等自造样式，与旧版农屿课表不一致。
- **根因**：Phase 2「视觉升级」未严格对照 `old-code/.../CourseTable`，自行改写布局与配色。
- **修复**：按旧版 WeekSlide / Course 页头还原：居中卡片色板、双节次时间列、「第N周/共M周」表头、右侧半圆回本周按钮；色值走主题 Token，卡片色池沿用旧版 COURSE_COLORS。

---

## 2026-08-15 · 广场 · 大院帖子对用户暴露署名

- **现象**：农屿大院列表/详情对普通用户展示 `authorDisplayName`（真实姓名），破坏用户间匿名。
- **根因**：App 帖子序列化对 `courtyard` 故意下发作者名；RN `PostCard`/`PostDetailScreen` 同步展示。与 PRD（卡片仅时间/类型/标题/内容）及「反馈墙+大院对用户匿名」规则冲突。
- **修复**：App 列表/详情恒返回 `authorDisplayName: null`；RN 去掉署名展示；管理端仍返回 `authorName`/`authorStudentNo`；补充匿名回归单测。

---

## 2026-08-14 · nongyu-tool-jiaowu · check.asp 报「请通过正常链接重新登录」

- **现象**：`POST check.asp` HTTP 200，解码后 `alert`「验证失败，请通过正常链接重新登录！」，随后档案页仍无会话。
- **根因**：教务要求同一次会话先打开登录页再提交。冻浏览器 curl 里的 Cookie / `sign` / `hour_key` 重放，或跳过 GET `index.asp`，都会被当成非正常入口。
- **修复**：`jiaowuLogin` 先 GET `web/web/web/index.asp`，从 hidden 解析当页 `sign` / `hour_key` 再 POST；解析失败中止，禁止回退固定值。已验证链路见 `docs/nongyu-rn-app/tech/教务鉴权方案.md` §8。

## 2026-08-14 · nongyu-node-server · PATCH /users/me 改 QQ 返回 500

- **现象**：`settings.users` 单测 `PATCH /api/app/users/me` 期望 200，实际 500。
- **根因**：落地 Track 内部 presence 时误把 `updateUserQq` 整段替换成 `updateUserPresence`，路由仍调用已删除函数。
- **修复**：恢复 `updateUserQq`，presence 更新作为独立函数并存。

## 2026-08-14 · nongyu-tool-jiaowu · 教务登录误判成功，档案页报登录超时

- **现象**：`POST check.asp` 日志为 OK（200、约 122 字节 ArrayBuffer），随后 `GET bjiben.asp` 失败，错误为「登录超时且已尝试过重新登录」。
- **根因**：axios 对教务响应使用 `arraybuffer`；`check.asp` 拦截器跳过 GBK 解码。`jiaowuLogin` 只用「body 是否为以 `<script` 开头的字符串」判失败，ArrayBuffer 永远判成功。失败页（alert 短脚本）被当成登录成功，后续请求无有效会话。
- **修复**：登录响应同样 GBK 解码，但不走超时自动重登；按 `alert` / `history.back` 判失败并透出教务文案，`location` 跳转或 302 判成功；Cookie 优先取响应 `Set-Cookie`。

## 2026-08-13 · nongyu-rn-app · 教务页 bundling 失败（白屏）

- **现象**：进入教务相关路由后 Metro `Android Bundling failed`；日志提示 `iconv-lite` 导入 Node 内置 `string_decoder` 失败。
- **根因**：`nongyu-tool-jiaowu` 用 `iconv-lite` 解教务 GBK 响应；该库会 `require("string_decoder")`，Hermes/Metro 默认不含 Node 标准库。
- **修复**：在 `apps/nongyu-rn-app/metro.config.js` 的 `resolver.extraNodeModules` 将 `string_decoder`、`buffer` 映射到 npm polyfill；App 显式依赖 `string_decoder`、`buffer`。重启 Metro（建议 `--clear`）后生效。

## 2026-08-13 · nongyu-rn-app · 悬浮底栏 `blurTarget` 未接通

- **现象**：Metro 反复 WARN：`dimezisBlurViewSdk31Plus` 未配置 `blurTarget`，Blur 回退为 `none`。
- **根因**：`FloatingTabBar` 写在 `BlurTargetRoot`（Provider+Surface 合一）外侧，拿不到 Context，Android 毛玻璃采样目标为空。
- **修复**：拆成 `BlurTargetProvider` + `BlurTargetSurface`；Provider 同时包住页面与底栏，Surface 只包 Tab 页面作采样目标（见 `BlurTargetContext.tsx`、`app/(tabs)/_layout.tsx`）。

## 2026-08-13 · nongyu-rn-app · 预览闪退出 Dev Client 壳

- **现象**：热更新/进首页后原生壳直接闪退；Metro 同时刷 SecureStore Invalid key。
- **根因**：
  1. 网站搜索框在 `BlurTargetView` **内部**再套 `GlassPanel`/`BlurView`，Android 嵌套真模糊易原生崩溃；
  2. SecureStore key 使用了非法字符 `:`（如 `jiaowu:student_id`），冷启动读凭据抛错。
- **修复**：搜索框改为半透明白底玻璃拟态（不套 BlurView）；凭据 key 改为 `jiaowu_student_id` / `jiaowu_password`，读写加 try/catch。真模糊仅用于底栏等 **BlurTarget 外侧** 组件。

## 2026-08-13 · nongyu-rn-app · 首页通知栏整栏消失

- **现象**：首页问候下方通知栏不见（反复出现）。
- **根因**：
  1. `useNoticeBootstrap` / `NoticeBar` 在无数据时 `notice=null` + `return null`；
  2. 《广场功能》Spec §4.6 / 验收 #8 曾写「无公告优先隐藏」，后续广场联调改动按旧 Spec 又盖回隐藏逻辑。
- **修复**：无 Token / 无数据 / 失败一律回退 `FIXED_NOTICE`；`notice` 恒有值；同步修订《广场功能》Spec/Plan 为「禁止隐藏、必须占位」。

## 2026-08-13 · nongyu-rn-app · AI 引导气泡文案变省略号

- **现象**：农屿 AI 入口气泡只显示「…」，完整提示文案看不到。
- **根因**：气泡挂在仅圆钮宽度的 `aiAnchor` 内；Android 上绝对定位子视图未设宽度时会吃到父宽，再叠加 `numberOfLines={1}` 即被截成省略号。
- **修复**：气泡容器给明确宽度（约 210）、去掉单行截断；`aiAnchor` 设 `overflow: visible`。

## 2026-08-13 · nongyu-rn-app · 帖子详情缺骨架屏

- **现象**：打开帖子详情首次加载仅显示「加载中…」文案，无骨架。
- **根因**：实现时详情态只写了文本 hint，未复用 `SkeletonBox` 做标题/正文占位。
- **修复**：新增 `PostDetailSkeleton`，`PostDetailScreen` 在 `isPending` 时渲染；Spec §4.4 补「首次加载须骨架」。

## 2026-08-14 · nongyu-rn-app · 登录页对齐 old-code 后再次变回简版

- **现象**：登录页又变成「教务登录」简表单，看不到 Logo /「欢迎来到农屿」/「进入农屿」等旧版对齐 UI。
- **根因**：路由入口 `app/login.tsx` 与 `JiaowuLoginForm.tsx` 被覆盖回对齐前实现，未再引用已存在的 `modules/auth/screens/LoginScreen.tsx`。
- **修复**：`app/login.tsx` 恢复为导出对齐版 `LoginScreen`；`JiaowuLoginForm` 非 compact 恢复描边输入、密码显隐、「进入农屿」、隐私提示。

---

## 2026-08-15 · nongyu-rn-app · 课表待办 `dueDate` 类型与实际数据不一致

- **现象**：`pnpm --filter nongyu-rn-app type-check` 报 `courseExtRepository.ts(168,5)`：`dueDate` 的 `string | null | undefined` 无法赋值给 `CourseTodo.dueDate` 的 `string | undefined`。
- **根因**：`CourseTodo` 类型将 `dueDate` 定义为 `string | undefined`，但 `editTodo` 的 patch 允许传入 `string | null`，且本地存储读取后 `null` 会被保留；类型与实际数据流不一致。
- **修复**：`src/modules/course/model/types.ts` 将 `CourseTodo.dueDate` 放宽为 `string | null | undefined`，与 `completedAt` 的 nullable 语义保持一致。

---

## 2026-08-15 · nongyu-rn-app · FlashList 2.0.2 不支持 `estimatedItemSize` 属性

- **现象**：按技术方案给 `FlashList` 加 `estimatedItemSize` 后 `type-check` 报错：`Property 'estimatedItemSize' does not exist on type 'FlashListProps<...>'`。
- **根因**：RN 项目当前锁定的 `@shopify/flash-list@2.0.2` 的 `FlashListProps` 尚未引入 `estimatedItemSize` 字段（该字段在后续版本才成为必填项），其 API 与最新版不同。
- **修复**：移除 `MessageList` 和 `SecondActivityListCard` 中新增的 `estimatedItemSize`，保持与现有依赖版本兼容；后续升级 FlashList 大版本时重新评估该属性。

---

## 2026-08-15 · nongyu-rn-app · `createThemedStyles` 组件在 `useStyles` 定义前使用 `styles`/`t`

- **现象**：`type-check` 报大量 `Cannot find name 'styles'` / `Cannot find name 't'` / `Cannot find name 'lightTokens'`，涉及 `SkeletonBox`、`ProgressScreen`、`RankScreen`、`SecondActivitiesScreen`、`SecondProfileScreen` 等。
- **根因**：这些组件把辅助子组件（如 `FilterModal`、`ModalRow`、`NoticeBarSkeleton`、`Meta`、`RankExhibit`）写在 `const useStyles = createThemedStyles(...)` 之前，子组件直接使用外部作用域的 `styles` 或 `t`；而 `const` 不存在变量提升，TypeScript 严格检查下报错。
- **修复**：
  - 在需要样式的子组件内部调用 `useStyles()` / `useThemeTokens()`，而不是依赖外部变量；
  - `SkeletonBox` 将 `borderRadius` 默认值从 `t.radius.sm` 改为运行时读取 theme 的 `finalBorderRadius`；
  - 将部分子组件（如 `Meta`）移到 `useStyles` 定义之后或内部调用 hook。

---

## 2026-08-15 · nongyu-rn-app · 课表 Agent 工具 `day` 类型与 `ScheduleEntry` 不匹配

- **现象**：`src/modules/course/agent/courseTools.ts(107,39)` 报错：`day` 的 `number | undefined` 不能赋值给 `ScheduleEntry.day` 的联合类型 `1 | 2 | 3 | 4 | 5 | 6 | 7 | undefined`。
- **根因**：`daySchema` 使用 `z.number().int().min(1).max(7)`，zod 推导为 `number`，而 `editSchedule` 期望精确的星期字面量联合类型。
- **修复**：给 `daySchema` 增加 `.transform((v) => v as 1 | 2 | 3 | 4 | 5 | 6 | 7)`，使解析后类型与 `ScheduleEntry.day` 对齐。

---

## 2026-08-15 · nongyu-rn-app · 查看他人课表详情仍露出备注待办区

- **现象**：查看他人 / Diff 时点课程卡片，详情弹层仍显示备注、待办标题、空状态和输入框。
- **根因**：`CourseScreen` 只把 `notes`/`todos` 传成空数组，`CourseDetailSheet` 无只读开关，扩展区始终渲染。
- **修复**：详情增加 `readOnly`；peer/Diff 整段不渲染备注待办（含 composer）；只读时缩小 snap 高度。

---

## 2026-08-15 · nongyu-rn-app · Diff「退出对比」与「回到本周」重叠

- **现象**：对比双方课表且非本周时，「退出对比」与右侧「回到本周」半圆叠在一起，难以点按。
- **根因**：图例条把退出按钮 `marginLeft: auto` 靠右；`BackToCurrentWeekFab` 同样 `right: 0` 且 `top` 落在图例行。
- **修复**：「退出对比」改到顶栏原「对比课表」槽位；图例条只留模式切换与色点；半圆位置不变。

---

## 2026-08-15 · nongyu-web-admin · LLM Key 页白屏 / Vite 500

- **现象**：打开管理端（尤其 LLM Key 池页）崩溃白屏；Vite 对 `LlmProxyFailsPanel.tsx` 返回 500。
- **根因**：`src/components/llm/LlmProxyFailsPanel.tsx` 用 `../lib/*`、`../types/*`，实际应向上两级到 `src/lib`、`src/types`，模块解析失败拖垮页面。
- **修复**：改为 `../../lib/adminApi`、`../../lib/format`、`../../types/dashboard`。

---

## 2026-08-17 · nongyu-node-server · `postReplies` 集成测试块破坏既有 `settings.users` 块

- **现象**：在 `tests/api.test.ts` 用 `StrReplace` 内联插入大段 `postReplies` 测试时，替换文本意外截断了 `describe("settings.users", ...)` 的 `beforeAll/beforeEach/afterAll` 与首个 `it(` 包裹，导致该块语法结构损坏。
- **根因**：`StrReplace` 的 `old_string` 锚点选在 `describe("settings.users", () => {` 后第一行，新内容未补回被覆盖的 `beforeAll`/`it(` 等结构，且大段 JSON 字符串触发「Unterminated string in JSON」工具错误。
- **修复**：① 先用小锚点 `StrReplace` 把 `settings.users` 块的 `beforeAll`/`beforeEach`/`afterAll` 与首个 `it(` 恢复；② 将 `postReplies` 14 个测试场景拆到独立文件 `tests/postReplies.test.ts`，分多次 `Write`/`StrReplace` 写入，避免单次超长；③ 移除 `api.test.ts` 中遗留的未用 `getPool` import。`pnpm type-check`、`pnpm lint` 均通过。

---

## 2026-08-17 · nongyu-node-server · 广场回复上线前 CR：admin_reply 并发 1:1 与删留言未绑 post_id

- **现象**：Code Review 发现 `createAdminReply` 仅对 `post_replies` 做 `FOR UPDATE`，首次无行时并发可双插；`DELETE comments` 未校验 URL 中的 `post_id`；轮询置位无行锁可重复 toast；迁移文件名与 `002_course_ext` 撞号。
- **根因**：空结果集行锁不可靠；删留言 WHERE 缺 `post_id`；`consumeNewReplies` SELECT 未 `FOR UPDATE`；迁移序号未对齐已有系列。
- **修复**：事务内先 `posts ... FOR UPDATE` 再插回复/留言；删留言 WHERE 绑定 `post_id`；轮询 SELECT `FOR UPDATE`；迁移改名为 `009_post_replies.sql`。

---

## 2026-09-05 · nongyu-web-admin · 大屏「用户设置分布」全员默认值误导

- **现象**：数据大屏「用户设置分布」四个饼图各项人数均等于总用户数，看起来像全员设置相同。
- **根因**：RN App 偏好仅写本机 MMKV，Spec 明确后置不同步 `user_settings`；服务端仅在注册时插入默认行，大屏 GROUP BY 得到的是默认分布，非真实偏好。
- **修复**：不改 RN。管理端移除 `chart-settings` 卡与相关拉数/助手工具；旧 localStorage 布局中的该 id 由 prefs sanitize 丢弃。Node `settings-distribution` 接口暂保留。

---

## 2026-09-14 · nongyu-node-server · course-ext 写入接口批量 500

- **现象**：RN 端进入课表页后，后台同步的 `/api/app/course-ext/schedules`、`/notes`、`/attendances`、`/todos` 等 POST/DELETE 接口返回 500（`code=50000`，message=`服务器内部错误`），埋点库 8 月 17 日至 9 月 14 日累计 7000+ 条，容易被用户误以为是「刷新课表」报错。
- **根因**：
  1. **主要根因**：RN 端使用 `new Date().toISOString()` 生成 `createdAt` / `updatedAt` / `completedAt` / `deletedAt`，返回 `"2026-09-09T06:26:24.062Z"`（含 `T` 和 `Z`）。服务端 `repo.ts` 直接将该字符串写入 MySQL `DATETIME(3)` 列，MySQL 8 拒绝该格式，抛 `ER_TRUNCATED_WRONG_VALUE`（errno 1292），被全局错误处理器转成 500。
  2. **次要根因**：生产 MySQL 的 `custom_schedules.color_index` 列、`course_attendances.status='nocheck'` CHECK、`course_ext_tombstones.entity='attendance'` CHECK 未随 8 月中的代码发布同步执行；写入时也可能命中 `ER_BAD_FIELD_ERROR` / `ER_CHECK_CONSTRAINT_VIOLATED`。
- **修复**：
  1. `src/modules/course-ext/repo.ts` 新增 `toDbDatetime()`，写入前把 ISO 8601 日期统一转换为 `"YYYY-MM-DD HH:MM:SS.mmm"`；覆盖 schedules / notes / todos / attendances / tombstones 全部写入路径。
  2. 新增幂等补全迁移 `migrations/009_course_ext_schema_fix.sql`，通过 `information_schema` 判断后补齐缺失列/CHECK，可重复执行、对已有数据无影响。
  3. `src/middlewares/common.ts` 全局错误处理器补充 `requestId`、`method`、`path`、`userId` 等上下文，便于 production `journalctl` 直接定位原始 MySQL 错误。
- **验证**：本地 `pnpm type-check` / `pnpm lint` 通过；生产已上传 `dist/index.js`、重启 `nongyu-node` 服务，`journalctl` 重启后 1 分钟内无新 `unhandled error`。
- **生产操作**：
  - 已执行：备份 MySQL、执行 `009_course_ext_schema_fix.sql`、部署新 `dist`、重启服务。
  - 建议继续观察 10~30 分钟，确认埋点库中 `course-ext` 500 不再新增。

---

# 农屿系统仓库说明（For人类用户，Agent参考AGENTS.md）

## 项目概览（For仓库访客）

农屿系统仓库以基于pnpm的monorepo单仓架构统一存放和管理了整个农屿产品矩阵下的所有代码

**农屿简介：**
农屿是一款基于React Native跨端框架开发的支持安卓、IOS双端的智慧校园助手App，旨在解决四川农业大学校内教务相关信息、二课相关信息分散以及查询不便的关键痛点，同时农屿主要打造的核心功能是无广告、高颜值、快启动、功能丰富的课表，并开放了反馈墙和农家大院两大模块来提供用户反馈和交流渠道~

**一句话数据流：**

```
川农教务/二课系统 ←爬取─ tool-jiaowu / tool-second
RN App（课表/反馈墙/农家大院/农小屿Agent） ⇄ node-server ⇄ MySQL
RN App ─埋点上报→ node-track-server（SQLite） ←查询─ web-admin 数据大屏
```

## 技术栈总览（For仓库访客）

| 端/模块          | 路径                                                | 技术栈                                                                                                                         | 状态                                         |
| ---------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| 用户端App        | `apps/nongyu-rn-app`                                | Expo + React Native（expo-router、react-query、zustand、mmkv、reanimated）+ Pushy热更新；内嵌 `nongyu-agent-sdk` 做农小屿Agent | 主力产品                                     |
| Web管理后台      | `apps/nongyu-web-admin`                             | React + Vite + Ant Design + ECharts（数据大屏）；内嵌智慧后台助手                                                              | 线上 `nongyu.site/admin/`                    |
| 品牌官网         | `apps/nongyu-web-site`                              | Vite 静态站（计划后期精简为单HTML+brotli）                                                                                     | 线上 `nongyu.site/`                          |
| 业务后端         | `apps/nongyu-node-server`                           | Node + Express + MySQL（mysql2、jose JWT、zod、pino、bcryptjs）                                                                | 线上 systemd `nongyu-node.service`           |
| 埋点后端（现行） | `apps/nongyu-node-track-server`                     | Node + Fastify + SQLite（better-sqlite3），事件契约见 `packages/nongyu-track-contract`                                         | 线上 Track机 :8081                           |
| 埋点后端（旧）   | `apps/nongyu-go-track-server`                       | Go + 嵌入式SQLite                                                                                                              | **已下线**，仓库保留只读对照，CD不再发布     |
| Agent SDK        | `packages/nongyu-agent-sdk`                         | 纯TS跨node/web，RN与Web管理端共用                                                                                              | 在用                                         |
| 工具库           | `packages/nongyu-tool-jiaowu`、`nongyu-tool-second` | 川农教务/二课系统爬取与解析                                                                                                    | 在用                                         |
| 工程基建         | 根目录                                              | pnpm workspace + catalog 统一版本、TypeScript、tsup、oxlint/oxfmt、husky+commitlint 本机门禁                                   | —                                            |
| 持续交付         | `.github/workflows/cd.yml`                          | GitHub Actions 纯CD：push main 按路径构建四端产物并 SSH 部署+健康检查回滚                                                      | 已落地，详见 `docs/common/GitHub持续交付.md` |

**大体项目结构：**

```plaintext
│  AGENTS.md（Agent开发指导文档）
│  README.md（仓库说明文档）
│
├─apps
│  ├─nongyu-node-server（农屿业务后端-Express+MySQL）
│  ├─nongyu-node-track-server（农屿埋点后端-现行-Fastify+SQLite）
│  ├─nongyu-go-track-server（农屿埋点后端-旧Go实现-已下线仅存档）
│  ├─nongyu-rn-app（农屿用户端-react native应用）
│  ├─nongyu-web-admin（农屿管理后台-react网页应用，[点击跳转](http://nongyu.site/admin/)）
│  └─nongyu-web-site（农屿官网-Vite静态站，[点击跳转](http://nongyu.site/)）
├─old-code（旧版本项目源码-gitignore不随仓库分发，交接方单独保管）
└─packages
    ├─nongyu-agent-cli（农屿Agent命令行工具-node.js应用，用于开发sdk期间的测试）
    ├─nongyu-agent-sdk（农屿AgentSDK-纯TS库-跨node和web，Web管理端和RN用户端均基于其做Agent）
    ├─nongyu-tool-jiaowu（农屿工具集-川农教务系统）
    ├─nongyu-tool-second（农屿工具集-川农二课系统）
    └─nongyu-track-contract（埋点事件类型契约-RN Telemetry ↔ Track Server）
```

## 技术概览（For仓库访客）

#### 单仓管理方式

采用基于pnpm的monorepo（单仓架构管理）
monorepo的优势为：

1. 便于统一管理和维护全仓相同依赖的版本（基于catalog特性）
2. 便于不打包不发布即可同步引用最新版本的内部包（基于workspace）
3. 便于编程Agent将全仓代码一起索引（非monorepo独特优势，实际上建一个父目录将几个项目放进去再以父目录为工作区依然可以让Agent整个索引全仓代码）

pnpm的优势为：

1. 省磁盘（不同的项目同样的依赖只需存在一份实体文件在本地设备磁盘上，基于pnpm的全局内容寻址存储）
2. 安装快（pnpm安装依赖的速度优于npm）
3. 避免幽灵依赖（pnpm不会做依赖提升，避免了项目中代码引用未声明的依赖）
4. pnpm天然利于构建monorepo项目，无需额外扩展，单仓开发体验最好

#### AI Native开发

整个农屿系统从需求到开发测试部署上线的全流程均最大程度的基于AI开发提效，全仓代码开发大约10pd不到

尽可能的搭建AI编码的基础建设和配套设施、规则约束，保证AI在提高效率的同时代码质量可控，减少返工

农屿系统的开发前期基于Trae国际版桌面版+DeepSeek API，后期基于Cursor的Pro订阅模式（闲鱼85人民币购入），主力开发模型为Auto（Composer系列模型和Grok系列模型），少数复杂需求使用GLM5.2、Kimi K3等较高级模型

AI编码经验参考：docs\common\AICodingHarness实践.md

#### RN端智慧校园助手Agent（农小屿）

- App内近乎所有操作均可通过自然语言指挥Agent完成（将所有操作均封装成Agent可注册并调用的Tool，人类用户操作和Agent操作走相同的底层代码）
- A2UI，扩展AI回复内容的丰富性和可交互性，避免生成纯文本、markdown文本（基于A2UI协议和思路，暂时的具体实现方案是ControlledUI，即工具配套注册UI，工具调用时发现有对应的注册UI组件就渲染）

#### Web管理端智慧后台助手

- 智慧后台管理（将Node业务端接口封装为Tool供Agent查询业务后台数据，含用户管理、用户数据、帖子管理、帖子数据）
- 智慧问数助手（将问数助手单独做成一个子Agent供主Agent执行，好处是避免上下文污染和无需问数需求时过多的问数相关提示词和工具描述占据上下文浪费Token和造成错觉。AI生成Echarts图表当前的实现是：将业务概念和表结构写进系统提示词，同时写入问数需求的编排逻辑，要求Agent先理解用户问数需求，然后根据表信息和业务概念生成SQL，再通过SQL校验工具检查语法是否正确、是否是单语句、是否是只读语句、是否读了不允许读的表，最后交给SQL执行工具执行，Go后端处做了简单的sqlguard再校验一层，AI根据SQL执行结果判断是结束循环还是调整SQL，目前是最多允许重试3次，拦不住还有Agent最大循环次数兜底避免死循环）
  _注明：当前智慧后台管理和智慧问数均只做了读操作，暂不考虑做写操作_

#### 数据分析全链路搭建

目的：后台基于图表展示分析查看用户行为数据（用于优化产品）、性能数据（当前只关注课表页面首屏时间）、报错数据（了解用户报错情况，但当前未做SourceMap映射，只能了解报错情况，无法定位报错路径和原因）
方法：

- RN客户端，封装埋点SDK（埋点数据的采集存储并上报）
- Node埋点服务（Fastify+SQLite，`nongyu-node-track-server`；2026-09前为Go实现，已迁移，迁移档案见 `docs/nongyu-go-track-server/`）
- Web管理端（埋点数据的消费，通过Echarts图表渲染大屏查看和分析数据）

#### 版本管理和控制

App的版本管理区别于Web网页的版本管理，后者修改服务器代码后，浏览器清理缓存即可应用最新版本代码；但跨端App的版本管理则分为两大类，一是外部原生壳子，二是内部跑的JS代码：

- 对于原生壳子的更新，必须要重新安装应用（暂不了解壳子代码的无感替换详情），落到农屿的RN壳子，若引入了新的原生依赖则需要更新外部壳子
- 对于JS代码的更新，可基于封装好的工具实现静默更新，用户无感

农屿基于Pushy做版本管理和控制（**不走GitHub CD**，RN发版/EAS/Pushy为手动流程，详见 `docs/common/运维手册.md`）

## TodoList（For 农屿Owner、Developer）

> 2026-10 接手盘点时逐项核实；已完成项直接移除，未完成项保留。存疑项标注（需与前负责人确认）。

- [ ] 农屿客户端Agent：模块化拆分子Agent省Token（必做）；A2UI与文本交错展示（尽量）；长上下文摘要压缩策略的用户验证（选做）；RAG川农公众号知识库（选做，服务器已就绪）；全部操作接入Agent工具注册（必做）；版本更新链路测试（必做）
- [ ] 农屿Web管理端：整套UI/移动端适配再优化一版；智慧后台助手交互UI优化；全站文案检查；构建优化——首屏太慢，需分包（必做）
- [ ] nongyu-agent-sdk：考虑基于piagent+vercel ai-sdk方向改造内部逻辑（选做）
- [ ] 农屿官网：UI再优化、正式文案、正式版APK上服务器、TestFlight分发验证；后续精简为单HTML+brotli
- [x] CI/CD基建：已落地（GitHub Actions 纯CD，见 `docs/common/GitHub持续交付.md`；埋点后端已从Go迁Node并同步CD）
- [ ] 交接收尾：收回三台服务器/Actions Secrets/Pushy·EAS·开发者账号/old-code归档（详见 `docs/common/运维手册.md` 待填清单）

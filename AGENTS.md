# Agent开发指导文档-农屿系统

### 文档说明

AGENTS.md文档是Coding Agent必须载入上下文的**宪法级别**的项目文档，用于指导Agent开发，本AGENTS.md文档以“地图”方式呈现，只给出具体规则和约束的文件位置，不详细写出规则和约束的完整内容，Agent自行**按需加载**所需的规则，不得遗漏，也不得盲目全量加载。本文档定义了Coding Agent对本项目的全方位约束，是为Coding Agent建设的“Harness”。

### 核心约束

- ./README.md（是给人类阅读的文档，Agent非必要情况不加载此文档）
- 本项目整体严格基于SDD（Spec驱动开发）范式进行开发，具体规则参考下方的“开发规范”
- Coding Agent不能进行任何git相关操作，除非用户显式要求
- Agent做任何事之前都必须要求用户澄清需求，不要盲目按照自己的理解着急开工，避免理解失误造成返工
- 做任何需求前优先检索仓库下是否已存在已有实现或类似实现，尽量复用已有代码和已有方案，除非无法覆盖现有问题才考虑新方案和新代码，且需要告知用户情况以及和用户后续讨论最终确定
- **【铁律】每次 Bug 修复完成后，必须在 `./docs/common/BugLog.md` 追加简明记录（现象、根因、修复方法），禁止只改代码不写 BugLog；提交前自检该条目已写入**

### Coding Agent必须遵循的规则集合

参考/.agents/rules/

### Coding Agent必须遵循的开发规范（含开发工作流规范，Agent必须严格遵守）

参考/.agents/rules/开发规范.md

### Coding Agent必须遵循的编码规范

参考/.agents/rules/代码规范.md

### 项目背景（日常需求开发和Bug修复不得加载项目背景，避免浪费Token和造成上下文污染，仅当用户要求的场景需要查看当前项目背景信息时才可加载）

参考./README.md

### 项目架构以及架构约定

参考./docs/common/项目结构总览.md（monorepo 顶层结构与各目录职责）
**注意：需保证此文档的实时性**

### 项目技术栈

参考./docs/common/全局技术选型总览.md

### 依赖管理策略

参考./docs/common/基于pnpm的monorepo项目依赖管理策略指导.md

### 项目文档库管理策略

- 项目文档目录位于./docs/
- 项目文档管理策略位于./docs/common/项目文档库管理策略.md（需严格遵守）
- Bug 修复追溯日志位于./docs/common/BugLog.md（见上方铁律，每次修复必记）

### 需求开发管理策略

- 将项目中的所有需求统一划分为基建需求和业务需求两大模块，基建需求诸如React Native埋点、用户登录鉴权体系搭建等等；业务需求诸如给管理端做一个数据查询页面，调整某个页面的UI等等
- 业务需求可在项目开发过程中临时产生和调整，基建需求需在业务需求开始前尽量完善，尽量不在后续业务需求开发时进行改动和调整
- 在进行任何业务需求开发之前需要确保基建需求均已完成
- Agent接到任何需求时需要询问用户将此划分为哪一类需求

### UI设计准则

Agent产生的任何结构和样式类的代码都必须严格遵循以下设计准则：

- 参考./design-system/web-admin/MASTER.md（农屿Web后台管理端设计准则）
- 参考./design-system/rn-app/MASTER.md（农屿RN App 设计准则）
- 参考./design-system/web-site/MASTER.md（农屿Web品牌官网设计准则）
  **注意：以上准则用于决定不同项目的UI基调，当涉及到新UI开发、新页面开发以及任何UI调整时请调用frontend-design这个Skill并结合用户的UI调整需求进行UI设计**
  **注意：若以上的设计准则文档不存在或文档内容为空，则需要调用frontend-design这个Skill并结合用户的UI要求进行设计准则文档的编写和UI定调**

### Coding Agent可使用的Skills集合

- 项目的Skills（参考/.agents/skills/）
- Agent自己的Skills（Agent产品自身的Skill，全局Skill）

### 项目所使用Skills的注意事项

- 项目所用的Skill由对应的subagent管理，各个subagent的系统提示词已经注明其被调用时需要加载的Skill

### Coding Agent可使用的MCP集合（Agent禁止擅自使用如下MCP以外的其他MCP）

- Mysql Mcp（暂未配置）
- CodeGraph Mcp（本地代码知识图；安装与索引见下方「代码检索」）

### 代码检索（CodeGraph + Cursor 内置）

参考/.agents/rules/代码检索策略.md（结构/调用链优先 CodeGraph；精确字符串用 Grep；禁止无目标广撒读文件）

## Agent skills

### Issue tracker

Issues live in GitHub Issues for this repo (`NongyuSystem/nongyu-system`), driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` (plus `wayfinder:*` labels for `/wayfinder`). See `docs/agents/triage-labels.md`.

### Domain docs

single-context（仓库共用一份根目录词条文件 + `docs/adr/`）。See `docs/agents/domain.md`.

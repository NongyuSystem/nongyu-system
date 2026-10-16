# AI Coding技巧心得总结

## 入口文件AGENTS.md文件（Agent的宪法文件）

- 保证AGENTS.md文件不超过100行
- 以**地图式**形式组织所有约束，而不是把AGENTS.md写的很长（参考openAI用Codex的最佳实践）
- 针对具体的Agent可以写对应的AGENTS.md文件，统一软链或路径引导到AGENTS.md上

## 基于SDD和TDD工作流（拒绝Vibe Coding）

- 通过 grill-me skill，要求AI在编码前必须和人类多轮讨论进行需求阐明和技术选型，大型工程可以用superpower，但grill-me更轻量且能给出每个问题的建议
- SDD工作流，核心思想是文档是一切真相来源，编码前必须先写文档，代码只是文档的附属产物。完整工作流是：PRD-Spec-Tech-Plan-Coding-Review-Commit-Check-push-CD
- 对于接口编写，基于TDD工作流，测试驱动开发，要求AI先写测试用例再写接口，接口写完后自己跑测试用例

## 建立项目的知识库目录（操作留痕以及沉淀工程经验）

需要包含：

- 操作留痕和bug修复日志（AI的每一次动作都需要摘要后记入文档留痕，每一次bug的原因和修复手段也需要留痕，便于日后追溯以及复用历史经验）
- PRD、Spec文档、技术方案文档都需要留痕，沉淀知识库
  知识库的重要意义在于AI的每一步操作和决策都被记录下来，这些都是将来可复用的工程经验，项目可以长时间维护，接入新的Agent后也可以快速上手

## 建立子Agent，专事专做（上下文隔离、专属提示词和skill）

以Cursor为例，我建了多个子Agent，包括：

- 前端专家
- UI设计专家
- 后端专家
- 数据库专家
- CR专家

  通过AGENTS.md编排，不同的需求交给不同的子Agent去做，避免上下文污染，每个子Agent配置自己的skill和系统提示词

## 把确定性工程从AI手上解耦（核心是思考哪些东西是确定性的而不是用自然语言要求的）

- 通过配置pre-commit钩子，在commit前进行代码风格、格式化、TS类型的检查，确定性的工程无需AI介入，直接用对应的工具执行即可
- 诸如Cursor和Claude Code这类编码Agent都可以配置hook来介入Agent循环的各个步骤，可以通过配置hook来强制要求Agent编辑文件后跑code review而不是在rule或者AGENTS.md里面用自然语言要求Agent执行CR（写代码和审代码不能在同一个上下文中，不能让Agent审自己写的代码，要不同的Agent之间做对抗性检查）

## 编码策略（优先考虑复用或参考已有代码实现）

通过AGENTS.md或rules要求Agent编码的时候优先参考或者复用已有的代码，尽量不要创造新的实现

## 代码检索策略（优先基于代码图结构检索）

大多数Agent都会把工作区的文件在云端做向量化处理，检索的时候就是基于向量相似度检索，可以使用如CodeGraph这类工具在本地建立代码图结构，这个工具会通过解析代码生成ast建立起代码之间的依赖关系，比如某个函数调用了哪些函数，它又被谁调用。它是通过启动本地MCP Server进行服务的，Agent通过CodeGraph可以快速定位到代码，加快检索速度和Token消耗。
（像Claude Code没有做向量化索引，直接用grep+glob硬搜）

## 善用Agent周围的组件，如MCP和Skill

- skill比如React开发就配套React最佳实践的skill，Node就用Node最佳实践的skill，以此类推
- 善用MCP来赋予Agent更多上下文，比如用MySQL MCP来让Agent访问数据库、用Figma MCP来让Agent获取设计稿信息

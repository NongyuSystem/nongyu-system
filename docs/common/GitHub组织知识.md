# GitHub 组织（Organization）必要知识

> 文档性质：**学习向知识沉淀**（概念 → 权限模型 → 功能清单 → 操作速查）  
> 不走需求流程；与农屿现网相关的落地见 [`GitHub持续交付.md`](./GitHub持续交付.md)  
> 农屿组织名以配置为准，下文统一用占位符 `ORG`

---

## 1. 组织是什么？

GitHub 账号分两类：

| 类型        | 归属          | URL               | 关键差异                                       |
| ----------- | ------------- | ----------------- | ---------------------------------------------- |
| 个人账号    | 自然人        | `github.com/USER` | 只能对自己的仓库有所有权；无团队/安全治理能力  |
| 组织（Org） | 一个团队/公司 | `github.com/ORG`  | 仓库归属组织而非个人；成员可流动，权限集中管理 |

**组织的特点：**

1. **归属权与人员解耦**：仓库属于 `ORG`，不随某个员工的加入/离职而转移，个人账号离职后无法带走组织资产（除非被显式转出）。
2. **权限集中治理**：所有成员的仓库权限统一在组织设置里管控，而不是每个人各自授权。
3. **团队化协作**：用 Team 这一层把「一群人对一批仓库的一组权限」打包复用，避免逐仓库逐人授权。
4. **安全与合规能力**：SAML SSO、强制 2FA、IP 允许列表、审计日志、代码/密钥扫描等组织级开关。
5. **个人账号可以加入多个组织**：一个开发者完全可以同时是多个组织的成员，互不干扰。

---

## 2. 权限模型（组织最核心的知识）

### 2.1 角色层级

```
Owner（组织所有者）
   └── Member（组织成员，可被授予 Billing Manager）
         └── Team（团队）→ 多个 Member
               └── Repository（仓库）→ 仓库角色
Outside Collaborator（外部协作者，不属于组织，只被授予特定仓库权限）
```

### 2.2 三类身份

| 身份                     | 说明                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| **Owner**                | 组织最高权限：计费、删除组织、删除/转移仓库、改基础权限。多 Owner 是防单点风险的常规做法 |
| **Member**               | 组织成员。能否创建仓库/团队由 `Members can create repositories` 等开关控制               |
| **Outside Collaborator** | 外部协作者（如外包、外部审阅者）。**不属于组织**，仅在单个仓库上有权限                   |

> 常见误区：给外部人员权限时用「邀请为 member」而不是「加为 outside collaborator」。外部协作者看不到组织内的其他私有仓库，隔离性更好。

### 2.3 仓库角色（Repository Roles）

| 角色       | 能力概要                                                           |
| ---------- | ------------------------------------------------------------------ |
| `read`     | 读代码、克隆、开 issue（Triage 的前置）                            |
| `triage`   | read + 管理 issue/PR（打标签、关闭、指派）                         |
| `write`    | triage + 推分支、合并 PR、管理部分设置                             |
| `maintain` | write（除高危设置）+ 管理仓库设置、部分敏感操作，但不能删仓库/转移 |
| `admin`    | 全部，包括删仓库、转移、改可见性、加协作者                         |
| `custom`   | 自定义角色，仅 Enterprise Cloud，按规则裁权                        |

**两种授权途径：**

1. **团队授权**：把仓库权限授给 Team，Team 内所有人自动获得（团队成员变化时权限自动跟随）。**这是组织区别于个人账号的核心能力。**
2. **直接协作者**：把仓库角色直接授给某个成员/协作者。适合零散授权，但人多后极难维护。

> 权限取**最大并集**：一个人通过团队拿到 `write`、又通过直接授权拿到 `read`，最终是 `write`。

### 2.4 组织基础权限（Base Permissions）

`Organization settings → Member privileges → Base permissions`：新成员/新团队默认对所有仓库的权限基线，可选 `None / Read / Write / Triage / Maintain / Admin`。

**治理建议**：默认设 `None`（或 `Read`），再按团队显式授权；默认给 `Write` 是安全事故的常见起点。

---

## 3. 仓库可见性与默认策略

| 可见性     | 谁能看             | 适用                                  |
| ---------- | ------------------ | ------------------------------------- |
| `Public`   | 全网               | 开源项目、组织门面                    |
| `Private`  | 仅被授权者         | 闭源业务                              |
| `Internal` | **组织内所有成员** | 内部工具/基建；仅 Enterprise 计划支持 |

组织级可控开关（`Member privileges`）：

- 成员能否创建仓库、创建何种可见性
- 成员能否 fork 私有仓库、fork 到哪（同组织/外部）
- 成员能否删除/转移自己创建的仓库
- 默认分支名（个人/组织级新仓库默认分支名，如 `main`）
- 是否能改仓库可见性

---

## 4. 组织级功能清单

### 4.1 协作与组织资产

| 功能              | 说明                                                                               |
| ----------------- | ---------------------------------------------------------------------------------- |
| **Teams**         | 可见/隐藏团队、嵌套子团队（权限向上继承）、IdP 团队同步（Okta/Entra）              |
| **@mention 团队** | 在 PR/issue 里 `@org/team-name` 一次通知全组                                       |
| **Code Owners**   | `.github/CODEOWNERS` 按路径强制指定 Review 人/团队，可配「必须 DCO/必须 owner 审」 |
| **组织主页**      | 一个叫 `.github` 的特殊仓库，其 `profile/README.md` 即组织对外介绍页               |
| **Discussions**   | 仓库级社区讨论区；组织级统一开关                                                   |
| **Projects**      | 组织级项目看板（新版 Projects 可跨仓库聚合 issue/PR）                              |
| **Sponsors**      | 组织级赞助页                                                                       |
| **Packages**      | npm/Docker/Maven/Gradle 等包托管在组织名下，权限跟随仓库或单独设置                 |
| **Insights**      | 贡献者、流量、依赖图等仓库维度统计                                                 |

### 4.2 安全与合规（Security & Compliance）

| 能力                           | 作用                                                        |
| ------------------------------ | ----------------------------------------------------------- |
| **2FA 强制**                   | 组织内所有成员必须开启两步验证（2023 年后已扩展为通用 2FA） |
| **SAML SSO**                   | 与企业 IdP 对接，SSO 未认证的会话对私有仓库降权             |
| **SCIM 用户预置**              | IdP 侧直接增删组织成员，离职即时回收                        |
| **IP 允许列表**                | 仅允许办公网/跳板机 IP 访问组织私有仓库                     |
| **Dependabot alerts**          | 依赖库 CVE 告警 + 自动 PR 修版本                            |
| **Secret scanning**            | 扫描已提交的密钥（含 push protection 提交前拦截）           |
| **Code scanning（CodeQL 等）** | 静态分析注入/XSS 等代码缺陷，结果在 `Security` 标签页       |
| **安全公告 / 私密漏洞报告**    | 维护 GHSA 公告，允许外部私密提报漏洞                        |
| **审计日志（Audit log）**      | 成员、权限、仓库事件流水；Enterprise 支持流式导出           |
| **Verified domain**            | 验证域名，强化组织身份与邮件域                              |

### 4.3 自动化与研发流水线

| 能力                         | 说明                                                          |
| ---------------------------- | ------------------------------------------------------------- |
| **Actions 组织级配置**       | 允许/禁用 Action 来源、是否允许 fork 仓库的 PR 跑 workflow    |
| **组织级 Secrets/Variables** | `ORG` 级密钥，跨仓库复用，权限可限定到具体仓库                |
| **Self-hosted runners**      | 组织级自托管 runner 组，按团队/仓库分配                       |
| **Required workflows**       | Enterprise：全组织强制执行的 CI 工作流                        |
| **Webhooks**                 | 组织级 webhook（事件覆盖组织内所有仓库）                      |
| **Rulesets**                 | 新一代仓库规则（可做组织级 push 规则集，强制签名/路径限制等） |
| **Branch protection**        | 分支保护 + required checks + required reviews                 |

### 4.4 仓库元信息

- **Topics 标签**：搜索与归类
- **Issue 模板 / PR 模板**：放 `.github/ISSUE_TEMPLATE`、`.github/pull_request_template.md`
- **Labels**：组织级默认标签集（对应农屿的 `docs/agents/triage-labels.md`）
- **Social preview**：仓库对外预览图

---

## 5. 常用操作速查

### 6.1 成员与团队

```bash
# 列组织
gh api user/orgs --jq '.[].login'

# 邀请成员 / 移除成员
gh api -X POST orgs/ORG/invitations -f email=USER@MAIL.COM
gh api -X DELETE orgs/ORG/members/USER

# 团队
gh api orgs/ORG/teams --jq '.[].slug'
gh team ls ORG

# 给团队授仓库角色
gh api -X PUT orgs/ORG/teams/TEAM/repos/ORG/REPO -f permission=maintain

# 列某仓库协作者及其权限来源
gh api repos/ORG/REPO/collaborators --jq '.[].login'
```

### 6.2 仓库

```bash
# 在组织下建仓库（带 topic、默认分支、模板）
gh repo create ORG/REPO --public --description "..." --add-readme

# 改可见性（私有/公开/内部）
gh api -X PATCH repos/ORG/REPO -f visibility=private

# 查看仓库角色总览（含通过团队继承的）
gh api repos/ORG/REPO --jq '{name,visibility,permissions}'
```

### 6.3 组织级密钥与 Runner

```bash
# 组织级 secret（限定仓库可见范围）
gh secret set MY_SECRET --org ORG --visibility selected --repos REPO1,REPO2

# 组织级 runner
gh api orgs/ORG/actions/runners --jq '.runners[].name'
```

### 6.4 安全相关

```bash
# 依赖告警概览
gh api repos/ORG/REPO/dependabot/alerts --jq '.[].security_advisory.severity' | sort | uniq -c

# 代码扫描（CodeQL）告警
gh api repos/ORG/REPO/code-scanning/alerts --jq '.[].rule.severity'

# 私有漏洞报告
gh api repos/ORG/REPO/private-vulnerability-reports --jq '.[].state'
```

---

## 6. 治理实践清单（照着做不会错）

1. **Owner ≥ 2 人**，避免单点；Owner 只负责治理，不常在业务仓库上 push。
2. **基础权限设 `None`**，权限一律走团队；团队命名按职责（`web-site`、`node-server`、`rn-app`），不按人。
3. **外部人一律 outside collaborator**，至少按年复核一次权限。
4. **开 2FA +（企业场景）SSO/SCIM + IP 允许列表**。
5. **公开 Secret scanning + push protection**；私有关键仓库配 Dependabot + CodeQL。
6. **main 开分支保护**：required PR review ≥ 1（核心仓 2）、required status checks、禁止 force push。
7. **默认分支名 `main`**，喂死 legacy `master` 造成的脚本/工具兼容问题。
8. **不要在仓库里轮换密钥**：GitHub 只存引用不保证不可泄露，密钥一旦进过 Git 历史即视为泄露，必须作废重发。
9. **审计日志定期导出**，与离职流程绑定：离职当天 SCIM 移除 → 会话全部失效。
10. **组织资产文档化**（仓库清单、团队-仓库-权限矩阵），农屿侧对应 `docs/agents/issue-tracker.md` 与运维手册。

---

## 7. 与个人账号的差异速查

| 维度     | 个人账号             | 组织                               |
| -------- | -------------------- | ---------------------------------- |
| 所有权   | 个人                 | 组织（人员流动不影响）             |
| 权限管理 | 只能逐个仓库加协作者 | 团队 + 协作者两层模型              |
| 团队     | 无                   | 有（可嵌套、可同步 IdP）           |
| SSO/审计 | 无组织级             | SAML、SCIM、审计日志（Enterprise） |
| Packages | 个人命名空间         | 组织命名空间，可复用到多个仓库     |
| 组织主页 | Profile README       | `.github/profile/README.md`        |

---

| 日期       | 变更                                         |
| ---------- | -------------------------------------------- |
| 2026-08-21 | 初稿：组织特点、权限模型、功能清单、治理实践 |

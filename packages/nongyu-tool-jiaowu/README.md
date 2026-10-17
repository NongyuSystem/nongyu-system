# nongyu-tool-jiaowu

农屿教务系统工具库，用于获取四川农业大学教务系统页面，并将 HTML 清洗为结构化数据，供农屿 App、Agent 工具及其他调用方使用。

功能与限制以当前源码为依据；本文不代表已完成真实账号联调或所有运行环境验证。

## 功能

- 教务登录、内存会话管理及登录失效后的自动重登。
- 查询学生个人信息、课程成绩、考试安排、个人课表、学业进度和专业排名。
- 获取培养方案及课程明细。
- 根据教师姓名或教室名称查询课表。
- 获取教学通知、竞赛通知及二者合并列表。
- 处理教务页面 GBK 编码、请求重试和超时提示。

本包通过请求教务网页并解析 HTML 获取数据，结果依赖教务系统当前的页面结构和访问条件。

## 项目接入

本包属于农屿系统 pnpm monorepo，依赖版本通过根目录 `pnpm-workspace.yaml` 中的 catalog 统一管理。

在仓库根目录执行：

```bash
pnpm install
pnpm --filter nongyu-tool-jiaowu build
```

仓库内其他包可声明工作区依赖：

```json
{
  "dependencies": {
    "nongyu-tool-jiaowu": "workspace:*"
  }
}
```

随后从包入口导入：

```ts
import { jiaowuLogin, getScoreInfo } from "nongyu-tool-jiaowu";
```

当前仅提供 ESM 入口，同时生成 TypeScript 类型声明。包入口指向 `dist/`，修改源码后需要重新构建，或启动监听构建：

```bash
pnpm --filter nongyu-tool-jiaowu dev
```

构建配置采用 `platform: "neutral"`。具体环境仍需验证网络访问、Cookie、请求头和编码依赖的兼容性；浏览器直接访问还受到跨域及请求头限制。

## 快速开始

### 登录并查询个人数据

```ts
import { jiaowuLogin, getPersonalInfo, getScoreInfo, clearLoginData } from "nongyu-tool-jiaowu";

async function loadStudentData(studentId: string, password: string) {
  const login = await jiaowuLogin(studentId, password);

  if (!login.success) {
    throw new Error(login.message ?? "教务登录失败");
  }

  // 登录成功后，包内会保存凭据和 Cookie，供后续查询与自动重登使用。
  const personalInfo = await getPersonalInfo();
  const scores = await getScoreInfo();

  return { personalInfo, scores };
}

// 用户退出账号时调用。
function logout() {
  clearLoginData();
}
```

也可以先设置凭据，再调用无参数登录：

```ts
import { setLoginData, jiaowuLogin } from "nongyu-tool-jiaowu";

async function loginWithSavedCredentials(studentId: string, password: string) {
  setLoginData(studentId, password);
  return jiaowuLogin();
}
```

`setLoginData()` 只更新内存凭据，不会执行登录或清理已有 Cookie。切换账号时，应先结束旧账号请求、清理旧会话，再完成新账号登录。

### 获取通知

代码不要求通知查询前显式登录，实际访问仍以教务系统响应为准：

```ts
import { getTeachingNoticeInfo, getCompetitionInfo, getNoticeInfo } from "nongyu-tool-jiaowu";

const teaching = await getTeachingNoticeInfo();
const competition = await getCompetitionInfo();
const combined = await getNoticeInfo();
```

`getNoticeInfo()` 按“教学通知在前、竞赛通知在后”直接拼接结果，不进行跨列表去重或日期排序。同一通知可能在合并列表中出现两次。

### 查询教师或教室课表

```ts
import { getTeacherCourseInfoByName, getClassroomCourseInfoByName } from "nongyu-tool-jiaowu";

const teacherCourses = await getTeacherCourseInfoByName("教师姓名");
const classroomCourses = await getClassroomCourseInfoByName("10-A104");
```

两个方法均先搜索，再按名称精确匹配并获取课表。教师同名时，当前实现取搜索结果中第一个姓名匹配项。

## 公开 API

以下接口均从包根入口导出。

### 登录与会话

| API                        | 说明                                                         |
| -------------------------- | ------------------------------------------------------------ |
| `jiaowuLogin(user?, pwd?)` | 使用传入凭据登录；各参数为假值时分别回退到已保存的学号或密码 |
| `setLoginData(user, pwd)`  | 设置内存中的学号和密码                                       |
| `clearLoginData()`         | 清空内存凭据及 Cookie                                        |
| `getCookie()`              | 读取当前内存 Cookie                                          |
| `setCookie(cookie)`        | 设置当前内存 Cookie                                          |

登录成功返回：

```ts
type LoginSuccess = {
  success: true;
  cookie: string;
};
```

登录失败返回：

```ts
type LoginFailure = {
  success: false;
  message: string;
};
```

### 业务查询

除两个名称查询函数外，以下查询函数均不接收参数。

| API                                  | 功能                   | `result` 主要结构                              |
| ------------------------------------ | ---------------------- | ---------------------------------------------- |
| `getPersonalInfo()`                  | 学生个人信息           | 个人信息对象或 `null`                          |
| `getScoreInfo()`                     | 课程成绩               | 成绩数组                                       |
| `getExamInfo()`                      | 考试安排               | 考试数组                                       |
| `getCourseInfo()`                    | 个人课表               | 课程数组                                       |
| `getProgressInfo()`                  | 学业修读进度           | 各类学分进度数组                               |
| `getRankInfo()`                      | 加权成绩及专业排名     | 排名对象或 `null`                              |
| `getPlanInfo()`                      | 培养方案               | `{ title, courses }` 或 `null`                 |
| `getTeacherCourseInfoByName(name)`   | 指定教师课表           | `{ teacherName, semester, slots }` 或 `null`   |
| `getClassroomCourseInfoByName(name)` | 指定教室课表           | `{ classroomName, semester, slots }` 或 `null` |
| `getTeachingNoticeInfo()`            | 教学通知               | 通知数组                                       |
| `getCompetitionInfo()`               | 竞赛通知               | 通知数组                                       |
| `getNoticeInfo()`                    | 教学与竞赛通知合并列表 | 通知数组                                       |

个人数据请求会携带当前内存 Cookie；教师、教室查询同样通过请求层直接访问对应页面。各类查询的实际访问条件以教务系统响应为准。

### 请求辅助

| API                                           | 说明                                            |
| --------------------------------------------- | ----------------------------------------------- |
| `setJiaowuUserAgent(userAgent)`               | 覆盖普通教务请求的 User-Agent；空字符串取消覆盖 |
| `resolveJiaowuUserAgent()`                    | 按“手动覆盖 → 运行环境 → 回退值”解析 User-Agent |
| `attachJiaowuHttpLogger(callback)`            | 注册请求结算回调，再次调用会覆盖已有回调        |
| `isJiaowuTimeoutError(error)`                 | 判断是否为超时类错误                            |
| `resolveJiaowuErrorMessage(error, fallback?)` | 提取错误文案；超时映射为校园网提示              |
| `JIAOWU_CAMPUS_NETWORK_HINT`                  | 内置校园网提示文案                              |

登录链路使用独立的浏览器请求头，其中的 User-Agent 不受上述覆盖接口影响。

日志事件类型 `JiaowuHttpLogEvent` 也从包入口导出。事件包含请求体和响应体原文，调用方应自行脱敏，避免直接记录登录表单或个人数据。

## 返回数据约定

业务查询通常返回：

```ts
type QueryResult<T> = {
  success: boolean;
  result: T;
  message?: string;
};
```

上面的类型仅用于说明返回结构，不是包内统一导出的类型。捕获网络异常等错误时，通常会附带 `message`；解析失败或名称未匹配时，可能只有 `success` 和 `result`，不能依赖所有失败结果都存在错误文案。部分接口的类型声明也未暴露运行时附带的 `message`。

需要注意：

- 列表类接口失败通常返回 `[]`，对象类接口失败通常返回 `null`；培养方案等接口在解析失败时也可能返回空内容对象。
- `success: true` 不统一表示列表非空，部分解析器允许成功返回空数组。
- 成绩、学分、学时、排名等字段多数保留为字符串，调用方应按业务需要转换。
- 部分字段可缺省，应检查后再使用。
- 通知日期沿用页面文本，可能只有月日，不保证包含年份。
- 个人课表返回课程记录；教师、教室课表返回按星期与节次组织的 `slots`，三者结构不同。
- 教师、教室课表的 `slots` 只包含解析出课程的时段，不是完整的空白周课表。

## 登录与会话机制

登录过程包括：

1. 检查是否具备学号、密码；具备凭据后清空当前内存 Cookie。
2. 请求教务登录页，解析动态字段 `sign`、`hour_key`，并收集 ASP 会话 Cookie。
3. 提交学号、密码及动态字段。
4. 解码响应，结合重定向状态和页面失败文案判断结果。
5. 判定成功后保存凭据及 Cookie。

登录成功标志是包内对响应的判断，当前不会额外请求个人信息接口验证会话。若未提取到 Cookie，当前实现仍可能返回 `success: true` 和空字符串 `cookie`。

请求层检测到“登录超时”或“账号验证失败”时，会尝试使用已保存凭据重新登录，成功后重放原请求一次。登录校验接口自身不触发这条自动重登逻辑。

凭据与 Cookie 均保存在模块级内存变量中：

- 不会自动持久化，进程重启后需要由调用方恢复。
- 同一模块实例共享一套账号状态，不提供多账号会话隔离。
- 不适合直接作为服务端多用户并发请求的独立会话容器。
- 仅恢复 Cookie 不会恢复密码；Cookie 失效后，自动重登仍需要有效凭据。
- `clearLoginData()` 只清理包内状态，不负责取消进行中的请求、清理外部存储或执行教务服务器登出。

## 请求与错误处理

请求层使用 Axios，默认行为如下：

- 单次请求超时为 20 秒。
- 进入 Axios 错误拦截器的请求最多额外重试 3 次，每次间隔 1 秒，因此整体等待可能超过 20 秒；这条重试逻辑并不只针对网络断连，也可能重试失败的 HTTP 状态响应。
- 响应按 GBK 解码。
- 自动注入内存 Cookie，并补充普通请求的 User-Agent 和 Referer。
- 超时错误映射为内置校园网提示。

校园网提示属于错误展示策略，不能仅凭这条文案判断故障一定由网络位置引起。

## 目录结构

```text
nongyu-tool-jiaowu/
├── index.ts                  # 包根公开入口
├── package.json              # 包信息、依赖及脚本
├── tsconfig.json             # TypeScript 检查范围
├── tsup.config.ts            # ESM 构建与类型声明配置
├── TECH.md                   # 技术设计和登录实现说明
├── test.ts                   # 访问真实教务系统的调试脚本
└── core/
    ├── login/                # 登录及凭据管理
    ├── jiaowu/               # 业务页面请求与结果组合
    ├── extractor/            # HTML → 结构化数据
    │   ├── __fixtures__/     # 本地通知 HTML 样本
    │   └── verify-notice-extract.ts
    └── utils/                # 请求、Cookie、编码、HTML 及错误处理
```

调用链为：

```text
包根公开函数 → 业务查询 → 页面请求 → HTML 解析 → 结构化结果
```

对外可用范围以根目录 `index.ts` 和 `package.json` 的 `exports` 为准。内部文件存在实现，不代表支持从包入口调用。

## 开发与验证

在仓库根目录执行：

| 命令                                          | 用途                     |
| --------------------------------------------- | ------------------------ |
| `pnpm --filter nongyu-tool-jiaowu build`      | 构建 ESM 产物与类型声明  |
| `pnpm --filter nongyu-tool-jiaowu dev`        | 监听源码并重新构建       |
| `pnpm --filter nongyu-tool-jiaowu lint`       | 执行包内 Oxlint 检查     |
| `pnpm --filter nongyu-tool-jiaowu type-check` | 执行 TypeScript 检查     |
| `pnpm --filter nongyu-tool-jiaowu test`       | 运行真实教务系统调试脚本 |

当前 `test.ts` 包含硬编码账号凭据，会发起真实登录和查询。运行前应由维护者确认凭据来源与使用范围；它不是隔离的单元测试，也未默认执行全部查询。脚本会捕获部分失败，因此进程正常退出不等于全部功能验证通过。

通知解析另有本地样本校验脚本：

```text
core/extractor/verify-notice-extract.ts
```

在已具备 `tsx` 的开发环境中，可从包目录执行：

```bash
tsx core/extractor/verify-notice-extract.ts
```

该脚本检查教学、竞赛通知的分区及条目提取，不访问真实教务系统。本包当前未单独声明 `tsx` 依赖，也未为此校验配置 package script。

`tsconfig.json` 以根入口及其传递依赖为检查范围，不覆盖所有未导出的内部模块和调试脚本。

## 当前限制

- **培养方案参数固定**：当前使用源码中的固定查询参数，并行读取第 1、2 页，再按课程编号去重；尚未实现按账号动态发现培养方案或遍历全部分页。
- **查询条件有限**：公开业务查询接口暂不提供学期、校区、分页等可选参数。
- **通知范围有限**：获取首页教学、竞赛通知列表，不包含完整历史通知或详情正文；每类最多解析 50 条。
- **部分实现未公开**：教师个人信息、教室列表及按编号查询教室课表未从包根导出；开课目录尚未完善，也未公开。
- **依赖页面结构**：教务系统调整表格、字段或登录流程后，可能需要同步更新解析与请求逻辑。

技术实现细节可继续阅读 [TECH.md](TECH.md)。

## 许可证

`package.json` 声明为 ISC。

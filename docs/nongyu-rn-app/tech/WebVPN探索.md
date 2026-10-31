# 川农 WebVPN 探索

> 状态：探索笔记（非规格 / 非实现）；2026-10-31 已用真账号浏览器补验 Cookie / SSO  
> 日期：2026-10-30，补验 2026-10-31  
> 问题：RN App / `nongyu-tool-jiaowu` 如何在校外经 `https://webvpn.sicau.edu.cn` 访问 `jiaowu.sicau.edu.cn`  
> 方法：curl 主源实测 + 对照现有 CAS 教务登录；开源仅作编码算法旁证；真账号只在共享浏览器由用户自己登录，笔记不记录口令与 Cookie 值  
> 约束：本笔记不改应用源码、不提交 git

---

## 结论摘要

1. **产品**：四川农业大学 WebVPN = **网瑞达 wengine** 无客户端 HTTPS 反向代理（登录页 keywords / `wengine-vpn` 路径 / 须知文案，实测 2026-10-30）。
2. **URL 编码**：`/{scheme}/{hex(iv)+AES-CFB(host)}/{path}?query`；`key=iv=b"wrdvpnisthebest!"`，AES-128-CFB `segment_size=128`；密文前固定拼 `hex(key)`。与页面注入的 `__vpn_host_crypt_*` 及 HollowMan6/neugo 算法一致（实测 + 旁证）。
3. **两套 CAS app 不可混用**：WebVPN 门户 appid=`aea49a21-6b26-4e8f-bcfc-80e3de591c93`，service=`https://webvpn.sicau.edu.cn/login?cas_login=true`；教务 appid=`b54a2f27-f7ba-4b91-bbf0-3b2b12244d14`，service 默认真站 `caslogin.asp`（见《教务鉴权方案》）。
4. **auth 经 WebVPN 可「免 VPN 登录」访问**：正确编码路径下，`/api/v1/captcha` 与 `/api/v1/cas/login` 在**仅有/甚至尚无**有效业务 ticket 时仍返回业务 JSON（错误验证码 → `验证码错误`），不 302 回登录页（实测 2026-10-30）。
5. **jiaowu 经 WebVPN 必须先完成 WebVPN CAS**：未认证时访问编码后的教务路径一律 `302 Location: https://webvpn.sicau.edu.cn/login`（实测）。
6. **会话 Cookie**：`wengine_vpn_ticketwebvpn_sicau_edu_cn`，`Domain=webvpn.sicau.edu.cn`，`HttpOnly`，常见 `Secure`，**无 Max-Age（会话级）**；另有 `show_vpn`/`show_faq` Max-Age=604800。非法 CAS ticket 回调页文案：`INVALID_TICKET: 票据鉴权失败：非法的ticket`（实测）。
7. **改写行为**：HTML 注入 `__vpn_*` + `/wengine-vpn/js/main.js`；`Location` 中绝对站内跳转改为 `webvpn…/https/<segment>/…`；外链资源可带 `?vpn-N`；`service` 查询参数可保持为 WebVPN 编码后的 caslogin URL（实测）。
8. **与现有直连 CAS 的关系**：校外若教务直连不可达，需要 **WebVPN 登录（门户 CAS）+ 教务 CAS**。2026-10-31 真账号补验：门户登录后，再打开编码后的教务 `caslogin.asp`，出现 `cascallback=choose` 并**自动进入已登录教务**，没有第二次图形码。这是同一套川农 e 认证的 SSO，**不是** Cookie 头跨域共享（auth 的 VPN cookie 罐仍为空）。中间 `service` 仍是真站 `caslogin.asp`；浏览器能留在 WebVPN 路径，是因为 `main.js` 改写了跳转。RN 不执行 `main.js`，必须自己把 `service` / `callbackUrl` 编成 WebVPN URL。本机 2026-10-31 直连教务首页仍 200，**不能当作稳定校外可达**；策略仍是直连优先、失败再切。
9. **工程建议**：优先「传输适配层」方案 A（URL 编码 + 单域 `webvpn` Cookie）；WebView 方案 B 作备选；方案 C 放弃 App 内校外教务。
10. **风险**：须知强调账号仅限本人、防恶意下载会拉黑；自动化/非浏览器客户端可能触发风控；RN 不跑 `main.js` 时，`ASPSESSIONID*` 是否仅靠响应 `Set-Cookie` 进入系统 Cookie 罐仍未拆响应头验证；禁止把 WebVPN 编码 URL 做成服务端任意代理（SSRF）。

---

## 协议与 URL 编码

### 路径形态

```text
https://webvpn.sicau.edu.cn/{scheme}[ -{port} ]/{key_hex}{host_ciphertext_hex}{original_path}?{query}
```

| 段                        | 含义                                        | 示例                                                          |
| ------------------------- | ------------------------------------------- | ------------------------------------------------------------- |
| `scheme`                  | 目标协议                                    | `https` / `http`；带端口时为 `https-443`                      |
| `key_hex`                 | IV/密钥的 hex 前缀（固定）                  | `77726476706e69737468656265737421` = ASCII `wrdvpnisthebest!` |
| `host_ciphertext_hex`     | 仅主机名密文 hex（长度 = 主机名字节数 × 2） | 见下表                                                        |
| `original_path` + `query` | **明文**保留                                | `/api/v1/captcha?appid=…`                                     |

**缺前缀即失败**：只有 `encrypt(host)`、没有 `key_hex` 前缀时，auth captcha 会 `302 → /login`（实测）。  
**端口形态**：`/https-443/{key_hex}{cipher}/…` 对 captcha 返回 200（实测）。

### 算法（与 live 密文一致）

```text
KEY = IV = b"wrdvpnisthebest!"          # 16 bytes
AES-128-CFB, segment_size = 128 bits

# 主机名右侧用字符 '0' 填充到 16 字节对齐后再加密，
# 输出只取前 len(host) 字节的 hex（与 HollowMan6 实现一致）
path_segment(host) = KEY.hex() + encrypt(pad_right_0(host)).hex()[: len(host)*2 ]
```

页面注入（auth wui，实测）：

```js
var __vpn_host_crypt = true;
var __vpn_host_crypt_key = "wrdvpnisthebest!";
var __vpn_host_crypt_iv = "wrdvpnisthebest!";
var __vpn_js_file = "/wengine-vpn/js/main.js?ver=20260724-02";
```

| 主机                  | `encrypt(host)` hex                      | 完整 path 段                              |
| --------------------- | ---------------------------------------- | ----------------------------------------- |
| `auth.sicau.edu.cn`   | `f1e25594692361537f1dc7a99c406d36ef`     | `77726476706e69737468656265737421` + 左列 |
| `jiaowu.sicau.edu.cn` | `fafe409330252643770b88b9d65027203418e0` | 同上规则                                  |
| `res.wx.qq.com`       | （推导）`e2f252d2302826416f468aa395`     | 与 wui 内 jweixin 脚本 URL 一致           |

**Worked examples（可直接 curl）**

```text
# 教务 CAS 入口（经 WebVPN；未登录 VPN 时会 302 /login）
https://webvpn.sicau.edu.cn/https/77726476706e69737468656265737421fafe409330252643770b88b9d65027203418e0/jiaoshi/aspsso/caslogin.asp

# 统一身份 captcha（教务 appid；未登录 VPN 也可 200）
https://webvpn.sicau.edu.cn/https/77726476706e69737468656265737421f1e25594692361537f1dc7a99c406d36ef/api/v1/captcha?appid=b54a2f27-f7ba-4b91-bbf0-3b2b12244d14

# WebVPN 自己的 CAS 入口（login 302 目标）
https://webvpn.sicau.edu.cn/https/77726476706e69737468656265737421f1e25594692361537f1dc7a99c406d36ef/sso/login?appid=aea49a21-6b26-4e8f-bcfc-80e3de591c93&service=https%3A%2F%2Fwebvpn.sicau.edu.cn%2Flogin%3Fcas_login%3Dtrue
```

本地 openssl 校验（实测 2026-10-30，与上表一致）：

```bash
# 主机密文（截断前需按 '0' 填充，见上文；短主机可与不填充结果相同）
openssl enc -aes-128-cfb -K 77726476706e69737468656265737421 \
  -iv 77726476706e69737468656265737421 -nosalt
```

### URL / 响应改写（观察）

| 机制        | 行为                                                                                                                                  | 来源                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| HTML 头注入 | 每页前插入 `__vpn_hostname_data` 等 + `main.js`                                                                                       | 实测 sso/wui 302/200 体 |
| 绝对链接    | 站内资源改写为 `/https/<segment>/…`；微信 JSSDK 等外链同样编码                                                                        | 实测 wui HTML           |
| 查询标记    | 部分静态资源追加 `?vpn-6` / `?vpn-7`                                                                                                  | 实测                    |
| `Location`  | 上游 302 的站内目标改为 webvpn 绝对 URL；`service=` 可保留调用方传入的（含已编码的 caslogin）                                         | 实测 sso/login          |
| Set-Cookie  | 网关自身下发 `wengine_vpn_ticket…` 到 **webvpn 域**；上游业务 Cookie 是否改写到同域 / 是否进 `/wengine-vpn/cookie` **完整登录后未测** | 部分实测                |
| JS hook     | `main.js` 含 `vpn_rewrite_url`、`vpn_real_set_cookie`、`/wengine-vpn/cookie` 等符号                                                   | 实测 main.js 字符串     |

旁证实现（算法同源，密钥可能校各不同）：

- [HollowMan6/Get-Web-Address `Get_Web_VPN_Address.py`](https://github.com/HollowMan6/Get-Web-Address/blob/main/Get_Web_VPN_Address.py)（`wrdvpnisthebest!` + CFB segment 128 + `key.hex()+cipher`）
- [neucn/neugo `encrypt.go`](https://github.com/neucn/neugo/blob/master/encrypt.go)（同结构；东北大学实例密钥不同）

---

## 登录与会话模型

### WebVPN 门户登录链（无账号时的跳转）

```text
GET https://webvpn.sicau.edu.cn/
  → 302 Location: https://webvpn.sicau.edu.cn/login
  → Set-Cookie: wengine_vpn_ticketwebvpn_sicau_edu_cn=<16 hex>; Path=/; Domain=webvpn.sicau.edu.cn; HttpOnly[; Secure]

GET /login
  → 302 Location: /https/7772…7421f1e2…6d36ef/sso/login
       ?appid=aea49a21-6b26-4e8f-bcfc-80e3de591c93
       &service=https%3A%2F%2Fwebvpn.sicau.edu.cn%2Flogin%3Fcas_login%3Dtrue
  → Set-Cookie: show_vpn=0; show_faq=0; Path=/; Secure; Max-Age=604800

GET …/sso/login?…
  → 302 Location: …/wui/#/?appid=aea49a21-…&service=…
  → 响应体前插入 __vpn_* + main.js

GET …/wui/
  → 200  <title>川农e认证 - 统一身份认证</title>
```

用户在 wui 完成「密码 + 图形验证码」后，CAS 应回跳：

```text
https://webvpn.sicau.edu.cn/login?cas_login=true&ticket=…&userId=…
```

用伪造 ticket 实测：页面 200，前端 `errorMessage` =

`登录失败，错误：无法解析SSO相应的XML内容(INVALID_TICKET: 票据鉴权失败：非法的ticket)`

说明 WebVPN 侧按 **CAS 票据 XML 校验** 升级会话，而不是忽略 ticket（实测 2026-10-30）。

登录页仅暴露「统一认证」Tab（`only-auth`），另有本地表单相关端点符号 `/do-confirm-login`、`/do-second-login`（须知写明账号登录为本地账号，与 CAS 并列；农屿应只走 CAS）。

### 两套 CAS 应用

| 应用        | appid                                  | service 典型值                                                                                                    | 成功后得到                             |
| ----------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| WebVPN 门户 | `aea49a21-6b26-4e8f-bcfc-80e3de591c93` | `https://webvpn.sicau.edu.cn/login?cas_login=true`                                                                | 有效 `wengine_vpn_ticket*`（可进资源） |
| 教务系统    | `b54a2f27-f7ba-4b91-bbf0-3b2b12244d14` | 直连：`https://jiaowu.sicau.edu.cn/jiaoshi/aspsso/caslogin.asp`；经 VPN 时应改为 **WebVPN 编码后的 caslogin URL** | `ASPSESSIONID*`（教务业务）            |

**ticket / service / appid 禁止跨应用混用。**  
已有 CAS 会话能否免验证码进入 WebVPN：**未用真账号验证**（平台直连侧历史结论偏「无持久 SSO」，见《教务鉴权方案》§10.1；WebVPN 场景可能不同）。

### captcha / cas/login 经 WebVPN（已测）

| 请求                                             | 条件                 | 结果                                                         |
| ------------------------------------------------ | -------------------- | ------------------------------------------------------------ |
| `GET …/auth段/api/v1/captcha?appid=教务或WebVPN` | 正确 `key_hex` 前缀  | **200** JSON，`code=200`，含加密 `data` + `id` + `requestId` |
| 同上                                             | 无 `key_hex` 前缀    | **302** `/login`                                             |
| `POST …/auth段/api/v1/cas/login` 错误验证码      | 正确前缀 + 合法 uuid | **200** 体 `code=500` `msg=验证码错误`（契约与直连一致）     |
| CORS preflight OPTIONS                           | Origin 任意          | `Access-Control-Allow-Origin: *`（与直连 auth 类似）         |

含义：统一身份认证 API **不必**先完成 WebVPN 登录即可经代理调用；但 **不能**据此访问 jiaowu。

### jiaowu 经 WebVPN（已测 / 未测）

| 请求                                                              | VPN 未登录                                 | 说明                                                          |
| ----------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------- |
| 编码后的 `/web/web/web/index.asp`、`/jiaoshi/aspsso/caslogin.asp` | **302 → /login**                           | 资源级鉴权，与 auth API 白名单不同                            |
| 登录 VPN 后的 ASP 页、`ASPSESSIONID` Set-Cookie 改写              | **未测**                                   | 需真账号                                                      |
| 直连 `https://jiaowu.sicau.edu.cn/…`                              | 本机 2026-10-30 返回 200 + `ASPSESSIONID*` | **环境相关**；产品文档仍按「校外常不可达」设计，WebVPN 作兜底 |

### Cookie 寿命与罐

| Cookie                                  | Domain                                      | 寿命                                         | 作用                              |
| --------------------------------------- | ------------------------------------------- | -------------------------------------------- | --------------------------------- |
| `wengine_vpn_ticketwebvpn_sicau_edu_cn` | `webvpn.sicau.edu.cn`                       | 会话（响应无 Max-Age；curl jar `expires=0`） | 无有效值则 jiaowu 等资源 302 登录 |
| `show_vpn` / `show_faq`                 | host-only                                   | Max-Age=604800                               | UI 偏好，非鉴权                   |
| 教务 `ASPSESSIONID*`                    | 直连为 jiaowu host；经 VPN **改写规则未测** | 会话                                         | 业务页                            |

`/wengine-vpn/cookie?method=get&host=jiaowu…` 在未登录时 **200 + 空 body**（实测）；登录后是否托管上游 Cookie 待证。  
main.js 暴露 `vpn_real_get_cookie` / `vpn_update_cookie` / `/wengine-vpn/cookie`，浏览器场景由脚本维护；**原生 RN 请求不会执行 main.js**，必须依赖：

1. 网关把上游 `Set-Cookie` 改写到 `webvpn` 域并由系统 Cookie 罐保存；或
2. 自行解析 `Set-Cookie`（RN XHR 常读不到）/ Cookie 桥；或
3. WebView 同源。

---

## 与现有 CAS 教务登录的衔接方案

现有实现：`packages/nongyu-tool-jiaowu/core/login/cas.ts`  
直连 `auth.sicau.edu.cn` + `jiaowu.sicau.edu.cn`（见 `docs/nongyu-rn-app/tech/教务鉴权方案.md`）。

### 方案 A — 传输适配层（推荐原型方向）

```text
JiaowuTransport
  ├─ DirectTransport      // 现状：校园网 / 直连可达时
  └─ WebVpnTransport      // 所有绝对 URL → encode；Cookie 挂 webvpn 域
```

建议步骤：

1. **探测**：直连 jiaowu 超时/失败 → 切换 WebVPN 模式。
2. **WebVPN 登录**：`getCaptcha(appid=aea49a21-…)` → 用户输码 → `cas/login` → 跟随 `callback` 到 `/login?cas_login=true&ticket=…`，确认 `wengine_vpn_ticket*` 已是「已认证」态（资源不再 302 登录）。
3. **教务 CAS**：同一用户再走教务 appid；**`service` / `callbackUrl` 使用 WebVPN 编码后的 caslogin**，避免 ticket 回投到校外不可达的真站 host。
4. 业务 `get/post` 一律 `encode(url)`，并带上 webvpn Cookie；跟随 `Location` 时若仍是真站绝对地址需再 encode。
5. 会话过期：VPN ticket 失效与 ASP 失效都要能区分提示。

| 优点                                         | 缺点                                            |
| -------------------------------------------- | ----------------------------------------------- |
| 最大化复用现有验证码/解密/两跳 caslogin 逻辑 | 可能 **两次** 图形验证码（门户 + 教务）；体验差 |
| 单域 `webvpn.sicau.edu.cn` 利于 RN Cookie 罐 | 须处理 Location/HTML 绝对链；编码/端口边角      |
| 与浏览器 WebVPN 行为接近                     | 完整链路未用真账号验收；ToS 风险                |

**SSO 优化（未验证）**：若 WebVPN 登录后 auth 侧会话能被代理回传，教务 CAS 或可少一次密码；仍可能要验证码。不可作为当前设计前提。

### 方案 B — WebView 完成 WebVPN + 可选教务

App 打开 `https://webvpn.sicau.edu.cn/login`，用户原生浏览器流登录；再：

- 用 WebView Cookie 桥导出 `wengine_vpn_ticket*` 给原生 axios；或
- 教务页也在 WebView 内打开（产品形态更像「内置浏览器」）。

| 优点                         | 缺点                          |
| ---------------------------- | ----------------------------- |
| 少逆向；main.js 改写自动生效 | Cookie 桥各端差异大；体验割裂 |
| 登录 UI 与学校一致           | 审核/安全；难后台结构化抓取   |

### 方案 C — App 不内置 WebVPN

校外用户自行浏览器 WebVPN 或学校其他 VPN；App 仅保证校园网直连。

| 优点                | 缺点                       |
| ------------------- | -------------------------- |
| 零协议与 ToS 接触面 | 不满足「App 内校外查教务」 |

### 方案选择建议

- **产品要校外教务**：先用 **方案 A 的 Node/脚本 throwaway prototype**（真账号）跑通「双 CAS + 一页成绩/学籍」；确认 Set-Cookie 改写后再考虑 RN。
- **只需校园网**：维持直连；本笔记仅作运维/客服解释材料。
- **不要**把 WebVPN 当「当前 RN 会话保持 bug」的修复手段——那是 Cookie/探测问题，与校外可达正交。

### 与现有常量的映射（实现时注意）

| 现有直连                                       | WebVPN 模式                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `CAS_BASE_URL=https://auth.sicau.edu.cn`       | `https://webvpn…/https/<auth段>`                                                                             |
| `CAS_SERVICE_URL=https://jiaowu…/caslogin.asp` | `https://webvpn…/https/<jiaowu段>/jiaoshi/aspsso/caslogin.asp`                                               |
| 业务 URL `https://jiaowu…/xuesheng/…`          | 同 host 段 + 原 path                                                                                         |
| Cookie 只认 `ASPSESSIONID*`                    | 网关按 host 保存 `ASPSESSIONID*`；浏览器真实 Cookie 罐里没有它。保持登录靠 HttpOnly 的 `wengine_vpn_ticket*` |

---

## 2026-10-31 真账号浏览器验证

用户在共享浏览器自行完成 WebVPN 密码登录。记录只含跳转、页面标题和 Cookie **名称**，不含口令、票据或 Cookie 值，也不摘录学籍字段。

| 观察                                                                              | 结果                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 门户                                                                              | 登录后进入 WebVPN 资源页                                                                                                                                                                              |
| 本机直连 `jiaowu` 首页                                                            | 200，并下发 `ASPSESSIONID*`（响应无 `HttpOnly`）。此环境「校园网优先」会走直连                                                                                                                        |
| 仅有 VPN 会话时打开编码后的学籍页                                                 | 落到教务首页「教务处欢迎您！」，不是 VPN `/login`。网关已放行，教务业务未登录                                                                                                                         |
| 打开编码后的 `caslogin.asp`                                                       | 先到编码后的 auth `wui`：教务 appid，`cascallback=choose`，`service` 查询参数仍是真站 `https://jiaowu.sicau.edu.cn/jiaoshi/aspsso/caslogin.asp`。随后无第二次图形码，进入「四川农业大学教务管理系统」 |
| 再开学籍页                                                                        | 标题「学生个人基本信息表」。业务会话经 WebVPN 有效                                                                                                                                                    |
| 编码后的教务页 `document.cookie`                                                  | getter 被 `main.js` 挂钩，名称含 `ASPSESSIONID*`。这不是浏览器真实罐                                                                                                                                  |
| `GET /wengine-vpn/cookie?method=get&host=jiaowu.sicau.edu.cn&scheme=https&path=/` | 200，非空，名称 `ASPSESSIONID*`                                                                                                                                                                       |
| 同上 `host=auth.sicau.edu.cn`                                                     | 200，空                                                                                                                                                                                               |
| 缺 `scheme` / `path` 的 get                                                       | 200，空。不能据此判断罐是空的                                                                                                                                                                         |

`main.js` 字符串表给出的读写形态（未单步执行 set）：

```text
GET  /wengine-vpn/cookie?method=get&host={host}&scheme={scheme}&path={path}&vpn_timestamp=
POST /wengine-vpn/cookie?method=set&host={host}&ck_data=
```

相关符号：`vpn_update_cookie`、`vpn_real_get_cookie`、`vpn_real_set_cookie`。上游 Cookie 按 **host** 存在网关罐里，由脚本同步到当前页 `document.cookie`。这不是 auth 域与 webvpn 域共享同一份 `Set-Cookie`。

**对「Cookie 头应该共享」的判断**：不成立。共享的是 WebVPN 网关会话加上同一套川农 e 认证的 SSO。auth 主机罐为空；教务罐里只有 `ASPSESSIONID*`。

**对农屿的可行性**：可以做「直连失败再切 WebVPN」。浏览器链路已经能进学籍页，且这次没有第二次图形码。接入时必须自己编码 `service` / `callbackUrl`，不能依赖 `main.js`。保持登录不靠把 `ASPSESSIONID*` 抄进 MMKV，见下一节。

---

## 登录态怎么保持（2026-10-31）

两层会话，不要混成一张 Cookie。

| 层          | 凭什么                                  | 浏览器里实际在哪                                                                                                                                                                        | 寿命                                                             |
| ----------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| WebVPN 网关 | `wengine_vpn_ticketwebvpn_sicau_edu_cn` | HttpOnly，`cookieStore` 和原生 `document.cookie` 都看不到。匿名下发时无 `Max-Age`（会话级）。登录后脚本仍看不到，不能确认有没有被改成持久 Cookie                                        | 关浏览器可能丢；服务端空闲超时未在 `/user/info` 和门户 JS 里公布 |
| 教务业务    | `ASPSESSIONID*`                         | **不在**浏览器真实罐。存在网关的 host 罐：`/wengine-vpn/cookie?method=get&host=jiaowu.sicau.edu.cn&scheme=https&path=/`。编码后的教务页由 `main.js` 挂钩 `document.cookie` 把它显示出来 | 跟 vpn ticket 走。IIS 自己的会话超时这次没等，不能写成 20 分钟   |
| 无关        | `show_vpn` / `show_faq`                 | 真实罐，持久，`Secure`，`SameSite=Lax`，约 7 天                                                                                                                                         | UI 偏好                                                          |
| 无关        | `refresh`                               | 真实罐，会话级，无 `Secure`                                                                                                                                                             | `main.js` 跨帧同步信号（`refresh=0` / `refresh=1`），不是续期    |

决定性对照：门户页（`https://webvpn.sicau.edu.cn/`）的 `document.cookie` getter 是原生的，名称只有 `show_vpn`、`show_faq`、`refresh`。从这一页 `fetch` 编码后的学籍页，`credentials: "include"`，不带挂钩后的 `ASPSESSIONID*`，仍返回 200，GBK 标题为「学生个人基本信息表」。所以网关用 vpn ticket 在服务端补上游 Cookie，客户端不必自己再贴 `ASPSESSIONID*`。

`main.js` 里每秒一次的 `setInterval(Qh, 1000)` 是在同步 `localStorage`，不是心跳。注销入口是门户的 `/logout`，调用会拆掉票据，探索时不要打。

和现有 App 的差别：`apps/nongyu-rn-app/src/modules/jiaowu/auth/jiaowuSession.ts` 只把 `ASPSESSIONID*` 写入 MMKV（`jiaowu:asp_cookie`）。这能恢复直连教务，不能恢复 WebVPN。ticket 是 HttpOnly，JS 读不走，也不能抄进 MMKV。

农屿若要保持 WebVPN 登录：

1. 直连通：继续用现有 MMKV 里的 ASP Cookie。
2. 走 WebVPN：让原生 Cookie 罐保住 `webvpn.sicau.edu.cn` 上的 ticket（`withCredentials`）。不要依赖 `main.js`，也不要只恢复 ASP Cookie。
3. 冷启动探测：打一个编码后的教务页。302 到 `/login` 表示 ticket 已死；正文是「登录超时」表示 ticket 还在、教务会话已死，再走一次教务 CAS（这次浏览器里可以免第二次图形码，但不能当成永远成立）。
4. 探测优先打门户 `GET /user/info`（200 且无个人字段需求，只看是否还是登录态），不要为了续期去刷学籍页。须知禁止连续、批量下载。
5. 精确空闲超时仍然未知。不要发明一个定时打教务的保活。

---

## 未验证项 / 风险

| 项                                   | 状态                    | 说明                                                                                                                                                                                           |
| ------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 真账号完整 WebVPN 登录               | ✅                      | 2026-10-31 浏览器登录进入资源页。未记录 ticket 值，TTL 仍未知                                                                                                                                  |
| 认证后 jiaowu ASP 页 / 两跳 caslogin | ✅                      | 免第二次图形码进入教务，学籍页标题为「学生个人基本信息表」                                                                                                                                     |
| 上游 `Set-Cookie` 域名/路径改写      | ✅ 否定「改写进真实罐」 | 门户页 cookie getter 是原生的，真实罐只有 `show_vpn` / `show_faq` / `refresh`，没有 `ASPSESSIONID*`。教务页里看到的 `ASPSESSIONID*` 是 `main.js` 挂钩。网关按 vpn ticket 在服务端补上游 Cookie |
| `/wengine-vpn/cookie` 读写语义       | 部分                    | get 必须带 `host`+`scheme`+`path`，否则 200 空体。登录后 jiaowu get 返回 `ASPSESSIONID*` 名称；auth get 为空。set 未主动调用                                                                   |
| 已登录 CAS 是否可无验证码进 WebVPN   | 部分                    | 本次是先登 WebVPN 再进教务，不是先直连 auth 再进 WebVPN                                                                                                                                        |
| 双 CAS 是否可合并为一次验证码        | ✅                      | 本次门户一次图形码后，教务 `cascallback=choose` 自动完成，无第二次图形码                                                                                                                       |
| VPN ticket 空闲超时精确值            | 部分                    | 仅知会话 Cookie、无 Max-Age                                                                                                                                                                    |
| 学校对第三方客户端 ToS               | ⚠                       | 须知：账号仅限本人；恶意下载拉黑（1 分钟内间隔 &lt;15s 基础限制；连续 5 次 → 1 小时限制）                                                                                                      |
| 账号锁定 / 验证码风控                | ⚠                       | 与直连相同；WebVPN 出口 IP 可能共享，误伤风险                                                                                                                                                  |
| SSRF                                 | ⚠                       | 若服务端接受用户传入并请求任意 WebVPN 编码 URL，等于开放校内代理                                                                                                                               |
| RN Cookie 罐                         | ⚠                       | HttpOnly + 跨域；已有直连坑（读不到 Set-Cookie）在 webvpn 单域下可能缓解也可能更复杂                                                                                                           |
| 证书钉扎                             | ⚠                       | WebVPN 证书 ≠ jiaowu/auth 直连                                                                                                                                                                 |
| 非 Web 协议                          | 须知已声明              | 不支持 RDP/FTP 等；与教务 HTML 无关                                                                                                                                                            |

**合规摘录**（登录页须知，实测 2026-10-30）：为校外访问图书馆电子资源、信息门户等开通 WebVPN；支持电脑/手机/PAD；**账号仅限本人**；禁止连续、系统、集中、批量下载；触发频率限制会加入黑名单。

---

## 引用

| 来源                                                                                                                | 内容                                                                     | 时间            |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------- |
| `https://webvpn.sicau.edu.cn/`                                                                                      | 302 `/login` + 下发 `wengine_vpn_ticket*`                                | 实测 2026-10-30 |
| `https://webvpn.sicau.edu.cn/login`                                                                                 | 302 至编码后 auth `sso/login`；appid `aea49a21-…`；须知与网瑞达 keywords | 实测 2026-10-30 |
| `…/login?cas_login=true&ticket=ST:FAKE`                                                                             | `INVALID_TICKET` 文案；产品名 WebVPN 资源访问控制系统                    | 实测 2026-10-30 |
| `…/https/<auth段>/api/v1/captcha`                                                                                   | 无 VPN 登录亦 200；缺 key 前缀则 302                                     | 实测 2026-10-30 |
| `…/https/<auth段>/api/v1/cas/login`                                                                                 | 错验证码 → `验证码错误`；CORS `*`                                        | 实测 2026-10-30 |
| `…/https/<jiaowu段>/web/…/index.asp` 等                                                                             | 未登录 302 `/login`                                                      | 实测 2026-10-30 |
| `…/wengine-vpn/js/main.js?ver=20260724-02`                                                                          | `wrdvpnisthebest!`、AES/segment、cookie hook 符号                        | 实测 2026-10-30 |
| openssl / 本地编码                                                                                                  | auth/jiaowu 密文与 live Location 一致                                    | 实测 2026-10-30 |
| `https://jiaowu.sicau.edu.cn/…` 直连                                                                                | 本环境 200 + ASPSESSIONID（不稳定假设）                                  | 实测 2026-10-30 |
| `https://auth.sicau.edu.cn/api/v1/captcha`                                                                          | 公网直连 200                                                             | 实测 2026-10-30 |
| [HollowMan6 Get_Web_VPN_Address.py](https://github.com/HollowMan6/Get-Web-Address/blob/main/Get_Web_VPN_Address.py) | 编码算法旁证                                                             | 拉取 2026-10-30 |
| [neucn/neugo encrypt.go](https://github.com/neucn/neugo/blob/master/encrypt.go)                                     | 同结构旁证（密钥校方不同）                                               | 拉取 2026-10-30 |
| `docs/nongyu-rn-app/tech/教务鉴权方案.md`                                                                           | 直连 CAS、appid、两跳、RN Cookie                                         | 仓库文档        |
| `packages/nongyu-tool-jiaowu/core/login/cas.ts`                                                                     | 直连实现                                                                 | 仓库源码        |

---

## 附录：最小复现命令

```bash
# 1) 取匿名 ticket
curl -sI https://webvpn.sicau.edu.cn/ | grep -i set-cookie

# 2) 看门户 CAS 跳转
curl -sI https://webvpn.sicau.edu.cn/login | grep -i location

# 3) auth captcha 经 WebVPN（应 200）
AUTH=77726476706e69737468656265737421f1e25594692361537f1dc7a99c406d36ef
curl -s "https://webvpn.sicau.edu.cn/https/${AUTH}/api/v1/captcha?appid=b54a2f27-f7ba-4b91-bbf0-3b2b12244d14" | head -c 200

# 4) jiaowu 未登录（应 302 login）
JW=77726476706e69737468656265737421fafe409330252643770b88b9d65027203418e0
curl -sI "https://webvpn.sicau.edu.cn/https/${JW}/web/web/web/index.asp" | grep -i location
```

**一句话**：WebVPN 登录态是 HttpOnly 的 `wengine_vpn_ticket*`，不是和 auth 共享的 Cookie，也不是 MMKV 里的 `ASPSESSIONID*`。网关按这张票在服务端补教务 Cookie；`main.js` 只是把这张上游 Cookie 显示出来。农屿要保持登录，就保住 webvpn 域上的这张票。

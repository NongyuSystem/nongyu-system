# WebVPN 传输适配

> 状态：已按 2026-10-31 选型实施  
> 依据：`docs/nongyu-rn-app/tech/WebVPN探索.md`；登录页现有统一身份认证流程  
> 选型：传输层 + 系统 Cookie 罐；登录页一起改；Android 原生模块导出 HttpOnly 票据

## 背景

校外经常访问不到 `jiaowu.sicau.edu.cn`。川农 WebVPN 是网瑞达 wengine 反向代理。登录态是 `webvpn.sicau.edu.cn` 上 HttpOnly 的 `wengine_vpn_ticket*`，不是和统一认证共享的 Cookie，也不是 MMKV 里的 `ASPSESSIONID*`。RN 不执行 `main.js`，必须自己编码 URL 和 `service`。

## 目标

- 校园网直连优先；直连超时或网络失败再切 WebVPN。
- 切到 WebVPN 后，教务与 auth 的绝对地址改写成 `https://webvpn.sicau.edu.cn/{scheme}/{key_hex}{host_cipher}/{path}`。
- 登录页在校外明确走 WebVPN：先门户验证码，教务会话没建立再要一次教务验证码。
- 登录成功后用原生模块读出票据，写入 SecureStore；冷启动写回系统 Cookie 罐。票据失效（302 到 `/login`）则重新登录，不定时刷学籍页。

## 边界

- 不做服务端代请求，不把 WebVPN 编成任意 URL 代理。
- 不把票据或密码写进日志、埋点、MMKV。
- 不实现 WebView 登录，不实现 iOS 原生模块（当前本地模块只有 Android）。iOS 冷启动读不到票据时走重新登录。
- 不保证永远免第二次验证码。浏览器里出现过 SSO，RN 不跑 `main.js`，失败就再要一次码。
- 不探测或公布学校未公开的空闲超时，不做保活轮询。

## 详细需求

1. 编码算法与探索笔记一致：AES-128-CFB，`segment_size=128`，`key=iv=wrdvpnisthebest!`，主机名右侧用 `0` 填到 16 字节对齐，密文只取主机名长度，路径前拼 key 的 hex。
2. 只改写 `jiaowu.sicau.edu.cn` 与 `auth.sicau.edu.cn`。已经是 webvpn 域的 URL 不动。
3. WebVPN 模式下 `service` / `callbackUrl` / 302 `Location` 若指向真站，再编码一次，禁止回落到校外不可达的真站。
4. 直连模式行为与现网一致。
5. Android 模块只读写 `wengine_vpn_ticketwebvpn_sicau_edu_cn`，走 RN 使用的 `java.net.CookieManager`，不用 WebView 的 `CookieManager`。
6. 退出登录清票据。

## 业务流程

```text
打开登录页
  → 短超时探测教务首页
  → 通：直连，现有一次图形码
  → 不通：WebVPN
       → 门户 appid 图形码 → 回投 /login?cas_login=true
       → 尝试编码后的 caslogin；若仍要认证页，再要一次教务图形码
       → 原生模块读票据 → SecureStore
冷启动
  → 有票据则写回 Cookie 罐并切到 WebVPN
  → 无票据则直连
```

## 验收

- 编码器对 `auth.sicau.edu.cn`、`jiaowu.sicau.edu.cn` 的密文与探索笔记一致。
- 直连模式不改写 URL。
- 登录页在探测失败时显示校外 WebVPN 说明。
- 票据不出现在日志文案里。
- `pnpm --filter nongyu-tool-jiaowu type-check` 通过。

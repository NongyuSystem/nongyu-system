# 技术设计文档

### 技术栈

- 处理编码（iconv-lite）
- 存储二进制（buffer）
- 网络请求（axios）
- 加解密（crypto-js）：统一身份认证响应体为 AES-128-CBC，RN 无 `node:crypto`

### 架构设计

- 网络层
  基于axios封装request函数，再基于此封装get和post函数对外暴露，对于request，使用请求拦截器添加cookie，对于响应，使用响应拦截器做 GBK 解码。业务页若响应体包含“登录超时”则**清 Cookie 并抛 `JiaowuSessionExpiredError`**（统一身份认证后需要用户重新输验证码，无法静默重登）；网络错误最多重试 3 次。登录链路见下方「已验证登录」；拦截器不覆盖登录已带的 User-Agent。
  对于get请求最终fetchJiaowuHtml函数，用于获取教务系统页面的HTML内容
- 解析层
  使用packages\nongyu-tool-jiaowu\core\extractor目录下的文件，用于从原始HTML中清洗出结构化数据
- 直接导出层
  整合网络层和解析层，提供直接导出数据的功能
  最终分别放在packages\nongyu-tool-jiaowu\core\jiaowu再统一导出

### 已验证登录（2026-10-24，统一身份认证）

教务处于 2026-10-23 取消首页账号密码登录，改为「微信扫码」或「统一身份认证」。当前主路径是后者，包内实现：`core/login/cas.ts` 的 `getJiaowuCaptcha` + `jiaowuLoginByCas`。

1. `GET https://auth.sicau.edu.cn/api/v1/captcha?appid=<教务 appid>` → 拿到加密响应体，解密后得到 `data:image/png;base64,...`，连同响应里的 `id`（即 uuid）交给界面显示。
2. 用户在界面上**读图输入验证码**（不做 OCR）。
3. `POST https://auth.sicau.edu.cn/api/v1/cas/login`，JSON body：`appid`、`code`（用户输入）、`number`（学号）、`password`、`uuid`。响应同样是加密体，解密得到 `{ callbackUrl, st, users:[{id}] }`。
4. `GET <callbackUrl>?ticket=<st>:<userId>&userId=<userId>`，教务系统据此建立自己的 ASP 会话并返回 `Set-Cookie: ASPSESSIONID*`。
5. 把 `ASPSESSIONID*` 写入工具内存 Cookie，后续业务页复用。

关键常量：

- 教务 appid：`b54a2f27-f7ba-4b91-bbf0-3b2b12244d14`（来自 `caslogin.asp` 的 302 `Location`，不是自定义值）
- service / callbackUrl：`https://jiaowu.sicau.edu.cn/jiaoshi/aspsso/caslogin.asp`
- 解密：`key = MD5(requestId + ":sicau-cas")`，base64 后前 16 字节为 IV，其余为密文，AES-128-CBC + NoPadding，明文尾字节 N 表示去掉尾部 N 字节

### 历史链路（已废弃，2026-08-14 调通）

> 2026-10-23 教务取消首页账号密码登录后，本路径随时会被彻底关闭。`core/login/index.ts` 的 `jiaowuLogin` 仅作回退对照保留。

1. 清空内存 Cookie。
2. GET `https://jiaowu.sicau.edu.cn/web/web/web/index.asp`，从 hidden 解析 `sign` / `hour_key`，从 `Set-Cookie` 取 `ASPSESSIONID*`（有则写入；禁止写空 Cookie 头）。
3. POST `https://jiaowu.sicau.edu.cn/jiaoshi/bangong/check.asp`，Referer 为登录页；body 顺序：`user`、`pwd`、`lb=S`、`submit=`、`sign`、`hour_key`。
4. 先 GBK 解码再判定：`alert` 为失败（透出原文）；302 或 `location` 跳转为成功。HTTP 200 不等于成功。

禁止冻抓包里的 Cookie / sign / hour_key。解析失败不得回退固定值。RN 加载 `dist/`，改源码后必须 `pnpm --filter nongyu-tool-jiaowu build`。

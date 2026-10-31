/**
 * 工具函数统一导出入口
 */

// 网络请求相关
export {
  request,
  get,
  post,
  attachJiaowuHttpLogger,
  type ExtendedAxiosRequestConfig,
  type JiaowuHttpLogEvent,
} from "./request";

export {
  getJiaowuTransport,
  setJiaowuTransport,
  type JiaowuTransportMode,
} from "../webvpn/transport";

// 解码相关
export { decodeToText, decodeGbk, encodeGbkUrl } from "./decode";

// Cookie 管理
export { getCookie, setCookie } from "./cookie";

export { resolveJiaowuUserAgent, setJiaowuUserAgent } from "./userAgent";

// 错误与超时提示
export {
  JIAOWU_CAMPUS_NETWORK_HINT,
  JiaowuSessionExpiredError,
  isJiaowuSessionExpiredError,
  isJiaowuTimeoutError,
  resolveJiaowuErrorMessage,
  jiaowuFailResult,
} from "./errors";

// 网页抓取
export { fetchJiaowuHtml } from "./fetchJiaowuHtml";

// HTML 解析
export * from "./html";

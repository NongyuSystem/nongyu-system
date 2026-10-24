/**
 * nongyu-tool-jiaowu
 * 农屿教务系统工具库
 *
 * 本工具库旨在提供四川农业大学教务系统的数据抓取与清洗功能，
 * 支持个人信息、成绩、考试安排、教务通知、学业进度及排名等数据的自动化获取。
 *
 * @author TangLei
 * @license ISC
 */

// 导出登录与账号配置模块
export {
  setLoginData, // 开局调此函数,便于其他鉴权函数的自动重登录
  jiaowuLogin, // 【已废弃】教务口令登录，2026-10-23 起教务已取消该入口
  clearLoginData, // 登出时清空 LOGIN_DATA 与 Cookie
} from "./core/login";

// 统一身份认证（CAS）登录：当前教务系统唯一可用的登录路径
export {
  getJiaowuCaptcha, // 取一张图形验证码交给界面显示
  jiaowuLoginByCas, // 账密 + 图形验证码登录
  jiaowuLoginByPhone, // 手机短信验证码登录
  sendJiaowuSmsCode, // 发送登录短信验证码
  type JiaowuCaptcha,
  type JiaowuCaptchaResult,
  type JiaowuCasLoginInput,
  type JiaowuCasLoginResult,
  type JiaowuPhoneLoginInput,
  type JiaowuSendSmsInput,
} from "./core/login";

// Cookie 桥接（冷启动恢复 / 持久化备份）
export { getCookie, setCookie } from "./core/utils";

export { resolveJiaowuUserAgent, setJiaowuUserAgent } from "./core/utils";

// 开发态 HTTP 日志挂载点（仅 RN __DEV__ 调用，包内不打印）
export { attachJiaowuHttpLogger, type JiaowuHttpLogEvent } from "./core/utils";

// 超时/内网提示 + 会话过期（需用户重新输验证码登录）
export {
  JIAOWU_CAMPUS_NETWORK_HINT,
  JiaowuSessionExpiredError,
  isJiaowuSessionExpiredError,
  isJiaowuTimeoutError,
  resolveJiaowuErrorMessage,
} from "./core/utils";

// 导出核心业务查询模块-仅限当前版本支持的功能
export {
  getRankInfo, // 获取学生的加权平均成绩及专业排名
  getCourseInfo, // 获取学生的课表信息
  getPlanInfo, // 获取学生的培养方案
  getTeacherCourseInfoByName, // 获取教师的课表信息
  getCompetitionInfo, // 获取竞赛通知
  getClassroomCourseInfoByName, // 获取教室的课表信息
  getPersonalInfo, // 获取个人信息
  getScoreInfo, // 获取成绩信息
  getExamInfo, // 获取考试安排
  getProgressInfo, // 获取学业进度
  getNoticeInfo, // 获取教务通知（教学+竞赛合并）
  getTeachingNoticeInfo, // 仅教学通知（App 通知页专用）
} from "./core/jiaowu";

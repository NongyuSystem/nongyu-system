/**
 * 退出登录会清空的本机数据清单。
 * 须与 `performJiaowuLogout` / `clearLocalAuthSession` 实际清理保持一致。
 */
export const LOGOUT_CLEAR_ITEMS = [
  "学号与密码",
  "登录状态与个人信息档案",
  "教务登录会话与 WebVPN 票据",
  "本地课表",
  "课表桌面小组件数据",
  "课表背景图",
  "课表备注、待办与自定义日程",
  "农屿 Agent 对话记录",
  "农屿 Agent 配置（API Key、模型等）",
  "二课登录状态",
  "AI 入口「不再提醒」偏好",
] as const;

/**
 * 退出登录确认框正文
 */
export function formatLogoutConfirmMessage(): string {
  const bullets = LOGOUT_CLEAR_ITEMS.map((item) => `· ${item}`).join("\n");
  return `退出后将清除以下本机数据：\n${bullets}\n\n主题、启动页、网页跳转等设备级偏好会保留。`;
}

-- 教务凭据托管：用户开启「账密自动登录」后，由服务端加密保存密码，
-- 会话过期时自动完成 CAS 登录，用户不必每次读验证码。
-- 关闭托管即删除该行，不保留任何副本。
CREATE TABLE IF NOT EXISTS jiaowu_credentials (
  user_id BIGINT UNSIGNED NOT NULL COMMENT 'users.id',
  student_no VARCHAR(32) NOT NULL COMMENT '学号（冗余，便于排查）',
  password_cipher TEXT NOT NULL COMMENT 'AES-256-GCM 密文，格式 iv.tag.cipher(base64)',
  enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '用户是否启用免验证码自动登录',
  last_login_at DATETIME(3) NULL COMMENT '最近一次自动登录成功时间（UTC）',
  last_error VARCHAR(255) NULL COMMENT '最近一次自动登录失败原因',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  KEY idx_jiaowu_credentials_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='教务凭据托管（可随时关闭并删除）';

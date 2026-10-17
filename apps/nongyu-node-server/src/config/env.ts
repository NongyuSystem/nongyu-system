import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "../..");

export function loadEnvFiles(envFile?: string) {
  if (envFile) {
    loadDotenv({ path: path.isAbsolute(envFile) ? envFile : path.resolve(process.cwd(), envFile) });
  } else {
    loadDotenv({ path: path.join(appRoot, ".env") });
    if (process.env.NODE_ENV === "test") {
      loadDotenv({ path: path.join(appRoot, ".env.test"), override: true });
    }
  }
}

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  /** 生产用 127.0.0.1，避免 3000 直接对公网 */
  LISTEN_HOST: z.string().min(1).default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MYSQL_HOST: z.string().min(1),
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_USER: z.string().min(1),
  MYSQL_PASSWORD: z.string(),
  MYSQL_DATABASE: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  /** App Access Token TTL，如 60d */
  JWT_APP_TTL: z.string().default("60d"),
  /**
   * 历史字段：Admin JWT 已改为不设 exp，读取后忽略。
   * 保留以免旧 .env 校验失败。
   */
  JWT_ADMIN_TTL: z.string().default("7d"),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(10),
  BUSINESS_TZ: z.string().default("Asia/Shanghai"),
  /**
   * 浏览器跨域白名单。留空 = 开发/test 放行本地 Vite Origin，生产禁止跨域（依赖 Nginx 同源反代）。
   * `*` = 任意 Origin（仅联调/过渡）；否则逗号分隔，如 `http://101.43.34.229,http://localhost:5173`
   */
  CORS_ORIGIN: z.string().default(""),
  INTERNAL_TOKEN: z.string().min(16),
  /** Track 根地址，无尾斜杠；Node 代理 Admin 指标时使用 */
  TRACK_BASE_URL: z
    .string()
    .min(1)
    .default("http://127.0.0.1:8082")
    .transform((value) => value.replace(/\/+$/, "")),
  SUPER_ADMIN_STUDENT_NO: z
    .string()
    .regex(/^\d{9}$/)
    .default("202308596"),
  /** 超管出厂默认密码；未配置时无库超管仅能靠已设哈希登录 */
  SUPER_ADMIN_DEFAULT_PASSWORD: z.string().default(""),
  /** 平台 LLM Key 池开关 */
  LLM_POOL_ENABLED: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .default("true")
    .transform((v) => v === true || v === "true" || v === "1"),
  LLM_POOL_DEFAULT_MODEL: z.string().min(1).default("glm-4.7-flash"),
  LLM_POOL_DEFAULT_BASE_URL: z
    .string()
    .min(1)
    .default("https://open.bigmodel.cn/api/paas/v4")
    .transform((value) => value.replace(/\/+$/, "")),
  LLM_POOL_QUEUE_WAIT_MS: z.coerce.number().int().positive().default(15_000),
  LLM_POOL_FIRST_TOKEN_TIMEOUT_MS: z.coerce.number().int().positive().default(12_000),
  LLM_POOL_MAX_KEY_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
  LLM_POOL_USER_DAILY_LIMIT: z.coerce.number().int().positive().default(100),
  LLM_POOL_LEASE_MAX_MS: z.coerce.number().int().positive().default(300_000),
  /** AES 密钥材料；池开启时加解密路径要求长度 ≥16 */
  LLM_KEY_ENCRYPTION_SECRET: z.string().default(""),
  /** 反馈墙帖子同步 GitHub Issue：Token；为空则整体关闭该能力 */
  GITHUB_TOKEN: z.string().default(""),
  /** 反馈墙帖子同步 GitHub Issue：目标仓库，格式 owner/repo */
  GITHUB_REPO: z.string().default(""),
  /** 反馈墙 Issue 附带 label；留空则只建不打标 */
  GITHUB_ISSUE_LABEL: z.string().default("feedback"),
  /** 单次调用 GitHub Issues API 的超时（毫秒） */
  GITHUB_ISSUE_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${detail}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache() {
  cached = null;
}

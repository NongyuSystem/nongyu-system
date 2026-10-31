/**
 * 验证码识别客户端：管理常驻 Python worker 子进程。
 *
 * 为什么是 Python 子进程而不是在 Node 里跑理由模型：
 * ddddocr 的 onnx 模型本身可以在 Node 侧跑通（onnxruntime-node 已验证，
 * 与 Python 输出逐值一致），但**图像预处理**（PIL 的 LANCZOS resize）与
 * libvips 实现有细微差异，同批样本 Node 侧 3/6、Python 侧 5/6。
 * 与其复刻 PIL 的重采样内核，不如直接把「已验证 5/6」的实现拉过来用。
 *
 * 部署要求：目标机装 Python 3 并 `pip install ddddocr pillow`；
 * 未安装时 `recognize()` 返回 null，上层自动降级为「让用户手输验证码」。
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createLogger, type Logger } from "../../../lib/logger.js";

/**
 * logger 惰性获取：createLogger 会触发 env 全量校验，
 * 而 OCR 模块应该在缺数据库配置时也能单独跑（脚本 / 测试）。
 */
let cachedLogger: Logger | null = null;
let loggerResolved = false;
function log(): Logger | null {
  if (!loggerResolved) {
    loggerResolved = true;
    try {
      cachedLogger = createLogger();
    } catch {
      cachedLogger = null;
    }
  }
  return cachedLogger;
}

/** worker 脚本路径：默认与本文件同目录；打包成单文件后可用环境变量指到部署目录 */
const WORKER_PATH =
  process.env.JIAOWU_OCR_WORKER?.trim() ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), "ocr", "worker.py");

/** 单次识别超时：worker 冷启动要加载模型，首张给足时间 */
const FIRST_TIMEOUT_MS = 30_000;
const TIMEOUT_MS = 8_000;

type Pending = {
  resolve: (value: string | null) => void;
  timer: NodeJS.Timeout;
};

let worker: ChildProcessWithoutNullStreams | null = null;
let pending: Pending | null = null;
let stdoutBuffer = "";
let started = false;
let unavailable = false;

/** 读取 worker 可执行路径：优先环境变量，其次 python3 / python */
function resolvePython(): string {
  return process.env.JIAOWU_OCR_PYTHON?.trim() || "python3";
}

function shutdown(reason: string): void {
  if (worker) {
    worker.removeAllListeners();
    worker.kill();
    worker = null;
  }
  if (pending) {
    clearTimeout(pending.timer);
    pending.resolve(null);
    pending = null;
  }
  stdoutBuffer = "";
  log()?.warn({ reason }, "jiaowu-ocr: worker 已停止");
}

function ensureWorker(): ChildProcessWithoutNullStreams | null {
  if (unavailable) return null;
  if (worker) return worker;

  try {
    const child = spawn(resolvePython(), [WORKER_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.on("error", (error) => {
      unavailable = true;
      shutdown(`spawn 失败: ${error.message}`);
    });
    child.on("exit", (code) => {
      if (code !== 0 && !unavailable) {
        // 非正常退出：下次调用时重新拉起
        shutdown(`worker 退出 code=${code}`);
      } else {
        worker = null;
      }
    });
    child.stderr.on("data", (chunk) => {
      log()?.debug({ chunk: chunk.toString().slice(0, 300) }, "jiaowu-ocr: stderr");
    });
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const newline = stdoutBuffer.indexOf("\n");
      if (newline === -1) return;
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(line.startsWith("ERR:") ? null : line);
        pending = null;
      }
    });
    worker = child;
    started = false;
    return child;
  } catch (error) {
    unavailable = true;
    log()?.error({ error }, "jiaowu-ocr: 无法启动 worker");
    return null;
  }
}

/**
 * 识别一张验证码。
 *
 * @param imageBase64 纯 base64（不含 `data:image/png;base64,` 前缀）
 * @returns 4 位数字；识别器不可用或超时返回 null（调用方应降级为手输）
 */
/** 串行链：worker 单进程，必须一个识别完再发下一个 */
let recognitionChain: Promise<unknown> = Promise.resolve();

/**
 * 识别一张验证码（并发调用会被排队串行执行）。
 *
 * 旧实现用「劫持 pending.resolve」来排队，并发 ≥2 时多个 Promise 会共享同一份
 * worker 输出，结果直接串位。这里改成标准的 Promise 链。
 *
 * @param imageBase64 纯 base64（不含 `data:image/png;base64,` 前缀）
 * @returns 4 位数字；识别器不可用或超时返回 null（调用方应降级为手输）
 */
export function recognizeCaptcha(imageBase64: string): Promise<string | null> {
  const task = recognitionChain.then(() => recognizeOnce(imageBase64));
  recognitionChain = task.catch(() => undefined);
  return task;
}

function recognizeOnce(imageBase64: string): Promise<string | null> {
  const child = ensureWorker();
  if (!child) return Promise.resolve(null);

  return new Promise((resolve) => {
    const timeout = started ? TIMEOUT_MS : FIRST_TIMEOUT_MS;
    started = true;
    const timer = setTimeout(() => {
      pending = null;
      shutdown("识别超时");
      resolve(null);
    }, timeout);
    pending = { resolve, timer };
    child.stdin.write(`${imageBase64}
`);
  });
}

/** 进程退出前释放 worker（测试与优雅关闭用） */
export function disposeOcrWorker(): void {
  shutdown("dispose");
  unavailable = false;
}

/**
 * 教务凭据托管表访问。
 *
 * 只有一张表、按 user_id 主键一对一；关闭托管直接删行，不留副本。
 */

import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "../../lib/db.js";

export type JiaowuCredentialRow = {
  user_id: number;
  student_no: string;
  password_cipher: string;
  enabled: 0 | 1;
  last_login_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};

const COLS = `user_id, student_no, password_cipher, enabled, last_login_at, last_error, created_at, updated_at`;

/** 写入或更新托管凭据（开启 / 更换密码都用它） */
export async function upsertCredential(input: {
  userId: number;
  studentNo: string;
  passwordCipher: string;
}): Promise<void> {
  await getPool().execute<ResultSetHeader>(
    `INSERT INTO jiaowu_credentials (user_id, student_no, password_cipher, enabled, last_error)
     VALUES (?, ?, ?, 1, NULL)
     ON DUPLICATE KEY UPDATE
       student_no = VALUES(student_no),
       password_cipher = VALUES(password_cipher),
       enabled = 1,
       last_error = NULL`,
    [input.userId, input.studentNo, input.passwordCipher],
  );
}

export async function findCredential(userId: number): Promise<JiaowuCredentialRow | null> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT ${COLS} FROM jiaowu_credentials WHERE user_id = ? LIMIT 1`,
    [userId],
  );
  return (rows[0] as JiaowuCredentialRow | undefined) ?? null;
}

export async function deleteCredential(userId: number): Promise<boolean> {
  const [result] = await getPool().execute<ResultSetHeader>(
    `DELETE FROM jiaowu_credentials WHERE user_id = ?`,
    [userId],
  );
  return result.affectedRows > 0;
}

/** 记录自动登录结果；失败原因截断到列宽，避免超长报错把写入打挂 */
export async function markLoginResult(
  userId: number,
  input: { ok: true } | { ok: false; error: string },
): Promise<void> {
  if (input.ok) {
    await getPool().execute<ResultSetHeader>(
      `UPDATE jiaowu_credentials SET last_login_at = CURRENT_TIMESTAMP(3), last_error = NULL WHERE user_id = ?`,
      [userId],
    );
    return;
  }
  await getPool().execute<ResultSetHeader>(
    `UPDATE jiaowu_credentials SET last_error = ? WHERE user_id = ?`,
    [input.error.slice(0, 250), userId],
  );
}

import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { getPool } from "../../lib/db.js";
import type { ScheduleRow, NoteRow, TodoRow, AttendanceRow } from "./mapper.js";

/**
 * 将 ISO 8601 / RFC 3339 日期字符串转为 MySQL DATETIME(3) 可接受的格式。
 * RN 端使用 new Date().toISOString() 产生 "2026-09-09T06:26:24.062Z"，
 * MySQL 8 DATETIME 需要 "2026-09-09 06:26:24.062"（空格 + 无 Z）。
 */
function toDbDatetime(iso: string): string {
  if (!iso) return iso;
  return iso
    .replace("T", " ")
    .replace("Z", "")
    .replace(/\+\d{2}:\d{2}$/, "");
}

// ===== Schedules =====

export async function listSchedules(userId: number): Promise<ScheduleRow[]> {
  const [rows] = await getPool().query<(ScheduleRow & RowDataPacket)[]>(
    `SELECT * FROM custom_schedules WHERE user_id = ? ORDER BY created_at ASC`,
    [userId],
  );
  return rows;
}

export async function insertSchedule(
  userId: number,
  data: {
    id: string;
    title: string;
    content: string;
    location: string;
    day: number;
    startPeriod: number;
    endPeriod: number;
    weeksListJson: string;
    colorIndex: number | null;
    createdAt: string;
    updatedAt: string;
  },
): Promise<void> {
  await getPool().query<ResultSetHeader>(
    `INSERT INTO custom_schedules
      (id, user_id, title, content, location, day, start_period, end_period, weeks_list, color_index, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.id,
      userId,
      data.title,
      data.content,
      data.location,
      data.day,
      data.startPeriod,
      data.endPeriod,
      data.weeksListJson,
      data.colorIndex,
      toDbDatetime(data.createdAt),
      toDbDatetime(data.updatedAt),
    ],
  );
}

export async function updateSchedule(
  userId: number,
  id: string,
  patch: {
    title?: string;
    content?: string;
    location?: string;
    day?: number;
    startPeriod?: number;
    endPeriod?: number;
    weeksListJson?: string;
    /** undefined = 不改；null = 清为无色 */
    colorIndex?: number | null;
    updatedAt: string;
  },
): Promise<boolean> {
  const sets: string[] = [];
  const args: unknown[] = [];
  const map: Record<string, unknown> = {
    title: patch.title,
    content: patch.content,
    location: patch.location,
    day: patch.day,
    start_period: patch.startPeriod,
    end_period: patch.endPeriod,
    weeks_list: patch.weeksListJson,
    color_index: patch.colorIndex,
  };
  for (const [col, val] of Object.entries(map)) {
    if (val !== undefined) {
      sets.push(`${col} = ?`);
      args.push(val);
    }
  }
  sets.push(`updated_at = ?`);
  args.push(toDbDatetime(patch.updatedAt), userId, id);
  const [res] = await getPool().query<ResultSetHeader>(
    `UPDATE custom_schedules SET ${sets.join(", ")} WHERE user_id = ? AND id = ?`,
    args,
  );
  return res.affectedRows > 0;
}

export async function deleteSchedule(userId: number, id: string): Promise<boolean> {
  const [res] = await getPool().query<ResultSetHeader>(
    `DELETE FROM custom_schedules WHERE user_id = ? AND id = ?`,
    [userId, id],
  );
  return res.affectedRows > 0;
}

// ===== Notes =====

export async function listNotes(userId: number, courseId?: string): Promise<NoteRow[]> {
  if (courseId) {
    const [rows] = await getPool().query<(NoteRow & RowDataPacket)[]>(
      `SELECT * FROM course_notes WHERE user_id = ? AND course_id = ? ORDER BY created_at ASC`,
      [userId, courseId],
    );
    return rows;
  }
  const [rows] = await getPool().query<(NoteRow & RowDataPacket)[]>(
    `SELECT * FROM course_notes WHERE user_id = ? ORDER BY created_at ASC`,
    [userId],
  );
  return rows;
}

export async function insertNote(
  userId: number,
  data: {
    id: string;
    courseId: string;
    content: string;
    createdAt: string;
    updatedAt: string;
  },
): Promise<void> {
  await getPool().query<ResultSetHeader>(
    `INSERT INTO course_notes (id, user_id, course_id, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      data.id,
      userId,
      data.courseId,
      data.content,
      toDbDatetime(data.createdAt),
      toDbDatetime(data.updatedAt),
    ],
  );
}

export async function updateNote(
  userId: number,
  id: string,
  patch: { content?: string; updatedAt: string },
): Promise<boolean> {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.content !== undefined) {
    sets.push(`content = ?`);
    args.push(patch.content);
  }
  sets.push(`updated_at = ?`);
  args.push(toDbDatetime(patch.updatedAt), userId, id);
  const [res] = await getPool().query<ResultSetHeader>(
    `UPDATE course_notes SET ${sets.join(", ")} WHERE user_id = ? AND id = ?`,
    args,
  );
  return res.affectedRows > 0;
}

export async function deleteNote(userId: number, id: string): Promise<boolean> {
  const [res] = await getPool().query<ResultSetHeader>(
    `DELETE FROM course_notes WHERE user_id = ? AND id = ?`,
    [userId, id],
  );
  return res.affectedRows > 0;
}

// ===== Todos =====

export async function listTodos(userId: number, courseId?: string): Promise<TodoRow[]> {
  if (courseId) {
    const [rows] = await getPool().query<(TodoRow & RowDataPacket)[]>(
      `SELECT * FROM course_todos WHERE user_id = ? AND course_id = ? ORDER BY created_at ASC`,
      [userId, courseId],
    );
    return rows;
  }
  const [rows] = await getPool().query<(TodoRow & RowDataPacket)[]>(
    `SELECT * FROM course_todos WHERE user_id = ? ORDER BY created_at ASC`,
    [userId],
  );
  return rows;
}

export async function insertTodo(
  userId: number,
  data: {
    id: string;
    courseId: string;
    content: string;
    status: string;
    dueDate: string | null;
    createdAt: string;
    completedAt: string | null;
    updatedAt: string;
  },
): Promise<void> {
  await getPool().query<ResultSetHeader>(
    `INSERT INTO course_todos
      (id, user_id, course_id, content, status, due_date, created_at, completed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.id,
      userId,
      data.courseId,
      data.content,
      data.status,
      data.dueDate,
      toDbDatetime(data.createdAt),
      data.completedAt ? toDbDatetime(data.completedAt) : data.completedAt,
      toDbDatetime(data.updatedAt),
    ],
  );
}

export async function updateTodo(
  userId: number,
  id: string,
  patch: {
    content?: string;
    status?: string;
    dueDate?: string | null;
    completedAt?: string | null;
    updatedAt: string;
  },
): Promise<boolean> {
  const sets: string[] = [];
  const args: unknown[] = [];
  const map: Record<string, unknown> = {
    content: patch.content,
    status: patch.status,
    due_date: patch.dueDate,
    completed_at: patch.completedAt,
  };
  for (const [col, val] of Object.entries(map)) {
    if (val !== undefined) {
      sets.push(`${col} = ?`);
      args.push(val);
    }
  }
  sets.push(`updated_at = ?`);
  args.push(toDbDatetime(patch.updatedAt), userId, id);
  const [res] = await getPool().query<ResultSetHeader>(
    `UPDATE course_todos SET ${sets.join(", ")} WHERE user_id = ? AND id = ?`,
    args,
  );
  return res.affectedRows > 0;
}

export async function deleteTodo(userId: number, id: string): Promise<boolean> {
  const [res] = await getPool().query<ResultSetHeader>(
    `DELETE FROM course_todos WHERE user_id = ? AND id = ?`,
    [userId, id],
  );
  return res.affectedRows > 0;
}

// ===== Attendances =====

export async function listAttendances(userId: number): Promise<AttendanceRow[]> {
  const [rows] = await getPool().query<(AttendanceRow & RowDataPacket)[]>(
    `SELECT * FROM course_attendances WHERE user_id = ? ORDER BY week ASC, day ASC, created_at ASC`,
    [userId],
  );
  return rows;
}

/**
 * 按 (user, course, week, day) upsert；唯一冲突时更新 status / updated_at，保留原 id
 */
export async function upsertAttendance(
  userId: number,
  data: {
    id: string;
    courseId: string;
    week: number;
    day: number;
    status: string;
    createdAt: string;
    updatedAt: string;
  },
): Promise<void> {
  await getPool().query<ResultSetHeader>(
    `INSERT INTO course_attendances
      (id, user_id, course_id, week, day, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       updated_at = VALUES(updated_at)`,
    [
      data.id,
      userId,
      data.courseId,
      data.week,
      data.day,
      data.status,
      toDbDatetime(data.createdAt),
      toDbDatetime(data.updatedAt),
    ],
  );
}

export async function updateAttendance(
  userId: number,
  id: string,
  patch: { status?: string; updatedAt: string },
): Promise<boolean> {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.status !== undefined) {
    sets.push(`status = ?`);
    args.push(patch.status);
  }
  sets.push(`updated_at = ?`);
  args.push(toDbDatetime(patch.updatedAt), userId, id);
  const [res] = await getPool().query<ResultSetHeader>(
    `UPDATE course_attendances SET ${sets.join(", ")} WHERE user_id = ? AND id = ?`,
    args,
  );
  return res.affectedRows > 0;
}

export async function deleteAttendance(userId: number, id: string): Promise<boolean> {
  const [res] = await getPool().query<ResultSetHeader>(
    `DELETE FROM course_attendances WHERE user_id = ? AND id = ?`,
    [userId, id],
  );
  return res.affectedRows > 0;
}

// ===== Tombstones =====

export type TombstoneEntity = "schedule" | "note" | "todo" | "attendance";

export type TombstoneRow = {
  entity: string;
  entity_id: string;
  deleted_at: Date;
};

const TOMBSTONE_RETENTION_DAYS = 30;

/**
 * upsert tombstone（删除传播）；同 (user, entity, entity_id) 更新 deleted_at
 */
export async function upsertTombstone(
  userId: number,
  entity: TombstoneEntity,
  entityId: string,
  deletedAt: string,
): Promise<void> {
  await getPool().query<ResultSetHeader>(
    `INSERT INTO course_ext_tombstones (user_id, entity, entity_id, deleted_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE deleted_at = VALUES(deleted_at)`,
    [userId, entity, entityId, toDbDatetime(deletedAt)],
  );
}

/**
 * 近 30 天 tombstone 列表
 */
export async function listTombstones(userId: number): Promise<TombstoneRow[]> {
  const [rows] = await getPool().query<(TombstoneRow & RowDataPacket)[]>(
    `SELECT entity, entity_id, deleted_at FROM course_ext_tombstones
     WHERE user_id = ?
       AND deleted_at >= (UTC_TIMESTAMP(3) - INTERVAL ? DAY)
     ORDER BY deleted_at DESC`,
    [userId, TOMBSTONE_RETENTION_DAYS],
  );
  return rows;
}

-- course-ext schema 补全迁移：幂等补齐 color_index、考勤 nocheck、tombstone attendance
-- 用于修复因 007/008 等迁移未在生产执行导致的 course-ext 写入 500
-- charset: utf8mb4 / engine: InnoDB

-- 1. custom_schedules.color_index（007_schedule_color_index.sql 的幂等版本）
SET @add_color_index = (
  SELECT COUNT(*) = 0
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'custom_schedules'
    AND column_name = 'color_index'
);
SET @sql = IF(@add_color_index,
  'ALTER TABLE custom_schedules ADD COLUMN color_index TINYINT NULL AFTER weeks_list, ADD CONSTRAINT chk_schedules_color_index CHECK (color_index IS NULL OR (color_index BETWEEN 0 AND 7))',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. course_attendances.status 扩展 nocheck（008_attendance_nocheck.sql 的幂等版本）
SET @drop_chk = (
  SELECT COUNT(*) > 0
  FROM information_schema.table_constraints
  WHERE table_schema = DATABASE()
    AND table_name = 'course_attendances'
    AND constraint_name = 'chk_att_status'
);
SET @drop_sql = IF(@drop_chk, 'ALTER TABLE course_attendances DROP CHECK chk_att_status', 'SELECT 1');
PREPARE stmt FROM @drop_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE course_attendances
  ADD CONSTRAINT chk_att_status
  CHECK (status IN ('present', 'late', 'absent', 'leave', 'nocheck'));

-- 3. course_ext_tombstones.entity 扩展 attendance（005_course_attendances.sql 后半的幂等版本）
SET @drop_tomb_chk = (
  SELECT COUNT(*) > 0
  FROM information_schema.table_constraints
  WHERE table_schema = DATABASE()
    AND table_name = 'course_ext_tombstones'
    AND constraint_name = 'chk_tombstones_entity'
);
SET @drop_tomb_sql = IF(@drop_tomb_chk, 'ALTER TABLE course_ext_tombstones DROP CHECK chk_tombstones_entity', 'SELECT 1');
PREPARE stmt FROM @drop_tomb_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE course_ext_tombstones
  ADD CONSTRAINT chk_tombstones_entity
  CHECK (entity IN ('schedule', 'note', 'todo', 'attendance'));

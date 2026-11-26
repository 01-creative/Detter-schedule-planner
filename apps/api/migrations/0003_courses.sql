-- 0003 · 课程（Course / Assessment / Assignment）
--
-- 设计沿用 0001 的「payload JSON 为唯一事实 + 少量投影列做索引」结构：
--   1) 三张表都带 user_id / rev / deleted_at / updated_at / device_id，直接接入同步协议；
--   2) 投影列只服务于 SQL 过滤（课程是否归档、某课有哪些考核项/作业、某周的作业）；
--   3) 课程与 Task 的关系在**应用层**维护（Task.goalId / 课程维度靠 tags、考核项的 taskId 回指），
--      不建外键：同步场景下删除是墓碑，外键只会阻碍乱序应用（见 01-DATA-MODEL §2）。

/* ------------------------------------------------------------------ 课程 */

CREATE TABLE IF NOT EXISTS courses (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  rev         INTEGER NOT NULL DEFAULT 0,
  deleted_at  INTEGER,
  updated_at  INTEGER NOT NULL,
  device_id   TEXT NOT NULL DEFAULT '',
  -- 0/1：归档的课不出现在默认列表与遗漏判定里
  archived    INTEGER NOT NULL DEFAULT 0,
  goal_id     TEXT,
  payload     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_courses_alive ON courses(user_id, deleted_at, archived);
CREATE INDEX IF NOT EXISTS idx_courses_goal  ON courses(user_id, goal_id);

/* ---------------------------------------------------------------- 考核构成 */

CREATE TABLE IF NOT EXISTS assessments (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  rev         INTEGER NOT NULL DEFAULT 0,
  deleted_at  INTEGER,
  updated_at  INTEGER NOT NULL,
  device_id   TEXT NOT NULL DEFAULT '',
  course_id   TEXT NOT NULL,
  status      TEXT NOT NULL,
  kind        TEXT NOT NULL,
  due_at      INTEGER,
  payload     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assessments_course ON assessments(user_id, course_id, due_at);
CREATE INDEX IF NOT EXISTS idx_assessments_alive  ON assessments(user_id, deleted_at, status);

/* ---------------------------------------------------------------- 每周作业 */

CREATE TABLE IF NOT EXISTS assignments (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  rev         INTEGER NOT NULL DEFAULT 0,
  deleted_at  INTEGER,
  updated_at  INTEGER NOT NULL,
  device_id   TEXT NOT NULL DEFAULT '',
  course_id   TEXT NOT NULL,
  week_no     INTEGER NOT NULL,
  status      TEXT NOT NULL,
  due_at      INTEGER,
  payload     TEXT NOT NULL
);
-- 同一周同一门课可以有多条作业（作业一/作业二），所以只建普通索引
CREATE INDEX IF NOT EXISTS idx_assignments_week  ON assignments(user_id, course_id, week_no);
CREATE INDEX IF NOT EXISTS idx_assignments_alive ON assignments(user_id, deleted_at, status);

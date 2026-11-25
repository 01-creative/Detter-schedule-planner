-- Detter 初始数据库结构（SQLite / Cloudflare D1 双兼容）
--
-- 设计要点：
-- 1) 单用户产品，但所有表都带 user_id，未来若要多用户不需要重构；
-- 2) 同步实体采用「payload JSON 为唯一事实 + 少量投影列做索引」的混合结构：
--    payload 由 zod schema 校验，投影列只用于 SQL 层过滤/排序，写库时从 payload 派生；
-- 3) 删除一律软删除（deleted_at），changes 表记录墓碑，保证离线设备最终一致；
-- 4) changes.seq 单调递增，是客户端增量拉取的游标。

PRAGMA journal_mode = WAL;

/* ------------------------------------------------------------------ 账户 */

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  display_name   TEXT NOT NULL DEFAULT '',
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  iterations     INTEGER NOT NULL DEFAULT 310000,
  timezone       TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  device_id     TEXT NOT NULL,
  user_agent    TEXT NOT NULL DEFAULT '',
  ip            TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  revoked_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS devices (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL,
  name               TEXT NOT NULL,
  platform           TEXT NOT NULL DEFAULT 'web',
  created_at         INTEGER NOT NULL,
  last_seen_at       INTEGER,
  push_subscription  TEXT,
  push_enabled       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  scopes       TEXT NOT NULL DEFAULT '["read"]',
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  expires_at   INTEGER,
  revoked_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

/* -------------------------------------------------------------- 同步实体 */

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  rev           INTEGER NOT NULL DEFAULT 0,
  deleted_at    INTEGER,
  updated_at    INTEGER NOT NULL,
  device_id     TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL,
  quadrant      INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  goal_id       TEXT,
  start_at      INTEGER,
  due_at        INTEGER,
  completed_at  INTEGER,
  payload       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_alive   ON tasks(user_id, deleted_at, status);
CREATE INDEX IF NOT EXISTS idx_tasks_start   ON tasks(user_id, start_at);
CREATE INDEX IF NOT EXISTS idx_tasks_due     ON tasks(user_id, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_goal    ON tasks(user_id, goal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(user_id, updated_at);

CREATE TABLE IF NOT EXISTS goals (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  rev         INTEGER NOT NULL DEFAULT 0,
  deleted_at  INTEGER,
  updated_at  INTEGER NOT NULL,
  device_id   TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL,
  kind        TEXT NOT NULL,
  sort_index  INTEGER NOT NULL DEFAULT 0,
  payload     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goals_alive ON goals(user_id, deleted_at, status);

CREATE TABLE IF NOT EXISTS inbox_items (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  rev         INTEGER NOT NULL DEFAULT 0,
  deleted_at  INTEGER,
  updated_at  INTEGER NOT NULL,
  device_id   TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  payload     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_alive ON inbox_items(user_id, deleted_at, status, captured_at);

CREATE TABLE IF NOT EXISTS okrs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  rev          INTEGER NOT NULL DEFAULT 0,
  deleted_at   INTEGER,
  updated_at   INTEGER NOT NULL,
  device_id    TEXT NOT NULL DEFAULT '',
  period       TEXT NOT NULL,
  period_start TEXT NOT NULL,
  status       TEXT NOT NULL,
  payload      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_okrs_period ON okrs(user_id, deleted_at, period, period_start);

CREATE TABLE IF NOT EXISTS key_results (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  rev         INTEGER NOT NULL DEFAULT 0,
  deleted_at  INTEGER,
  updated_at  INTEGER NOT NULL,
  device_id   TEXT NOT NULL DEFAULT '',
  okr_id      TEXT NOT NULL,
  payload     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kr_okr ON key_results(user_id, okr_id);

CREATE TABLE IF NOT EXISTS kpis (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  rev         INTEGER NOT NULL DEFAULT 0,
  deleted_at  INTEGER,
  updated_at  INTEGER NOT NULL,
  device_id   TEXT NOT NULL DEFAULT '',
  sort_index  INTEGER NOT NULL DEFAULT 0,
  payload     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kpis_alive ON kpis(user_id, deleted_at, sort_index);

CREATE TABLE IF NOT EXISTS kpi_entries (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  rev         INTEGER NOT NULL DEFAULT 0,
  deleted_at  INTEGER,
  updated_at  INTEGER NOT NULL,
  device_id   TEXT NOT NULL DEFAULT '',
  kpi_id      TEXT NOT NULL,
  date        TEXT NOT NULL,
  payload     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kpi_entries ON kpi_entries(user_id, kpi_id, date);

CREATE TABLE IF NOT EXISTS pomodoro_sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  rev         INTEGER NOT NULL DEFAULT 0,
  deleted_at  INTEGER,
  updated_at  INTEGER NOT NULL,
  device_id   TEXT NOT NULL DEFAULT '',
  task_id     TEXT,
  started_at  INTEGER NOT NULL,
  payload     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pomodoro_start ON pomodoro_sessions(user_id, started_at);

CREATE TABLE IF NOT EXISTS mind_maps (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  rev         INTEGER NOT NULL DEFAULT 0,
  deleted_at  INTEGER,
  updated_at  INTEGER NOT NULL,
  device_id   TEXT NOT NULL DEFAULT '',
  goal_id     TEXT,
  payload     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mind_nodes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  rev         INTEGER NOT NULL DEFAULT 0,
  deleted_at  INTEGER,
  updated_at  INTEGER NOT NULL,
  device_id   TEXT NOT NULL DEFAULT '',
  map_id      TEXT NOT NULL,
  parent_id   TEXT,
  payload     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mind_nodes_map ON mind_nodes(user_id, map_id);

CREATE TABLE IF NOT EXISTS settings (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  rev         INTEGER NOT NULL DEFAULT 0,
  deleted_at  INTEGER,
  updated_at  INTEGER NOT NULL,
  device_id   TEXT NOT NULL DEFAULT '',
  key         TEXT NOT NULL,
  payload     TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key ON settings(user_id, key);

/* --------------------------------------------------------- 同步日志 / 幂等 */

CREATE TABLE IF NOT EXISTS changes (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  rev        INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  payload    TEXT,
  at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_changes_user_seq ON changes(user_id, seq);

-- 幂等表：同一个 opId 重复提交只应用一次
CREATE TABLE IF NOT EXISTS op_log (
  op_id   TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  rev     INTEGER NOT NULL DEFAULT 0,
  seq     INTEGER,
  at      INTEGER NOT NULL
);

/* ------------------------------------------------------------ 提醒 / 审计 */

CREATE TABLE IF NOT EXISTS reminders (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  task_id    TEXT NOT NULL,
  fire_at    INTEGER NOT NULL,
  channel    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  attempts   INTEGER NOT NULL DEFAULT 0,
  sent_at    INTEGER,
  error      TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, fire_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL,
  actor     TEXT NOT NULL,
  action    TEXT NOT NULL,
  entity    TEXT,
  entity_id TEXT,
  ip        TEXT NOT NULL DEFAULT '',
  meta      TEXT,
  at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(user_id, at);

-- 登录失败限流（按 IP 计数），D1 也能扛单用户场景
CREATE TABLE IF NOT EXISTS login_attempts (
  id         TEXT PRIMARY KEY,
  ip         TEXT NOT NULL,
  at         INTEGER NOT NULL,
  success    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_login_ip ON login_attempts(ip, at);

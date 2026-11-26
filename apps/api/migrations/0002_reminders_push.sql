-- T14 · 提醒与推送
--
-- 0001 已经建好 reminders 表与 devices.push_subscription，这里只做增量：
--   1) 幂等唯一键 —— 同一 task + fireAt + channel 只允许一行，是「不重复推送」的
--      **数据库级**保证（应用层的先查后插在并发 tick 下会漏）；
--   2) notifications —— inapp 渠道的收件箱，前端据此做红点/轮询；
--   3) 索引 —— 调度只按 (status, fire_at) 扫，通知只按 (user_id, read_at) 扫。
--
-- 注意：不能用 CREATE TABLE ... IF NOT EXISTS 之外的 DDL 假设 D1 与 node:sqlite 完全一致；
-- 这里只用两者都支持的语法（普通索引 + 部分索引 + 普通表）。

/* --------------------------------------------------------------- 幂等键 */

-- 部分唯一索引：task_id/fire_at/channel 三元组唯一。
-- 「部分」是因为 cancelled 行也占位：保留历史行，重复插入走 ON CONFLICT DO UPDATE 复活。
CREATE UNIQUE INDEX IF NOT EXISTS uq_reminders_task_fire_channel
  ON reminders(task_id, fire_at, channel);

CREATE INDEX IF NOT EXISTS idx_reminders_task
  ON reminders(user_id, task_id, fire_at);

/* ------------------------------------------------------------ inapp 收件箱 */

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  -- 由哪条 reminder 产生；唯一，保证同一个提醒点最多一条通知
  reminder_id TEXT,
  task_id     TEXT,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',
  channel     TEXT NOT NULL DEFAULT 'inapp',
  read_at     INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_reminder
  ON notifications(reminder_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(user_id, read_at, created_at);

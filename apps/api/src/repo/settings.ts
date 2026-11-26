import type { Db } from "../db/types";
import { uuidv7 } from "../lib/ids";
import {
  createEntity,
  getEntityRow,
  insertEntityStatement,
  parseEntity,
  updateEntity,
  updateEntityStatement,
} from "./crud";

/**
 * 设置的读写仓储。
 *
 * 设置对外是 `Record<string, unknown>`，对内仍然是 setting 实体（一行一个 key）：
 * 这样设置也能跨设备同步、离线改，不需要另发明一套机制。
 *
 * 单独抽成仓储而不是留在路由里，是因为提醒/推送服务也要读写设置——
 * 服务层直接复用同一套「同名 key 复活墓碑」的语义，避免两处实现跑偏。
 */

export interface SettingRow {
  id: string;
  key: string;
  payload: string;
}

/** 一旦出现就绝不能被 GET /settings 原样回显的 key（只返回「已配置」信号）。 */
export const SECRET_SETTING_KEYS: ReadonlySet<string> = new Set([
  "wechat.token",
  "reminders.calendarToken",
]);

/** 掩码值：不是空串，前端据此判断「已配置」。 */
export const SECRET_MASK = "••••••••";

export function isSecretSetting(key: string): boolean {
  return SECRET_SETTING_KEYS.has(key);
}

export function maskSettingValue(key: string, value: unknown): unknown {
  if (!isSecretSetting(key)) return value;
  return typeof value === "string" && value.length > 0 ? SECRET_MASK : null;
}

/** 读全部设置（未掩码）。调用方若是对外响应，必须先过一层 maskSettingValue。 */
export async function readSettings(db: Db, userId: string): Promise<Record<string, unknown>> {
  const rows = await db.all<SettingRow>(
    "SELECT id, key, payload FROM settings WHERE user_id = ? AND deleted_at IS NULL ORDER BY key ASC",
    [userId],
  );

  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload) as { key?: unknown; value?: unknown };
      if (typeof payload.key === "string") settings[payload.key] = payload.value ?? null;
    } catch {
      // 损坏的行不应让整个设置接口 500：跳过它，其余设置照常返回
    }
  }
  return settings;
}

/** 只读指定 key（服务层用，避免把微信 token 这类大对象反复解析）。 */
export async function readSettingValues(
  db: Db,
  userId: string,
  keys: readonly string[],
): Promise<Record<string, unknown>> {
  if (keys.length === 0) return {};
  const placeholders = keys.map(() => "?").join(", ");
  const rows = await db.all<SettingRow>(
    `SELECT id, key, payload FROM settings WHERE user_id = ? AND deleted_at IS NULL AND key IN (${placeholders})`,
    [userId, ...keys],
  );

  const values: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload) as { value?: unknown };
      values[row.key] = payload.value ?? null;
    } catch {
      values[row.key] = null;
    }
  }
  return values;
}

export interface WriteSettingsOptions {
  deviceId?: string;
}

/**
 * 密钥类设置的写入：只落表，**不写 changes 日志**。
 *
 * 为什么：changes 会被所有 read scope 的客户端/API Key 拉走；把微信 token、日历订阅 token
 * 放进同步日志等于给它们开了第二条泄露路径。设置页本来就走 GET /reminders/config 读状态
 * （只拿 wechatConfigured 布尔），不需要把这些值同步到设备。
 * 代价：换设备后要重新填一次 token——对密钥来说这是正确取舍。
 */
async function writeSecretSetting(
  db: Db,
  userId: string,
  key: string,
  value: unknown,
  now: number,
  deviceId: string,
): Promise<void> {
  const existing = await db.first<{ id: string }>(
    "SELECT id FROM settings WHERE user_id = ? AND key = ?",
    [userId, key],
  );

  if (!existing) {
    const payload = parseEntity("setting", {
      id: uuidv7(now),
      key,
      value,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      rev: 1,
      deviceId,
    });
    const statement = insertEntityStatement("setting", userId, payload);
    await db.run(statement.sql, statement.params ?? []);
    return;
  }

  const row = await getEntityRow(db, "setting", userId, existing.id);
  if (!row) return;
  const current = JSON.parse(row.payload) as Record<string, unknown>;
  const next = parseEntity("setting", {
    ...current,
    key,
    value,
    createdAt: current.createdAt ?? now,
    updatedAt: now,
    deletedAt: null,
    rev: Number(row.rev) + 1,
    deviceId: row.device_id,
  });
  const statement = updateEntityStatement("setting", userId, next);
  await db.run(statement.sql, statement.params ?? []);
}

/**
 * 批量 upsert。
 *
 * 与 routes/settings.ts 原来逐条执行的语义完全一致：
 * 存在的 key 走 update（includeDeleted：同名 key 曾被软删也要复活），不存在的走 create。
 * 返回真正写入的条目数。
 */
export async function writeSettings(
  db: Db,
  userId: string,
  values: Record<string, unknown>,
  now: number,
  options: WriteSettingsOptions = {},
): Promise<number> {
  const entries = Object.entries(values);
  if (entries.length > 200) {
    throw new Error("一次最多写入 200 个设置项");
  }

  for (const [key, value] of entries) {
    if (isSecretSetting(key)) {
      await writeSecretSetting(db, userId, key, value, now, options.deviceId ?? "");
      continue;
    }

    const existing = await db.first<{ id: string }>(
      "SELECT id FROM settings WHERE user_id = ? AND key = ?",
      [userId, key],
    );

    if (existing) {
      await updateEntity(db, "setting", userId, existing.id, { key, value }, now, {
        includeDeleted: true,
      });
    } else {
      await createEntity(db, "setting", userId, {
        input: { key, value },
        deviceId: options.deviceId ?? "",
        now,
      });
    }
  }

  return entries.length;
}

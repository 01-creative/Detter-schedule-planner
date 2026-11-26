import { ENTITY_NAMES, ENTITY_TABLES } from "@detter/shared";
import type { ChangeRow, EntityName, SyncPullResponse, SyncSnapshotResponse } from "@detter/shared";
import type { Db } from "../db/types";
import { isSecretSetting } from "../repo/settings";

/**
 * 同步读取路径。
 *
 * pull 只查 changes 一张表（协议明确要求，不得 join 实体表）：
 * changes 是追加日志，payload 已经存了写入时的完整快照，join 只会更慢。
 *
 * T14 起：密钥类设置（微信 token / 日历订阅 token）不进入同步面——
 * snapshot 与 pull 都过滤掉，避免 read scope 的 API Key 顺手把密钥拉走。
 * 设置页读的是 /reminders/config（只回布尔），不依赖同步。
 */

interface ChangeDbRow {
  seq: number;
  entity: string;
  entity_id: string;
  rev: number;
  deleted: number;
  payload: string | null;
  at: number;
}

function isSecretSettingPayload(entity: EntityName, payload: unknown): boolean {
  if (entity !== "setting" || typeof payload !== "object" || payload === null) return false;
  const key = (payload as { key?: unknown }).key;
  return typeof key === "string" && isSecretSetting(key);
}

export async function currentCursor(db: Db, userId: string): Promise<number> {
  const row = await db.first<{ seq: number | null }>(
    "SELECT MAX(seq) AS seq FROM changes WHERE user_id = ?",
    [userId],
  );
  return Number(row?.seq ?? 0);
}

export async function pullChanges(
  db: Db,
  userId: string,
  cursor: number,
  limit: number,
): Promise<SyncPullResponse> {
  const rows = await db.all<ChangeDbRow>(
    `SELECT seq, entity, entity_id, rev, deleted, payload, at
       FROM changes
      WHERE user_id = ? AND seq > ?
      ORDER BY seq ASC
      LIMIT ?`,
    [userId, cursor, limit],
  );

  const changes: ChangeRow[] = rows
    .map((row) => ({
      seq: Number(row.seq),
      entity: row.entity as EntityName,
      entityId: row.entity_id,
      rev: Number(row.rev),
      deleted: Number(row.deleted) === 1,
      payload: row.payload === null ? null : (JSON.parse(row.payload) as unknown),
      at: Number(row.at),
    }))
    // 密钥设置：即使历史 changes 里有，也不再交给客户端
    .filter((change) => change.deleted || !isSecretSettingPayload(change.entity, change.payload));

  // cursor 必须来自原始行：过滤掉的行也要推进游标，否则每次 pull 都会重读它们
  const lastRow = rows[rows.length - 1];
  return {
    changes,
    cursor: lastRow ? Number(lastRow.seq) : cursor,
    // 协议约定：取满 limit 即认为可能还有
    hasMore: rows.length === limit,
  };
}

/** 全量快照：换设备 / cursor 落后太多时用，只取存活行。 */
export async function snapshotAll(db: Db, userId: string, now: number): Promise<SyncSnapshotResponse> {
  const entities = {} as Record<EntityName, unknown[]>;

  for (const entity of ENTITY_NAMES) {
    const rows = await db.all<{ payload: string }>(
      `SELECT payload FROM ${ENTITY_TABLES[entity]} WHERE user_id = ? AND deleted_at IS NULL`,
      [userId],
    );
    entities[entity] = rows
      .map((row) => JSON.parse(row.payload) as unknown)
      .filter((payload) => !isSecretSettingPayload(entity, payload));
  }

  return { entities, cursor: await currentCursor(db, userId), generatedAt: now };
}

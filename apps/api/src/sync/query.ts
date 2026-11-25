import { ENTITY_NAMES, ENTITY_TABLES } from "@detter/shared";
import type { ChangeRow, EntityName, SyncPullResponse, SyncSnapshotResponse } from "@detter/shared";
import type { Db } from "../db/types";

/**
 * 同步读取路径。
 *
 * pull 只查 changes 一张表（协议明确要求，不得 join 实体表）：
 * changes 是追加日志，payload 已经存了写入时的完整快照，join 只会更慢。
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

  const changes: ChangeRow[] = rows.map((row) => ({
    seq: Number(row.seq),
    entity: row.entity as EntityName,
    entityId: row.entity_id,
    rev: Number(row.rev),
    deleted: Number(row.deleted) === 1,
    payload: row.payload === null ? null : (JSON.parse(row.payload) as unknown),
    at: Number(row.at),
  }));

  const last = changes[changes.length - 1];
  return {
    changes,
    cursor: last ? last.seq : cursor,
    // 协议约定：取满 limit 即认为可能还有
    hasMore: changes.length === limit,
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
    entities[entity] = rows.map((row) => JSON.parse(row.payload) as unknown);
  }

  return { entities, cursor: await currentCursor(db, userId), generatedAt: now };
}

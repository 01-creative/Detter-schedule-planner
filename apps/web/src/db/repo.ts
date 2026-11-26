import type { Table } from "dexie";
import {
  ENTITY_SCHEMAS,
  uuidv7,
  type CaptureSource,
  type EntityName,
  type InboxItem,
  type ParsedDraft,
} from "@detter/shared";
import { getDeviceId } from "@/lib/device";
import { db } from "./index";

/**
 * 实体读写。
 *
 * 铁律（任务书 §4.4）：任何写操作都必须
 *   1) 用 @detter/shared 的 schema 补齐默认值，保证本地数据永远合法；
 *   2) 维护 updatedAt / rev / deviceId；
 *   3) 在同一个事务里写实体 + 追加 outbox；
 *   4) 通知同步客户端排一次推送。
 *
 * 第 3 点是为了原子性：如果实体写成功、outbox 写失败，这条修改就永远不会被同步出去，
 * 而且是「看起来保存成功了」的那种丢数据，最难排查。
 */

export interface EntityRow {
  id: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  rev: number;
  deviceId: string;
  [key: string]: unknown;
}

/** 本地表名。刻意与服务端表名解耦：同步协议用 entity 名，不用表名。 */
const LOCAL_TABLE: Record<EntityName, string> = {
  task: "tasks",
  goal: "goals",
  inbox: "inbox",
  okr: "okrs",
  kr: "keyResults",
  kpi: "kpis",
  kpiEntry: "kpiEntries",
  pomodoro: "pomodoroSessions",
  mindMap: "mindMaps",
  mindNode: "mindNodes",
  course: "courses",
  assessment: "assessments",
  assignment: "assignments",
  setting: "settings",
};

function tableFor(entity: EntityName): Table<EntityRow, string> {
  const tables = db as unknown as Record<string, Table<EntityRow, string>>;
  return tables[LOCAL_TABLE[entity]]!;
}

/* -------------------------------------------------------------------------- */
/*                              本地写入订阅（防循环依赖）                       */
/* -------------------------------------------------------------------------- */

type WriteListener = () => void;
const writeListeners = new Set<WriteListener>();

/**
 * 同步客户端通过它感知「有本地写入」，从而排一次防抖推送。
 * 反向依赖（repo → sync）会形成循环 import，这里用订阅把方向掰直。
 */
export function onLocalWrite(listener: WriteListener): () => void {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

function notifyLocalWrite(): void {
  for (const listener of writeListeners) {
    try {
      listener();
    } catch {
      // 监听方自己的异常不能影响写入事务的结果
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                                   写入                                      */
/* -------------------------------------------------------------------------- */

export interface WriteOptions {
  /** 从服务器拉下来的变更不产生 outbox，否则会把别人的修改再推回去 */
  skipOutbox?: boolean;
}

export async function saveEntity(
  entity: EntityName,
  input: Record<string, unknown>,
  options: WriteOptions = {},
): Promise<EntityRow> {
  const now = Date.now();
  const id = typeof input.id === "string" && input.id.length > 0 ? input.id : uuidv7(now);
  const table = tableFor(entity);

  const row = await db.transaction("rw", table, db.outbox, async () => {
    const existing = await table.get(id);
    const raw: Record<string, unknown> = {
      ...input,
      id,
      createdAt: existing?.createdAt ?? (typeof input.createdAt === "number" ? input.createdAt : now),
      updatedAt: now,
      deletedAt: null,
      // rev 只能由服务端推进；本地沿用已知值，否则下一次推送必然被判冲突
      rev: existing?.rev ?? 0,
      deviceId: getDeviceId(),
    };

    const parsed = ENTITY_SCHEMAS[entity].parse(raw) as EntityRow;
    await table.put(parsed);

    if (!options.skipOutbox) {
      await db.outbox.add({
        opId: uuidv7(now),
        entity,
        entityId: id,
        op: "upsert",
        baseRev: parsed.rev,
        at: now,
        payload: parsed,
        attempts: 0,
      });
    }

    return parsed;
  });

  if (!options.skipOutbox) notifyLocalWrite();
  return row;
}

/** 软删除：写墓碑而不是物理删除，离线设备才能收到「这条没了」。 */
export async function deleteEntity(entity: EntityName, id: string): Promise<boolean> {
  const now = Date.now();
  const table = tableFor(entity);

  const changed = await db.transaction("rw", table, db.outbox, async () => {
    const existing = await table.get(id);
    if (!existing) return false;
    const tombstone: EntityRow = {
      ...existing,
      deletedAt: now,
      updatedAt: now,
      deviceId: getDeviceId(),
    };
    await table.put(tombstone);
    await db.outbox.add({
      opId: uuidv7(now),
      entity,
      entityId: id,
      op: "delete",
      baseRev: tombstone.rev,
      at: now,
      attempts: 0,
    });
    return true;
  });

  if (changed) notifyLocalWrite();
  return changed;
}

/* -------------------------------------------------------------------------- */
/*                                 领域便捷方法                                 */
/* -------------------------------------------------------------------------- */

export interface CaptureInput {
  rawText: string;
  parsed?: ParsedDraft | null;
  source?: CaptureSource;
}

/** 快速捕获 → 收件箱。离线时同样可用，因为只写本地。 */
export async function captureInbox({
  rawText,
  parsed = null,
  source = "hotkey",
}: CaptureInput): Promise<InboxItem> {
  const row = await saveEntity("inbox", {
    rawText,
    parsed,
    source,
    status: "pending",
    taskId: null,
    capturedAt: Date.now(),
  });
  return row as unknown as InboxItem;
}

/** 收件箱分诊成功后标记状态（T05 会用到；这里先保证接口存在）。 */
export async function markInboxTriaged(id: string, taskId: string): Promise<void> {
  const existing = await db.inbox.get(id);
  if (!existing) return;
  await saveEntity("inbox", { ...existing, status: "triaged", taskId });
}

/* -------------------------------------------------------------------------- */
/*                          服务器变更落本地（不产生 outbox）                    */
/* -------------------------------------------------------------------------- */

export async function applyRemoteEntity(entity: EntityName, payload: unknown): Promise<void> {
  const parsed = ENTITY_SCHEMAS[entity].parse(payload) as EntityRow;
  await tableFor(entity).put(parsed);
}

export async function removeLocalEntity(entity: EntityName, id: string): Promise<void> {
  await tableFor(entity).delete(id);
}

export async function getEntity(entity: EntityName, id: string): Promise<EntityRow | undefined> {
  return tableFor(entity).get(id);
}

/** 推送成功（applied / duplicate）后把服务端 rev 写回本地，作为下一次的 baseRev。 */
export async function updateEntityRev(entity: EntityName, id: string, rev: number): Promise<void> {
  const table = tableFor(entity);
  await table.update(id, { rev } as Partial<EntityRow>);
}

/** 服务器墓碑且没有 payload 时，直接把本地行删掉。 */
export async function purgeEntity(entity: EntityName, id: string): Promise<void> {
  await removeLocalEntity(entity, id);
}

export async function countEntities(entity: EntityName): Promise<number> {
  const rows = await tableFor(entity).toArray();
  return rows.filter((row) => !row.deletedAt).length;
}

export async function hasPendingOp(entity: EntityName, entityId: string): Promise<boolean> {
  const count = await db.outbox.where("entityId").equals(entityId).count();
  if (count === 0) return false;
  const ops = await db.outbox.where("entityId").equals(entityId).toArray();
  return ops.some((op) => op.entity === entity);
}

export { LOCAL_TABLE };

import { z } from "zod";
import { ENTITY_NAMES, type EntityName } from "./entities.ts";

/**
 * 同步协议 v1（本地优先 / 离线优先）。
 *
 * 心智模型：
 *   客户端是"副本"，本地库随时可读可写；改动先进 outbox，联网后按 op 批量推给服务端。
 *   服务端是"日志"，每次写入追加一条 changes(seq)，其它设备按 cursor 增量拉取。
 *
 * 冲突策略：
 *   - 每个实体有单调递增的 rev；
 *   - 客户端推送时带上它看到的 baseRev；
 *   - baseRev === 服务端 rev  → 正常应用，rev+1；
 *   - baseRev <  服务端 rev  → 冲突，服务端返回权威版本，客户端做 LWW（updatedAt 大者胜，
 *                              相同则 deviceId 字典序大者胜）后以新的 baseRev 重推。
 *   选择「实体级 LWW」而非 CRDT：单人、单实体粒度、字段冲突概率极低，
 *   换来的是可解释、可审计、实现简单。
 */

export const SyncOpSchema = z.object({
  /** 客户端生成的幂等 ID（uuidv7），服务端去重 */
  opId: z.string().min(1),
  entity: z.enum(ENTITY_NAMES),
  op: z.enum(["upsert", "delete"]),
  id: z.string().min(1),
  /** 客户端修改时看到的版本号；新建传 0 */
  baseRev: z.number().int().nonnegative().default(0),
  /** 客户端本地时间戳 */
  at: z.number().int().nonnegative(),
  /** upsert 时的实体快照（delete 时省略） */
  payload: z.unknown().optional(),
});
export type SyncOp = z.infer<typeof SyncOpSchema>;

export const SyncPushRequestSchema = z.object({
  deviceId: z.string().min(1),
  ops: z.array(SyncOpSchema).max(500),
});
export type SyncPushRequest = z.infer<typeof SyncPushRequestSchema>;

export const SyncOpResultSchema = z.object({
  opId: z.string(),
  status: z.enum(["applied", "conflict", "error", "duplicate"]),
  rev: z.number().int().nonnegative().optional(),
  seq: z.number().int().nonnegative().optional(),
  /** 冲突时返回服务端权威版本（delete 时为 null） */
  server: z.unknown().nullable().optional(),
  error: z.string().optional(),
});
export type SyncOpResult = z.infer<typeof SyncOpResultSchema>;

export const SyncPushResponseSchema = z.object({
  results: z.array(SyncOpResultSchema),
  /** 推送同时返回最新 cursor，客户端可顺手拉取 */
  cursor: z.number().int().nonnegative(),
});
export type SyncPushResponse = z.infer<typeof SyncPushResponseSchema>;

export const ChangeRowSchema = z.object({
  seq: z.number().int().nonnegative(),
  entity: z.enum(ENTITY_NAMES),
  entityId: z.string(),
  rev: z.number().int().nonnegative(),
  deleted: z.boolean(),
  payload: z.unknown().nullable(),
  at: z.number().int().nonnegative(),
});
export type ChangeRow = z.infer<typeof ChangeRowSchema>;

export const SyncPullQuerySchema = z.object({
  cursor: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type SyncPullQuery = z.infer<typeof SyncPullQuerySchema>;

export const SyncPullResponseSchema = z.object({
  changes: z.array(ChangeRowSchema),
  cursor: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type SyncPullResponse = z.infer<typeof SyncPullResponseSchema>;

export const SyncSnapshotResponseSchema = z.object({
  entities: z.record(z.enum(ENTITY_NAMES), z.array(z.unknown())),
  cursor: z.number().int().nonnegative(),
  generatedAt: z.number().int(),
});
export type SyncSnapshotResponse = z.infer<typeof SyncSnapshotResponseSchema>;

/* -------------------------------------------------------------------------- */
/*                              纯函数：冲突消解                                */
/* -------------------------------------------------------------------------- */

export interface Versioned {
  updatedAt: number;
  deviceId?: string;
}

/**
 * 决定本地版本与服务端版本谁胜出。
 * 返回 true 表示本地胜出，需要以服务端 rev 为 baseRev 重新推送。
 */
export function localWins(local: Versioned, remote: Versioned): boolean {
  if (local.updatedAt !== remote.updatedAt) return local.updatedAt > remote.updatedAt;
  return (local.deviceId ?? "") > (remote.deviceId ?? "");
}

/** 把一次拉取到的变更应用到内存字典（供测试与本地库服务复用）。 */
export function applyChange<T extends { id: string; rev: number }>(
  table: Map<string, T>,
  change: { entityId: string; deleted: boolean; payload: unknown; rev: number },
): void {
  if (change.deleted) {
    table.delete(change.entityId);
    return;
  }
  const entity = change.payload as T | null;
  if (!entity) return;
  const existing = table.get(change.entityId);
  if (existing && existing.rev > change.rev) return;
  table.set(change.entityId, entity);
}

/** 判断某个实体是否属于某个同步批次中重复出现的同一 op（用于幂等校验）。 */
export function isDuplicateOp(seen: Set<string>, opId: string): boolean {
  if (seen.has(opId)) return true;
  seen.add(opId);
  return false;
}

export type { EntityName };

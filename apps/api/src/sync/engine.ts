import type { SyncOp, SyncOpResult } from "@detter/shared";
import type { Db } from "../db/types";
import {
  changeStatement,
  getEntityRow,
  insertEntityStatement,
  opLogStatement,
  updateEntityStatement,
  validateEntity,
  type EntityPayload,
  type EntityRow,
} from "../repo/crud";

/**
 * 同步推送引擎（协议见 docs/architecture/03-SYNC-PROTOCOL.md §5）。
 *
 * 每个 op 独立处理、独立成事务：一个 op 失败不能把同批次的其它 op 一起回滚，
 * 否则客户端只能整批重推，冲突会越滚越大。
 */

/** 客户端时钟与服务器相差超过 24h 就用服务器时间（防设备时钟错乱导致永远赢/永远输）。 */
export const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

export interface ApplyOpsContext {
  db: Db;
  userId: string;
  /** 服务端强制覆盖到 payload.deviceId：以请求方为准，避免客户端伪造来源。 */
  deviceId: string;
  now: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampUpdatedAt(value: unknown, now: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return now;
  const timestamp = Math.trunc(value);
  return Math.abs(timestamp - now) > MAX_CLOCK_SKEW_MS ? now : timestamp;
}

export async function applyOps(ctx: ApplyOpsContext, ops: SyncOp[]): Promise<SyncOpResult[]> {
  const results: SyncOpResult[] = [];
  for (const op of ops) {
    results.push(await applyOp(ctx, op));
  }
  return results;
}

async function applyOp(ctx: ApplyOpsContext, op: SyncOp): Promise<SyncOpResult> {
  // 1) 幂等：opId 命中就返回当初的结果，不重复应用
  const logged = await ctx.db.first<{ user_id: string; rev: number; seq: number | null }>(
    "SELECT user_id, rev, seq FROM op_log WHERE op_id = ?",
    [op.opId],
  );
  if (logged) {
    if (logged.user_id !== ctx.userId) {
      return { opId: op.opId, status: "error", error: "forbidden: op 属于其它用户" };
    }
    return {
      opId: op.opId,
      status: "duplicate",
      rev: Number(logged.rev),
      seq: logged.seq === null || logged.seq === undefined ? undefined : Number(logged.seq),
    };
  }

  // 2) 读当前行，做乐观并发判定
  const row = await getEntityRow(ctx.db, op.entity, ctx.userId, op.id);
  return op.op === "delete" ? applyDelete(ctx, op, row) : applyUpsert(ctx, op, row);
}

/** 冲突时返回服务端权威版本；如果服务端当前是墓碑，返回 null（没有可合并的存活版本）。 */
function serverVersion(row: EntityRow): EntityPayload | null {
  if (row.deleted_at !== null) return null;
  return JSON.parse(row.payload) as EntityPayload;
}

async function applyUpsert(ctx: ApplyOpsContext, op: SyncOp, row: EntityRow | null): Promise<SyncOpResult> {
  if (row && Number(row.rev) !== op.baseRev) {
    return { opId: op.opId, status: "conflict", rev: Number(row.rev), server: serverVersion(row) };
  }

  if (!isRecord(op.payload)) {
    return { opId: op.opId, status: "error", error: "validation_error: payload" };
  }

  const rev = row ? Number(row.rev) + 1 : 1;
  const raw = op.payload;

  // 服务端强制字段：id 必须等于 op.id，rev/deviceId 由服务端决定，deletedAt 由 upsert 语义置空
  const candidate: Record<string, unknown> = {
    ...raw,
    id: op.id,
    rev,
    deviceId: ctx.deviceId,
    deletedAt: null,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : ctx.now,
    updatedAt: clampUpdatedAt(raw.updatedAt, ctx.now),
  };

  const validation = validateEntity(op.entity, candidate);
  if (!validation.ok) {
    return { opId: op.opId, status: "error", error: `validation_error: ${validation.path}` };
  }
  const payload = validation.payload;

  const results = await ctx.db.batch([
    row
      ? updateEntityStatement(op.entity, ctx.userId, payload)
      : insertEntityStatement(op.entity, ctx.userId, payload),
    changeStatement(op.entity, ctx.userId, op.id, rev, false, payload, ctx.now),
    opLogStatement(op.opId, ctx.userId, rev, ctx.now),
  ]);

  return { opId: op.opId, status: "applied", rev, seq: results[1]?.lastRowId };
}

async function applyDelete(ctx: ApplyOpsContext, op: SyncOp, row: EntityRow | null): Promise<SyncOpResult> {
  // 删一个本来就不存在的实体是幂等成功（离线设备可能删的是已经清掉的行）
  if (!row) return { opId: op.opId, status: "applied", rev: 0 };

  if (Number(row.rev) !== op.baseRev) {
    return { opId: op.opId, status: "conflict", rev: Number(row.rev), server: serverVersion(row) };
  }

  const rev = Number(row.rev) + 1;
  const current = JSON.parse(row.payload) as EntityPayload;
  const tombstone: EntityPayload = {
    ...current,
    id: op.id,
    rev,
    updatedAt: ctx.now,
    deletedAt: ctx.now,
    deviceId: ctx.deviceId,
  };

  const results = await ctx.db.batch([
    updateEntityStatement(op.entity, ctx.userId, tombstone),
    changeStatement(op.entity, ctx.userId, op.id, rev, true, null, ctx.now),
    opLogStatement(op.opId, ctx.userId, rev, ctx.now),
  ]);

  return { opId: op.opId, status: "applied", rev, seq: results[1]?.lastRowId };
}

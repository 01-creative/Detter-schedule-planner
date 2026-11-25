import { uuidv7, type SyncOp } from "@detter/shared";
import { db } from "@/db";
import type { OutboxRecord } from "@/db/schema";

/**
 * outbox 管理。
 *
 * outbox 是「已经写进本地库、但还没被服务端确认」的变更日志。
 * 这里只做队列本身的增删改，不做网络请求（那在 client.ts），方便单测。
 */

const MAX_ATTEMPTS = 3;
/** 退避：1s / 2s / 4s。失败次数越多等得越久，避免服务端抖动时被反复冲击。 */
const BACKOFF_MS = [1_000, 2_000, 4_000] as const;

export async function listPending(limit: number): Promise<OutboxRecord[]> {
  const now = Date.now();
  const rows = await db.outbox.orderBy("seq").limit(Math.max(limit * 3, limit)).toArray();
  // nextRetryAt 未到期的先跳过；剩下的保持 seq 顺序，服务端按序应用
  return rows.filter((row) => !row.nextRetryAt || row.nextRetryAt <= now).slice(0, limit);
}

export async function pendingCount(): Promise<number> {
  return db.outbox.count();
}

export async function deadCount(): Promise<number> {
  return db.outboxDead.count();
}

export async function removeOps(seqs: number[]): Promise<void> {
  if (seqs.length === 0) return;
  await db.outbox.bulkDelete(seqs);
}

export function toSyncOp(record: OutboxRecord): SyncOp {
  return {
    opId: record.opId,
    entity: record.entity,
    op: record.op,
    id: record.entityId,
    baseRev: record.baseRev,
    at: record.at,
    // delete 不传 payload：服务端只需要知道「这条没了」
    payload: record.op === "upsert" ? record.payload : undefined,
  };
}

/**
 * 记录一次失败。
 * 返回 true 表示已超过重试上限、被移入死信队列（UI 必须提示，不能静默丢）。
 */
export async function recordFailure(record: OutboxRecord, message: string): Promise<boolean> {
  if (record.seq === undefined) return false;
  const attempts = record.attempts + 1;

  if (attempts >= MAX_ATTEMPTS) {
    const failedAt = Date.now();
    await db.transaction("rw", db.outbox, db.outboxDead, async () => {
      const current = await db.outbox.get(record.seq!);
      if (!current) return;
      await db.outbox.delete(record.seq!);
      await db.outboxDead.add({ ...current, attempts, lastError: message, failedAt });
    });
    return true;
  }

  const backoff = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] ?? 4_000;
  await db.outbox.update(record.seq, {
    attempts,
    lastError: message,
    nextRetryAt: Date.now() + backoff,
  });
  return false;
}

/**
 * 冲突且本地胜出：以服务端 rev 作为新的 baseRev 重推。
 *
 * 为什么必须换一个新 opId：服务端按 opId 幂等去重，沿用旧 opId 会被直接判 duplicate，
 * 这条修改就永远推不出去。这是协议里没写、但实现时必须做对的一步。
 */
export async function requeueAfterConflict(record: OutboxRecord, serverRev: number): Promise<void> {
  if (record.seq === undefined) return;
  await db.outbox.update(record.seq, {
    opId: uuidv7(),
    baseRev: serverRev,
    at: Date.now(),
    attempts: 0,
    lastError: undefined,
    nextRetryAt: undefined,
  });
}

/** 死信重试：由用户在设置页手动触发，或下一轮同步自动带走。 */
export async function retryDeadLetters(): Promise<number> {
  const dead = await db.outboxDead.toArray();
  if (dead.length === 0) return 0;
  await db.transaction("rw", db.outbox, db.outboxDead, async () => {
    for (const item of dead) {
      const { seq: _seq, failedAt: _failedAt, ...rest } = item;
      await db.outbox.add({
        ...rest,
        opId: uuidv7(),
        attempts: 0,
        lastError: undefined,
        nextRetryAt: undefined,
        at: Date.now(),
      });
    }
    await db.outboxDead.clear();
  });
  return dead.length;
}

export async function clearDeadLetters(): Promise<void> {
  await db.outboxDead.clear();
}

export async function listDeadLetters(): Promise<Array<OutboxRecord & { failedAt: number }>> {
  return db.outboxDead.orderBy("seq").toArray();
}

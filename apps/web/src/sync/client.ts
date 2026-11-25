import {
  ENTITY_SCHEMAS,
  SYNC_DEFAULTS,
  localWins,
  type ChangeRow,
  type EntityName,
  type SyncOpResult,
  type SyncPullResponse,
  type SyncPushResponse,
} from "@detter/shared";
import { api, isOfflineError } from "@/lib/api";
import { getDeviceId } from "@/lib/device";
import { getCursor, getLastSyncAt, setCursor, setLastSyncAt } from "@/db";
import {
  applyRemoteEntity,
  getEntity,
  hasPendingOp,
  onLocalWrite,
  removeLocalEntity,
  updateEntityRev,
} from "@/db/repo";
import type { OutboxRecord } from "@/db/schema";
import {
  deadCount,
  listPending,
  pendingCount,
  recordFailure,
  removeOps,
  requeueAfterConflict,
  retryDeadLetters,
  toSyncOp,
} from "./queue";

/**
 * 同步客户端状态机
 * -------------------------------------------------------------------------
 *   idle ──有本地写入(800ms 防抖)/定时拉取──► syncing
 *   syncing ──push+pull 都成功──────────────► idle
 *   syncing ──网络/超时/5xx────────────────► offline（outbox 原样保留，不丢数据）
 *   syncing ──业务错误/单条 op 连续失败 3 次─► error（死信队列 + UI 提示）
 *   offline ──online 事件 / 定时器──────────► syncing
 *
 * 本地优先的关键：任何失败都只改状态、不动本地数据。用户在离线时写的每一条都在 outbox 里，
 * 联网后自动重推；因此「离线」在这个产品里是一种正常工作模式，而不是异常。
 */

export type SyncState = "idle" | "syncing" | "offline" | "error";

export interface SyncSnapshot {
  state: SyncState;
  /** 待推送条数（UI 上显示「N 条待同步」） */
  pending: number;
  /** 进入死信队列的条数（需要用户处理） */
  dead: number;
  lastSyncAt: number | null;
  /** 最近一次失败的可读原因；成功后退回 null */
  error: string | null;
}

let snapshot: SyncSnapshot = {
  state: "idle",
  pending: 0,
  dead: 0,
  lastSyncAt: null,
  error: null,
};

const listeners = new Set<() => void>();

function emit(patch: Partial<SyncSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** useSyncExternalStore 要求引用稳定：只有 emit 时才会换新对象。 */
export function getSyncSnapshot(): SyncSnapshot {
  return snapshot;
}

async function refreshCounts(): Promise<void> {
  const [pending, dead] = await Promise.all([pendingCount(), deadCount()]);
  if (pending !== snapshot.pending || dead !== snapshot.dead) {
    emit({ pending, dead });
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "同步失败";
}

/* -------------------------------------------------------------------------- */
/*                                   push                                      */
/* -------------------------------------------------------------------------- */

async function handleResult(record: OutboxRecord, result: SyncOpResult): Promise<void> {
  const seq = record.seq;

  switch (result.status) {
    case "applied":
    case "duplicate": {
      if (seq !== undefined) await removeOps([seq]);
      // 服务端 rev 是下一次推送的 baseRev；不回写的话每条都会冲突
      if (typeof result.rev === "number") {
        await updateEntityRev(record.entity, record.entityId, result.rev);
      }
      return;
    }

    case "conflict": {
      const local = await getEntity(record.entity, record.entityId);
      const serverRev = result.rev ?? 0;
      const serverPayload = result.server ?? null;

      if (!local) {
        // 本地已经没有这条（可能刚被另一条 op 删掉）：服务端版本作准
        if (serverPayload) await applyRemoteEntity(record.entity, serverPayload);
        if (seq !== undefined) await removeOps([seq]);
        return;
      }

      if (!serverPayload) {
        // 服务端说冲突但没给版本，无法比较 → 本地胜出，以服务端 rev 重推
        await requeueAfterConflict(record, serverRev);
        return;
      }

      const server = ENTITY_SCHEMAS[record.entity].parse(serverPayload) as {
        updatedAt: number;
        deviceId?: string;
      };

      if (localWins({ updatedAt: local.updatedAt, deviceId: local.deviceId }, server)) {
        await requeueAfterConflict(record, serverRev);
        return;
      }

      // 服务端更新：覆盖本地，丢掉这条 op。数据没有丢，只是被更新的版本取代。
      await applyRemoteEntity(record.entity, serverPayload);
      if (seq !== undefined) await removeOps([seq]);
      return;
    }

    case "error": {
      const dead = await recordFailure(record, result.error ?? "服务端拒绝了这个变更");
      if (dead) {
        emit({ state: "error", error: `有变更连续失败，已移入死信队列（${result.error ?? "未知原因"}）` });
      }
      return;
    }
  }
}

export async function push(): Promise<void> {
  const ops = await listPending(SYNC_DEFAULTS.maxOpsPerBatch);
  if (ops.length === 0) return;

  const response = await api.post<SyncPushResponse>("/sync/push", {
    deviceId: getDeviceId(),
    ops: ops.map(toSyncOp),
  });

  const byOpId = new Map(ops.map((op) => [op.opId, op]));
  for (const result of response.results) {
    const record = byOpId.get(result.opId);
    if (!record) continue;
    await handleResult(record, result);
  }
  // 没有出现在 results 里的 op 继续留在队列，下一轮再推（幂等由 opId 保证）
  // 计数在这里同步一次：死信/待推条数是徽标与设置页的唯一数据源
  await refreshCounts();
}

/* -------------------------------------------------------------------------- */
/*                                   pull                                      */
/* -------------------------------------------------------------------------- */

const MAX_PULL_PAGES = 5;

async function applyChange(change: ChangeRow): Promise<void> {
  const entity = change.entity as EntityName;

  // 本地还有未推送的修改时先不动它：交给 push 的冲突消解决定谁胜，
  // 否则会把用户刚编辑的内容直接盖掉（这是最伤人的一类 bug）。
  if (await hasPendingOp(entity, change.entityId)) return;

  const existing = await getEntity(entity, change.entityId);
  if (existing && existing.rev > change.rev) return;

  if (change.deleted) {
    if (change.payload) {
      await applyRemoteEntity(entity, change.payload);
    } else {
      await removeLocalEntity(entity, change.entityId);
    }
    return;
  }

  if (!change.payload) return;
  await applyRemoteEntity(entity, change.payload);
}

export async function pull(): Promise<void> {
  let cursor = await getCursor();
  let hasMore = true;
  let pages = 0;

  while (hasMore && pages < MAX_PULL_PAGES) {
    const response = await api.get<SyncPullResponse>(
      `/sync/pull?cursor=${cursor}&limit=${SYNC_DEFAULTS.maxOpsPerBatch}`,
    );

    for (const change of response.changes) {
      await applyChange(change);
    }

    cursor = response.cursor;
    await setCursor(cursor);
    hasMore = response.hasMore && response.changes.length > 0;
    pages += 1;
  }
}

/* -------------------------------------------------------------------------- */
/*                                  flush                                      */
/* -------------------------------------------------------------------------- */

let inflight: Promise<void> | null = null;

/** 一次完整的同步周期：先推自己的改动，再拉别人的改动。 */
export function flush(): Promise<void> {
  if (inflight) return inflight;

  inflight = (async () => {
    emit({ state: "syncing" });
    try {
      await push();
      await pull();
      const now = Date.now();
      await setLastSyncAt(now);
      await refreshCounts();
      if (snapshot.dead > 0) {
        // 有死信时不能退回「已同步」的绿色状态，否则用户永远看不到需要处理的失败
        emit({ state: "error", lastSyncAt: now });
      } else {
        emit({ state: "idle", lastSyncAt: now, error: null });
      }
    } catch (error) {
      if (isOfflineError(error)) {
        // 离线不是错误：本地数据完好，徽标显示「离线 · N 条待同步」即可
        emit({ state: "offline", error: "离线中，改动已存在本地" });
      } else {
        emit({ state: "error", error: messageOf(error) });
      }
    } finally {
      inflight = null;
      await refreshCounts();
    }
  })();

  return inflight;
}

/* -------------------------------------------------------------------------- */
/*                               定时与事件                                    */
/* -------------------------------------------------------------------------- */

let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** 800ms 防抖：连续输入时只在停手后推一次。 */
export function scheduleFlush(delay: number = SYNC_DEFAULTS.pushDebounceMs): void {
  void refreshCounts();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, delay);
}

let started = false;
let unsubscribeWrite: (() => void) | null = null;
let pullTimer: ReturnType<typeof setInterval> | null = null;

function onOnline(): void {
  void flush();
}

function onOffline(): void {
  emit({ state: "offline", error: "网络已断开，改动会先存在本地" });
}

function onVisibilityChange(): void {
  // 切回前台立刻拉一次：移动端后台时定时器会被节流，靠这个补上
  if (document.visibilityState === "visible") void flush();
}

export function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  unsubscribeWrite = onLocalWrite(() => scheduleFlush());

  void getLastSyncAt().then((lastSyncAt) => emit({ lastSyncAt }));
  void refreshCounts();
  void flush();

  pullTimer = setInterval(() => {
    // 页面不可见时暂停：省电，也避免后台标签页反复打服务端
    if (document.visibilityState === "visible") void flush();
  }, SYNC_DEFAULTS.pullIntervalMs);

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisibilityChange);
}

export function stop(): void {
  if (!started) return;
  started = false;
  unsubscribeWrite?.();
  unsubscribeWrite = null;
  if (pullTimer) clearInterval(pullTimer);
  pullTimer = null;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  window.removeEventListener("online", onOnline);
  window.removeEventListener("offline", onOffline);
  document.removeEventListener("visibilitychange", onVisibilityChange);
}

/** 设置页的「重试失败项」。 */
export async function retryFailed(): Promise<number> {
  const count = await retryDeadLetters();
  await refreshCounts();
  if (count > 0) await flush();
  return count;
}

/** 立即同步（用户点按钮）。 */
export async function syncNow(): Promise<void> {
  await flush();
}

/** 测试用：重置模块内状态，避免用例之间互相污染。 */
export function __resetSyncForTests(): void {
  stop();
  snapshot = { state: "idle", pending: 0, dead: 0, lastSyncAt: null, error: null };
  inflight = null;
}

import { useSyncExternalStore } from "react";
import { getSyncSnapshot, subscribeSync, type SyncSnapshot } from "./client";

/**
 * 同步状态订阅。
 *
 * 用 useSyncExternalStore 而不是 Zustand：同步状态是「外部事实」，
 * 由网络与 outbox 驱动，放进 UI store 反而会出现两个真相。
 */
export function useSyncStatus(): SyncSnapshot {
  return useSyncExternalStore(subscribeSync, getSyncSnapshot, getSyncSnapshot);
}

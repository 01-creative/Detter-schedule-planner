import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { PomodoroSession } from "@detter/shared";
import { db } from "@/db";

/**
 * 全部番茄记录（不含墓碑）。
 *
 * 只读查询直接用 useLiveQuery 查 Dexie，符合 07-FRONTEND-STRUCTURE §3：
 * 写操作才必须走 `@/db/repo`。查询返回 undefined 表示「还没回来」，
 * 页面据此区分加载态与空态。
 */
export function usePomodoroSessions(): { data: PomodoroSession[]; loading: boolean } {
  const data = useLiveQuery(
    async () => {
      const rows = await db.pomodoroSessions.toArray();
      return rows.filter((row) => !row.deletedAt);
    },
    [],
    undefined,
  );

  return { data: data ?? [], loading: data === undefined };
}

/**
 * 每 N 毫秒跳一次的「现在」。
 *
 * 只用于「今天」这种按日历日刷新的展示（统计、最近记录），
 * 计时本身不依赖它 —— 计时永远是 endsAt 反算。
 * 回到前台时立刻校正一次，避免锁屏期间停在旧值。
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, intervalMs);
    const onVisible = () => tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);

  return now;
}

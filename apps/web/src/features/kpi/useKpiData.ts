import { useLiveQuery } from "dexie-react-hooks";
import type { Kpi, KpiEntry, PomodoroSession, Task } from "@detter/shared";
import { db } from "@/db";

/**
 * KPI 页需要的四张表：指标、打卡、番茄记录、任务。
 *
 * 为什么一次查完：四条聚合来源（手工打卡 / 番茄分钟 / 专注次数 / 完成任务数）
 * 必须在同一个快照里算，否则会出现「指标已更新、图表还是旧的」这种错位。
 * useLiveQuery 会在任意一张表提交事务后重跑，四份数据因此总是同一拍。
 */
export interface KpiData {
  kpis: Kpi[];
  entries: KpiEntry[];
  sessions: PomodoroSession[];
  tasks: Task[];
  loading: boolean;
}

const EMPTY: Omit<KpiData, "loading"> = { kpis: [], entries: [], sessions: [], tasks: [] };

export function useKpiData(): KpiData {
  const data = useLiveQuery(
    async () => {
      const [kpis, entries, sessions, tasks] = await Promise.all([
        db.kpis.toArray(),
        db.kpiEntries.toArray(),
        db.pomodoroSessions.toArray(),
        db.tasks.toArray(),
      ]);
      return {
        kpis: kpis
          .filter((row) => !row.deletedAt)
          .sort((a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt),
        entries: entries.filter((row) => !row.deletedAt),
        sessions: sessions.filter((row) => !row.deletedAt),
        tasks: tasks.filter((row) => !row.deletedAt),
      };
    },
    [],
    undefined,
  );

  return data ? { ...data, loading: false } : { ...EMPTY, loading: true };
}

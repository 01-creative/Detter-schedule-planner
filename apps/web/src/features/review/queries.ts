import { useLiveQuery } from "dexie-react-hooks";
import type {
  Goal,
  KeyResult,
  Kpi,
  KpiEntry,
  Okr,
  PomodoroSession,
  Task,
} from "@detter/shared";
import { db } from "@/db";
import { loadReviewSnapshots, type ReviewSnapshot } from "./snapshot";

/**
 * 复盘取数。
 *
 * 按 07-FRONTEND-STRUCTURE §3：只读查询直接查 Dexie，跨表聚合写在 feature 里。
 * 复盘故意读原始表（tasks / kpis / kpiEntries / pomodoroSessions），
 * 不依赖 KPI / 番茄钟页面的组件与派生数据 —— 否则它们一改口径，复盘就跟着漂。
 */

export interface ReviewDataSet {
  tasks: Task[];
  goals: Goal[];
  okrs: Okr[];
  krs: KeyResult[];
  kpis: Kpi[];
  kpiEntries: KpiEntry[];
  sessions: PomodoroSession[];
  loading: boolean;
}

export function useReviewData(): ReviewDataSet {
  const data = useLiveQuery(
    async () => {
      const [tasks, goals, okrs, krs, kpis, kpiEntries, sessions] = await Promise.all([
        db.tasks.toArray(),
        db.goals.toArray(),
        db.okrs.toArray(),
        db.keyResults.toArray(),
        db.kpis.toArray(),
        db.kpiEntries.toArray(),
        db.pomodoroSessions.toArray(),
      ]);
      return {
        tasks: tasks.filter((row) => !row.deletedAt),
        goals: goals.filter((row) => !row.deletedAt),
        okrs: okrs.filter((row) => !row.deletedAt),
        krs: krs.filter((row) => !row.deletedAt),
        kpis: kpis.filter((row) => !row.deletedAt),
        kpiEntries: kpiEntries.filter((row) => !row.deletedAt),
        sessions: sessions.filter((row) => !row.deletedAt),
      };
    },
    [],
    undefined,
  );

  if (!data) {
    return {
      tasks: [],
      goals: [],
      okrs: [],
      krs: [],
      kpis: [],
      kpiEntries: [],
      sessions: [],
      loading: true,
    };
  }
  return { ...data, loading: false };
}

export interface SnapshotsResult {
  data: ReviewSnapshot[];
  loading: boolean;
}

export function useReviewSnapshots(): SnapshotsResult {
  const data = useLiveQuery(async () => loadReviewSnapshots(), [], undefined);
  return { data: data ?? [], loading: data === undefined };
}

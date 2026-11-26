import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import type { Assessment, Assignment, Course, HomeworkReminderConfig, PeriodTime } from "@detter/shared";
import { db } from "@/db";
import { readCourseSettings } from "./coursesModel";

/**
 * /courses 的数据入口：一次 useLiveQuery 读全三张表 + 课表设置。
 *
 * 为什么读全表：课程数量在几十的量级，而「这门课本周有没有作业」「课程列表的权重合计」
 * 都需要跨表聚合；Dexie 的索引查询省不下多少，反而让派生逻辑分散到各处。
 * 写入仍然走 repo，所以任何一条改动都会让这个查询自动重跑。
 */

export interface CoursesData {
  courses: Course[];
  assessments: Assessment[];
  assignments: Assignment[];
  semesterStart: string | null;
  periodTimes: PeriodTime[];
  homeworkReminder: HomeworkReminderConfig;
  loading: boolean;
}

interface Snapshot {
  courses: Course[];
  assessments: Assessment[];
  assignments: Assignment[];
  semesterStart: string | null;
  periodTimes: PeriodTime[];
  homeworkReminder: HomeworkReminderConfig;
}

export function useCoursesData(): CoursesData {
  const snapshot = useLiveQuery(
    async (): Promise<Snapshot> => {
      const [courses, assessments, assignments, settings] = await Promise.all([
        db.courses.toArray(),
        db.assessments.toArray(),
        db.assignments.toArray(),
        db.settings.toArray(),
      ]);

      // 同一个 key 可能有多行历史（软删/复活），取最近更新的一行
      const values = new Map<string, { value: unknown; updatedAt: number }>();
      for (const row of settings) {
        if (row.deletedAt) continue;
        const current = values.get(row.key);
        if (!current || row.updatedAt >= current.updatedAt) {
          values.set(row.key, { value: row.value, updatedAt: row.updatedAt });
        }
      }

      const parsed = readCourseSettings({
        semesterStart: values.get("courses.semesterStart")?.value,
        periodTimes: values.get("courses.periodTimes")?.value,
        homeworkReminder: values.get("courses.homeworkReminder")?.value,
      });

      return {
        courses: courses.filter((row) => !row.deletedAt),
        assessments: assessments.filter((row) => !row.deletedAt),
        assignments: assignments.filter((row) => !row.deletedAt),
        semesterStart: parsed.semesterStart,
        periodTimes: parsed.periodTimes,
        homeworkReminder: parsed.homeworkReminder,
      };
    },
    [],
    undefined,
  );

  return {
    courses: snapshot?.courses ?? [],
    assessments: snapshot?.assessments ?? [],
    assignments: snapshot?.assignments ?? [],
    semesterStart: snapshot?.semesterStart ?? null,
    periodTimes: snapshot?.periodTimes ?? [],
    homeworkReminder: snapshot?.homeworkReminder ?? { enabled: true, weekday: 7, time: "20:00" },
    loading: snapshot === undefined,
  };
}

/** 每分钟刷新一次的「现在」，让「本周第几周」「本周还有哪门课没记作业」自然翻页。 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

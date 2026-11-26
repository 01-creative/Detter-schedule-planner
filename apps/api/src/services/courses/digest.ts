import {
  COURSE_SETTING_KEYS,
  DEFAULT_HOMEWORK_REMINDER,
  dayKey,
  findHomeworkGaps,
  homeworkReminderInstant,
  normalizeHomeworkReminder,
  startOfWeek,
} from "@detter/shared";
import type { Db } from "../../db/types";
import { readSettingValues } from "../../repo/settings";
import { listAssignments, listCourses, resolveSemesterStart } from "../courses";
import { writeInappNotification } from "../reminders/notifiers/inapp";

/**
 * 每周作业遗漏提醒（「本周还有 N 门课没记作业」）。
 *
 * 为什么不做成「一条重复 Task」：
 * 提醒调度只认 Task 的**单个** startAt/dueAt（rrule 的展开在渲染层，不落库），
 * 所以用重复 Task 只能提醒第一次，后面几周会静默失效。
 *
 * 为什么也不往 reminders 表里塞行：
 * reminders 的唯一键是 (task_id, fire_at, channel)，没有 task 的提醒需要造一个假 task_id；
 * 而 notifications 已经有 `reminder_id` 唯一索引，天然能做「每周最多一次」的幂等。
 *
 * 于是选择：在 runReminderTick 里加一个 digest 阶段，直接写一条 inapp 通知，
 * 幂等键是 `homework-digest:<user>:<本周周一>`。它：
 *   - 不创建 Task，不污染四象限/日历；
 *   - 不会重复推送（INSERT OR IGNORE + 唯一索引）；
 *   - 到点才发（默认周日 20:00，可在设置里改）。
 */

export interface HomeworkDigestResult {
  emitted: boolean;
  reason:
    | "emitted"
    | "already_sent"
    | "disabled"
    | "before_time"
    | "no_missing"
    | "no_courses"
    | "no_semester";
  /** 本周是学期第几周（无法判断时为 null） */
  weekNo: number | null;
  /** 本周没记作业的课程数 */
  missing: number;
  courseNames: string[];
  /** 本周的提醒时刻（毫秒） */
  fireAt: number | null;
  /** 幂等键里的周标识：本周周一 YYYY-MM-DD */
  weekKey: string;
}

export interface HomeworkDigestOptions {
  /** 忽略「还没到点」与「本周已发过」的判断，用于手动触发/验收 */
  force?: boolean;
  /** false 时只计算不写通知（预览用） */
  notify?: boolean;
}

function digestKey(userId: string, weekKey: string): string {
  // 单用户产品里 userId 只是保险：多用户时也不会互相覆盖同一个幂等键
  return `homework-digest:${userId.slice(0, 8)}:${weekKey}`;
}

export async function runHomeworkDigest(
  db: Db,
  userId: string,
  now: number,
  options: HomeworkDigestOptions = {},
): Promise<HomeworkDigestResult> {
  const weekKey = dayKey(startOfWeek(now));
  const values = await readSettingValues(db, userId, [
    COURSE_SETTING_KEYS.homeworkReminder,
    COURSE_SETTING_KEYS.semesterStart,
  ]);
  const config = normalizeHomeworkReminder(values[COURSE_SETTING_KEYS.homeworkReminder] ?? DEFAULT_HOMEWORK_REMINDER);

  const base: HomeworkDigestResult = {
    emitted: false,
    reason: "no_courses",
    weekNo: null,
    missing: 0,
    courseNames: [],
    fireAt: null,
    weekKey,
  };

  if (!config.enabled && options.force !== true) {
    return { ...base, reason: "disabled" };
  }

  const ctx = { db, userId, now };
  const courses = await listCourses(ctx);
  if (!courses.some((course) => course.weeklyHomework)) {
    return { ...base, reason: "no_courses" };
  }

  const assignments = await listAssignments(ctx);
  const semesterStart = await resolveSemesterStart(ctx);
  const fireAt = homeworkReminderInstant(now, config);

  // 没有学期起点（全局与课程都为空）时无法判断「哪一周」，直接跳过，避免误报
  if (semesterStart === null && !courses.some((course) => course.semesterStart)) {
    return { ...base, reason: "no_semester", fireAt };
  }

  const gaps = findHomeworkGaps(courses, assignments, now, semesterStart);
  if (gaps.length === 0) {
    return { ...base, reason: "no_missing", fireAt };
  }

  const courseNames = gaps.map((gap) => gap.course.name);
  const weekNo = gaps[0]?.weekNo ?? null;
  if (options.force !== true && now < fireAt) {
    return { ...base, reason: "before_time", weekNo, missing: gaps.length, courseNames, fireAt };
  }

  const reminderId = digestKey(userId, weekKey);
  const existing = await db.first<{ id: string }>("SELECT id FROM notifications WHERE reminder_id = ?", [
    reminderId,
  ]);

  const result: HomeworkDigestResult = {
    emitted: false,
    reason: existing ? "already_sent" : "emitted",
    weekNo,
    missing: gaps.length,
    courseNames,
    fireAt,
    weekKey,
  };

  if (existing || options.notify === false) {
    return result;
  }

  const names = result.courseNames.slice(0, 5).join("、");
  const more = result.courseNames.length > 5 ? ` 等 ${result.courseNames.length} 门` : "";
  await writeInappNotification(db, userId, now, {
    reminderId,
    taskId: null,
    title: `本周还有 ${gaps.length} 门课没记作业`,
    body: `第 ${result.weekNo ?? "?"} 周 · ${names}${more}`,
    url: "/courses",
  });

  return { ...result, emitted: true };
}

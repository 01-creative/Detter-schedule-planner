import type { Assessment, AssessmentKind, Assignment, Course } from "./entities.ts";
import type { ParsedTimetable, TimetableSlot } from "./timetable.ts";
import { DAY, MINUTE, HOUR, addDays, dayKey, dayKeyToTs, startOfWeek } from "./time.ts";
import { weekdayToken } from "./timetable.ts";

/**
 * 课程域的纯函数层（前后端共用）。
 *
 * 这里集中了四类「两边都必须一致」的规则：
 *   1. 节次 ↔ 时间：作息表存在 settings 里，默认川大江安；
 *   2. 周次 ↔ 日期：学期第 1 周周一是唯一锚点；
 *   3. 周次集合 ↔ 重复规则：单双周用 INTERVAL=2 表达，不连续周次拆成多段；
 *   4. 课程 → Task 的字段映射：提醒/日历/四象限只认 Task，所以映射必须只有一份实现。
 *
 * 之所以不放在 web 或 api 各自实现：MCP 写入与前端导入建出来的 Task 必须长得一模一样，
 * 否则「AI 建的考核项」和「网页建的」会在日历里表现不一致。
 */

/* -------------------------------------------------------------------------- */
/*                                  设置键                                      */
/* -------------------------------------------------------------------------- */

export const COURSE_SETTING_KEYS = {
  /** 全局学期起点：第 1 周周一的日期，YYYY-MM-DD */
  semesterStart: "courses.semesterStart",
  /** 节次作息表：PeriodTime[] */
  periodTimes: "courses.periodTimes",
  /** 每周作业遗漏提醒：HomeworkReminderConfig */
  homeworkReminder: "courses.homeworkReminder",
} as const;

export interface PeriodTime {
  /** HH:MM */
  start: string;
  /** HH:MM */
  end: string;
}

/** 川大江安校区作息（11 节）。设置页与导入预览都以它为默认值。 */
export const DEFAULT_PERIOD_TIMES: readonly PeriodTime[] = [
  { start: "08:00", end: "08:45" },
  { start: "08:55", end: "09:40" },
  { start: "10:00", end: "10:45" },
  { start: "10:55", end: "11:40" },
  { start: "14:00", end: "14:45" },
  { start: "14:55", end: "15:40" },
  { start: "16:00", end: "16:45" },
  { start: "16:55", end: "17:40" },
  { start: "19:00", end: "19:45" },
  { start: "19:55", end: "20:40" },
  { start: "20:50", end: "21:35" },
];

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isPeriodTime(value: unknown): value is PeriodTime {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.start === "string" &&
    typeof record.end === "string" &&
    TIME_PATTERN.test(record.start) &&
    TIME_PATTERN.test(record.end)
  );
}

/** 设置里存的作息表可能是任意 JSON：逐项校验，坏项回落到默认值。 */
export function normalizePeriodTimes(raw: unknown): PeriodTime[] {
  const source = Array.isArray(raw) ? raw : [];
  const count = Math.max(DEFAULT_PERIOD_TIMES.length, source.length);
  const result: PeriodTime[] = [];
  for (let index = 0; index < count; index += 1) {
    const candidate = source[index];
    const fallback = DEFAULT_PERIOD_TIMES[index] ?? DEFAULT_PERIOD_TIMES[DEFAULT_PERIOD_TIMES.length - 1]!;
    result.push(isPeriodTime(candidate) ? { start: candidate.start, end: candidate.end } : { ...fallback });
  }
  return result;
}

export function parseTimeToMinutes(raw: string): number | null {
  const match = TIME_PATTERN.exec(raw.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToTime(minutes: number): string {
  const safe = Math.min(24 * 60 - 1, Math.max(0, Math.trunc(minutes)));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

/** 节次区间 → 具体时刻；作息表缺项时回落到江安默认。 */
export function resolvePeriodWindow(
  periodTimes: readonly PeriodTime[],
  startPeriod: number,
  endPeriod: number,
): { start: string; end: string } {
  const pick = (period: number, edge: "start" | "end"): string => {
    const index = Math.max(1, Math.trunc(period)) - 1;
    const fromSettings = periodTimes[index];
    if (fromSettings) return edge === "start" ? fromSettings.start : fromSettings.end;
    const fallback = DEFAULT_PERIOD_TIMES[index];
    if (fallback) return edge === "start" ? fallback.start : fallback.end;
    return edge === "start" ? "08:00" : "08:45";
  };
  const start = pick(startPeriod, "start");
  const end = pick(endPeriod, "end");
  // 结束早于开始时按「同一节」兜底，避免生成负数时长的日程
  if ((parseTimeToMinutes(end) ?? 0) <= (parseTimeToMinutes(start) ?? 0)) {
    const fallbackEnd = parseTimeToMinutes(start) ?? 0;
    return { start, end: minutesToTime(fallbackEnd + 45) };
  }
  return { start, end };
}

/* -------------------------------------------------------------------------- */
/*                              每周作业提醒配置                                */
/* -------------------------------------------------------------------------- */

export type ReminderWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface HomeworkReminderConfig {
  enabled: boolean;
  /** ISO 周几：7=周日（默认） */
  weekday: ReminderWeekday;
  /** HH:MM */
  time: string;
}

export const DEFAULT_HOMEWORK_REMINDER: HomeworkReminderConfig = {
  enabled: true,
  weekday: 7,
  time: "20:00",
};

export function normalizeHomeworkReminder(raw: unknown): HomeworkReminderConfig {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_HOMEWORK_REMINDER };
  const record = raw as Record<string, unknown>;
  const weekdayRaw = Number(record.weekday);
  const weekday = Number.isFinite(weekdayRaw) && weekdayRaw >= 1 && weekdayRaw <= 7
    ? (Math.trunc(weekdayRaw) as ReminderWeekday)
    : DEFAULT_HOMEWORK_REMINDER.weekday;
  const time = typeof record.time === "string" && TIME_PATTERN.test(record.time.trim())
    ? record.time.trim()
    : DEFAULT_HOMEWORK_REMINDER.time;
  return {
    enabled: record.enabled === undefined ? DEFAULT_HOMEWORK_REMINDER.enabled : record.enabled !== false,
    weekday,
    time,
  };
}

/**
 * 本周（周一起算）的提醒时刻。
 *
 * 周日 20:00 属于「本周的最后一天」——这与人的直觉一致：
 * 周日晚上是补记这一周作业的最后时机。weekday=7 时它落在本周第 7 天。
 */
export function homeworkReminderInstant(now: number, config: HomeworkReminderConfig): number {
  const weekStart = startOfWeek(now);
  const minutes = parseTimeToMinutes(config.time) ?? 20 * 60;
  return weekStart + (config.weekday - 1) * DAY + minutes * MINUTE;
}

/* -------------------------------------------------------------------------- */
/*                                周次 ↔ 日期                                   */
/* -------------------------------------------------------------------------- */

/** 学期起点（任意一天）→ 第 1 周周一 00:00。 */
export function semesterAnchor(semesterStart: string | null | undefined): number | null {
  if (!semesterStart || !/^\d{4}-\d{2}-\d{2}$/.test(semesterStart)) return null;
  return startOfWeek(dayKeyToTs(semesterStart));
}

/** 当前是学期第几周；学期开始前或没有学期起点时返回 null。 */
export function courseWeekNo(semesterStart: string | null | undefined, at: number): number | null {
  const anchor = semesterAnchor(semesterStart);
  if (anchor === null) return null;
  const weekStart = startOfWeek(at);
  if (weekStart < anchor) return null;
  return Math.floor((weekStart - anchor) / (7 * DAY)) + 1;
}

/** 第 N 周周一的 00:00。 */
export function weekStartAt(semesterStart: string, weekNo: number): number {
  const anchor = semesterAnchor(semesterStart) ?? startOfWeek(Date.now());
  return addDays(anchor, (Math.max(1, Math.trunc(weekNo)) - 1) * 7);
}

/** 第 N 周周几（1..7）的 00:00。 */
export function weekdayDateAt(semesterStart: string, weekNo: number, weekday: number): number {
  const monday = weekStartAt(semesterStart, weekNo);
  return addDays(monday, Math.min(7, Math.max(1, Math.trunc(weekday))) - 1);
}

/** 把「某天 00:00」+「HH:MM」拼成本地时间戳。 */
export function combineDayAndTime(dayTimestamp: number, time: string): number {
  const minutes = parseTimeToMinutes(time);
  if (minutes === null) return dayTimestamp;
  return dayKeyToTs(dayKey(dayTimestamp), minutes * MINUTE);
}

/** RFC5545 的 UNTIL 字面量：把本地墙上时间写成 UTC 形式（与日历展开的浮动时间技巧对齐）。 */
export function rruleUntilLiteral(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}Z`
  );
}

/* -------------------------------------------------------------------------- */
/*                              周次拆分 / 描述                                 */
/* -------------------------------------------------------------------------- */

/**
 * 把周次集合拆成若干「等差段」（步长只能是 1 或 2）。
 *
 * 这是 rrule 能精确表达的范围：
 * - 连续周 → FREQ=WEEKLY（INTERVAL 省略）；
 * - 单双周 → FREQ=WEEKLY;INTERVAL=2，dtstart 落在该段的第一次；
 * - `1-8周,10-16周` 这种缺口 → 两段。
 * 每段一条 Task，既不丢信息，也不会把 17 周摊成 17 条任务。
 */
export function splitWeekRuns(weeks: readonly number[]): number[][] {
  const sorted = [...new Set(weeks.filter((week) => Number.isFinite(week) && week >= 1))].sort(
    (left, right) => left - right,
  );
  if (sorted.length === 0) return [];

  const runs: number[][] = [];
  let current: number[] = [sorted[0] as number];
  for (let index = 1; index < sorted.length; index += 1) {
    const week = sorted[index] as number;
    const previous = sorted[index - 1] as number;
    const step = week - previous;
    const currentStep = current.length >= 2 ? (current[1] as number) - (current[0] as number) : null;
    const usable = step === 1 || step === 2;
    if (usable && (currentStep === null || currentStep === step)) {
      current.push(week);
      continue;
    }
    runs.push(current);
    current = [week];
  }
  runs.push(current);
  return runs;
}

/** 人话版周次：`1-8,10-16周`、`1-16周(单)`。 */
export function describeWeeks(weeks: readonly number[]): string {
  const runs = splitWeekRuns(weeks);
  if (runs.length === 0) return "周次待定";
  const parts = runs.map((run) => {
    const first = run[0] as number;
    const last = run[run.length - 1] as number;
    if (run.length === 1) return String(first);
    const step = (run[1] as number) - first;
    if (step === 1) return `${first}-${last}`;
    return `${first}-${last}${first % 2 === 1 ? "(单)" : "(双)"}`;
  });
  return `${parts.join(",")}周`;
}

/** `1-2节`；跨大节时显示 `5-7节`。 */
export function describePeriods(startPeriod: number, endPeriod: number): string {
  return startPeriod === endPeriod ? `第${startPeriod}节` : `${startPeriod}-${endPeriod}节`;
}

/* -------------------------------------------------------------------------- */
/*                              导入计划（纯函数）                              */
/* -------------------------------------------------------------------------- */

export interface PlannedSeries {
  /** 该段覆盖的周次（升序） */
  weeks: number[];
  /** 第一次上课的绝对时间（= rrule 的 dtstart） */
  startAt: number;
  /** 第一次下课时间 */
  endAt: number;
  /** RFC5545 片段；单周段为 null（一次性日程） */
  rrule: string | null;
  /** 幂等去重键：同课程 + 同时段 + 同起始周 → 同一段 */
  key: string;
}

export interface PlannedSlot extends TimetableSlot {
  /** 每段一条 Task */
  series: PlannedSeries[];
}

export interface PlannedCourse {
  name: string;
  code: string;
  teacher: string;
  color: string;
  slots: PlannedSlot[];
  /** 这门课覆盖到第几周（用于 UNTIL 与学期长度提示） */
  maxWeek: number;
}

export interface TimetableImportPlan {
  semesterStart: string;
  periodTimes: PeriodTime[];
  courses: PlannedCourse[];
  warnings: string[];
  /** 课程数 / 时段数 / 将要创建的重复日程数 */
  totals: { courses: number; slots: number; series: number };
}

export const COURSE_COLORS = [
  "#6366F1",
  "#0EA5E9",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#EC4899",
  "#8B5CF6",
  "#14B8A6",
  "#F97316",
  "#64748B",
] as const;

export function courseColor(index: number): string {
  const palette = COURSE_COLORS;
  return palette[index % palette.length] as string;
}

/**
 * 把解析结果变成「可直接落库的课程 + 周重复日程」。
 *
 * 纯函数：不读设置、不写库，输入相同则输出相同，便于单测与预览。
 */
export function buildTimetablePlan(
  parsed: ParsedTimetable,
  options: { semesterStart: string; periodTimes?: readonly PeriodTime[] },
): TimetableImportPlan {
  const periodTimes = normalizePeriodTimes(options.periodTimes ?? DEFAULT_PERIOD_TIMES);
  const warnings = [...parsed.warnings];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.semesterStart)) {
    warnings.push("没有填写学期第 1 周周一的日期，无法生成日程");
    return {
      semesterStart: options.semesterStart,
      periodTimes,
      courses: [],
      warnings,
      totals: { courses: 0, slots: 0, series: 0 },
    };
  }

  const courses: PlannedCourse[] = parsed.courses.map((course, index) => {
    const slots: PlannedSlot[] = course.slots.map((slot) => {
      const window = resolvePeriodWindow(periodTimes, slot.startPeriod, slot.endPeriod);
      const series: PlannedSeries[] = splitWeekRuns(slot.weeks).map((run) => {
        const firstWeek = run[0] as number;
        const lastWeek = run[run.length - 1] as number;
        const step = run.length >= 2 ? (run[1] as number) - firstWeek : 1;
        const firstDay = weekdayDateAt(options.semesterStart, firstWeek, slot.weekday);
        const lastDay = weekdayDateAt(options.semesterStart, lastWeek, slot.weekday);
        const startAt = combineDayAndTime(firstDay, window.start);
        const endAt = combineDayAndTime(firstDay, window.end);
        const token = weekdayToken(slot.weekday);
        const rrule =
          run.length === 1
            ? null
            : `FREQ=WEEKLY${step > 1 ? `;INTERVAL=${step}` : ""};BYDAY=${token};UNTIL=${rruleUntilLiteral(
                combineDayAndTime(lastDay, window.start),
              )}`;
        return {
          weeks: run,
          startAt,
          endAt,
          rrule,
          key: `${token}${slot.startPeriod}-${slot.endPeriod}w${firstWeek}`,
        };
      });
      return { ...slot, series };
    });

    const weeks = course.slots.flatMap((slot) => slot.weeks);
    return {
      name: course.name,
      code: course.code,
      teacher: course.teacher,
      color: courseColor(index),
      slots,
      maxWeek: weeks.length > 0 ? Math.max(...weeks) : 0,
    };
  });

  return {
    semesterStart: options.semesterStart,
    periodTimes,
    courses,
    warnings,
    totals: {
      courses: courses.length,
      slots: courses.reduce((sum, course) => sum + course.slots.length, 0),
      series: courses.reduce(
        (sum, course) => sum + course.slots.reduce((slotSum, slot) => slotSum + slot.series.length, 0),
        0,
      ),
    },
  };
}

/* -------------------------------------------------------------------------- */
/*                             课程 → Task 映射                                */
/* -------------------------------------------------------------------------- */

export interface CourseTaskDraft {
  title: string;
  notes: string;
  kind: "task" | "event";
  status: "todo";
  quadrant: 1 | 2 | 3 | 4;
  allDay: boolean;
  startAt: number | null;
  endAt: number | null;
  dueAt: number | null;
  location: string;
  tags: string[];
  goalId: string | null;
  source: "import" | "ai" | "manual";
  /** 提前多少分钟提醒；上线/考核的默认值见下面的三个 builder */
  remindOffsets: number[];
}

/**
 * 考核项/作业的默认提醒提前量：12 小时。
 *
 * 只写日期时 dueAt 是当天 23:59:59.999，如果按 0 分钟提醒就是「23:59 才提醒今天截止」，
 * 等于没提醒；提前 12 小时能把提示落在当天中午。
 */
export const COURSE_TASK_REMIND_MIN = 12 * 60;

/** 上课提醒：提前 10 分钟。 */
export const CLASS_REMIND_MIN = 10;

type CourseRef = Pick<Course, "id" | "name" | "teacher" | "goalId">;

/** 上课时段 → 一条带 rrule 的 event 任务（不进四象限的待办池，日历上显示成时间块）。 */
export function classTaskDraft(
  course: CourseRef,
  series: PlannedSeries,
  slot: Pick<TimetableSlot, "location" | "startPeriod" | "endPeriod">,
  options: { source?: CourseTaskDraft["source"] } = {},
): CourseTaskDraft {
  return {
    title: course.name,
    notes: [course.teacher, describePeriods(slot.startPeriod, slot.endPeriod), describeWeeks(series.weeks)]
      .filter(Boolean)
      .join(" · "),
    kind: "event",
    status: "todo",
    quadrant: 2,
    allDay: false,
    startAt: series.startAt,
    endAt: series.endAt,
    dueAt: null,
    location: slot.location,
    tags: classTags(course.id, series.key),
    goalId: course.goalId ?? null,
    source: options.source ?? "import",
    remindOffsets: [CLASS_REMIND_MIN],
  };
}

export function classTags(courseId: string, slotKey: string): string[] {
  return ["课程", `course:${courseId}`, `slot:${slotKey}`];
}

const ASSESSMENT_KIND_LABEL: Record<AssessmentKind, string> = {
  homework: "作业",
  project: "大作业",
  exam: "考试",
  quiz: "小测验",
  attendance: "考勤",
  other: "其他",
};

export function assessmentKindLabel(kind: AssessmentKind): string {
  return ASSESSMENT_KIND_LABEL[kind] ?? kind;
}

/** 考核项 → Task。标题带课程前缀，提醒/日历才有上下文。 */
export function assessmentTaskDraft(
  course: CourseRef,
  assessment: Pick<Assessment, "id" | "title" | "kind" | "weight" | "dueAt" | "startAt" | "note">,
  options: { source?: CourseTaskDraft["source"] } = {},
): CourseTaskDraft {
  const startAt = assessment.startAt ?? null;
  const dueAt = assessment.dueAt ?? null;
  const notes = [
    `${course.name} · ${assessmentKindLabel(assessment.kind)}`,
    `占总评 ${assessment.weight}%`,
    assessment.note,
  ]
    .filter((part) => part && part.length > 0)
    .join("\n");

  return {
    title: `[${course.name}] ${assessment.title}`,
    notes,
    kind: "task",
    status: "todo",
    quadrant: assessment.kind === "exam" ? 1 : 2,
    allDay: startAt === null && dueAt === null,
    startAt,
    endAt: startAt === null ? null : startAt + 2 * HOUR,
    dueAt: dueAt ?? startAt,
    location: "",
    tags: ["课程", `course:${course.id}`, "考核", assessmentKindLabel(assessment.kind)],
    goalId: course.goalId ?? null,
    source: options.source ?? "manual",
    remindOffsets: [COURSE_TASK_REMIND_MIN],
  };
}

/** 每周作业 → Task。 */
export function assignmentTaskDraft(
  course: CourseRef,
  assignment: Pick<Assignment, "title" | "weekNo" | "dueAt" | "note">,
  options: { source?: CourseTaskDraft["source"] } = {},
): CourseTaskDraft {
  return {
    title: `[${course.name}] ${assignment.title}`,
    notes: [`第 ${assignment.weekNo} 周作业`, assignment.note].filter((part) => part.length > 0).join("\n"),
    kind: "task",
    status: "todo",
    quadrant: 2,
    allDay: assignment.dueAt === null,
    startAt: null,
    endAt: null,
    dueAt: assignment.dueAt,
    location: "",
    tags: ["课程", `course:${course.id}`, "作业", `第${assignment.weekNo}周`],
    goalId: course.goalId ?? null,
    source: options.source ?? "manual",
    remindOffsets: [COURSE_TASK_REMIND_MIN],
  };
}

/* -------------------------------------------------------------------------- */
/*                              权重 / 遗漏判定                                 */
/* -------------------------------------------------------------------------- */

export interface WeightBucket {
  kind: AssessmentKind;
  weight: number;
  count: number;
}

export interface WeightSummary {
  /** 已记录的权重合计（不截断，可能 > 100，由 UI 标黄） */
  total: number;
  /** 距离 100% 还差多少（≥0） */
  remaining: number;
  /** 超出的百分点（total > 100 时 > 0） */
  overflow: number;
  count: number;
  byKind: WeightBucket[];
}

function roundWeight(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 考核构成汇总：总计、按类型分桶、剩余未记录。 */
export function summarizeWeights(
  assessments: ReadonlyArray<Pick<Assessment, "kind" | "weight">>,
): WeightSummary {
  const buckets = new Map<AssessmentKind, WeightBucket>();
  let total = 0;
  for (const item of assessments) {
    const weight = Number.isFinite(item.weight) ? Math.max(0, item.weight) : 0;
    total += weight;
    const bucket = buckets.get(item.kind) ?? { kind: item.kind, weight: 0, count: 0 };
    bucket.weight += weight;
    bucket.count += 1;
    buckets.set(item.kind, bucket);
  }
  const roundedTotal = roundWeight(total);
  return {
    total: roundedTotal,
    remaining: Math.max(0, roundWeight(100 - roundedTotal)),
    overflow: Math.max(0, roundWeight(roundedTotal - 100)),
    count: assessments.length,
    byKind: [...buckets.values()]
      .map((bucket) => ({ ...bucket, weight: roundWeight(bucket.weight) }))
      .sort((left, right) => right.weight - left.weight),
  };
}

export interface HomeworkGap {
  course: Course;
  weekNo: number;
}

/**
 * 遗漏判定：`weeklyHomework=true` 的课，在「当前周」没有 Assignment 记录。
 *
 * 注意 skipped 也算「记过」：用户明确跳过这一周，就不该再被提醒。
 */
export function findHomeworkGaps(
  courses: readonly Course[],
  assignments: readonly Assignment[],
  at: number,
  fallbackSemesterStart?: string | null,
): HomeworkGap[] {
  const gaps: HomeworkGap[] = [];
  const recorded = new Set(assignments.map((item) => `${item.courseId}::${item.weekNo}`));

  for (const course of courses) {
    if (course.archived || !course.weeklyHomework) continue;
    const weekNo = courseWeekNo(course.semesterStart ?? fallbackSemesterStart ?? null, at);
    if (weekNo === null || weekNo < 1) continue;
    if (recorded.has(`${course.id}::${weekNo}`)) continue;
    gaps.push({ course, weekNo });
  }
  return gaps.sort((left, right) => left.course.name.localeCompare(right.course.name, "zh-CN"));
}

/** 某门课在某一周已有的作业（按 dueAt / 创建时间排序）。 */
export function assignmentsOfWeek(
  assignments: readonly Assignment[],
  courseId: string,
  weekNo: number,
): Assignment[] {
  return assignments
    .filter((item) => item.courseId === courseId && item.weekNo === weekNo)
    .sort((left, right) => (left.dueAt ?? left.createdAt) - (right.dueAt ?? right.createdAt));
}

/* -------------------------------------------------------------------------- */
/*                              MCP 参数的宽松解析                             */
/* -------------------------------------------------------------------------- */

/**
 * 宽松日期解析（给 AI 用）：
 *   `2026-12-01`            → 当天 00:00（endOfDay 时为 23:59:59.999）
 *   `2026-12-01 14:00`      → 本地时间
 *   `2026-12-01T14:00:00Z`  → 带时区的 ISO
 *   1764547200000           → 毫秒时间戳
 *   1764547200              → 十位秒级时间戳（AI 常发这个）
 */
export function parseLooseDate(raw: unknown, options: { endOfDay?: boolean } = {}): number | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    const value = Math.trunc(raw);
    if (value >= 1e11) return value;
    if (value >= 1e9) return value * 1000;
    return null;
  }
  if (typeof raw !== "string") return null;

  const text = raw.trim();
  if (!text) return null;

  const dateOnly = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const base = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0).getTime();
    return Number.isFinite(base) ? (options.endOfDay ? base + DAY - 1 : base) : null;
  }

  const localDateTime = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (localDateTime) {
    const [, year, month, day, hour, minute, second] = localDateTime;
    const base = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second ?? 0),
      0,
    ).getTime();
    return Number.isFinite(base) ? base : null;
  }

  // 带 Z / 时区偏移的 ISO 交给 Date.parse（语义明确，不存在本地时区歧义）
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) {
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const fallback = Date.parse(text);
  return Number.isFinite(fallback) ? fallback : null;
}

/**
 * 宽松权重解析：`20%` / `20` / `20分` / 20 → 20；超出 0..100 时夹到边界。
 * 无法解析返回 null（由调用方报参数错误，不静默写 0）。
 */
export function parseLooseWeight(raw: unknown): number | null {
  let value: number | null = null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    value = raw;
  } else if (typeof raw === "string") {
    // 全角数字与全角百分号：AI 从截图里抄下来时很常见
    const normalized = raw
      .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
      .replace(/[．]/g, ".")
      .replace(/[％%分\s]/g, "");
    const match = /-?\d+(?:\.\d+)?/.exec(normalized);
    if (match) {
      const parsed = Number(match[0]);
      if (Number.isFinite(parsed)) value = parsed;
    }
  }
  if (value === null) return null;
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

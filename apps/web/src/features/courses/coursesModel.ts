import {
  DEFAULT_HOMEWORK_REMINDER,
  DEFAULT_PERIOD_TIMES,
  dayKey,
  findHomeworkGaps,
  normalizeHomeworkReminder,
  normalizePeriodTimes,
  startOfWeek,
  summarizeWeights,
  courseWeekNo,
  type Assessment,
  type AssessmentKind,
  type Assignment,
  type Course,
  type HomeworkReminderConfig,
  type PeriodTime,
  type WeightSummary,
} from "@detter/shared";

/**
 * /courses 的纯逻辑层。
 *
 * 页面上的所有派生数字（权重合计、本周是否记了作业、排序）都在这里算，
 * 组件只负责渲染。这样这些规则可以被单测覆盖，也方便将来搬到服务端。
 */

export interface CourseCardModel {
  course: Course;
  weekNo: number | null;
  weight: WeightSummary;
  assessmentCount: number;
  /** 本周已记的作业（可能是多条） */
  thisWeekAssignments: Assignment[];
  homeworkMissing: boolean;
  /** 最近一次有日期的考核项，用于卡片上的一行提示 */
  nextAssessment: { title: string; kind: AssessmentKind; at: number | null; weight: number } | null;
}

/** 某个时间点所在周的周一日期键（导入时的默认学期起点）。 */
export function defaultSemesterStart(now: number): string {
  return dayKey(startOfWeek(now));
}

/** 从 settings 行里解析课表设置（坏值一律回落到默认）。 */
export function readCourseSettings(values: {
  semesterStart?: unknown;
  periodTimes?: unknown;
  homeworkReminder?: unknown;
}): {
  semesterStart: string | null;
  periodTimes: PeriodTime[];
  homeworkReminder: HomeworkReminderConfig;
} {
  const rawSemester = values.semesterStart;
  return {
    semesterStart:
      typeof rawSemester === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawSemester) ? rawSemester : null,
    periodTimes: normalizePeriodTimes(values.periodTimes ?? DEFAULT_PERIOD_TIMES),
    homeworkReminder: normalizeHomeworkReminder(values.homeworkReminder ?? DEFAULT_HOMEWORK_REMINDER),
  };
}

/** 把三张表拼成卡片模型（按设置里的 sortIndex / 名称排序）。 */
export function buildCourseCards(
  courses: readonly Course[],
  assessments: readonly Assessment[],
  assignments: readonly Assignment[],
  now: number,
  fallbackSemesterStart: string | null,
): CourseCardModel[] {
  const byCourse = new Map<string, Assessment[]>();
  for (const item of assessments) {
    const list = byCourse.get(item.courseId) ?? [];
    list.push(item);
    byCourse.set(item.courseId, list);
  }
  const gaps = new Map(
    findHomeworkGaps([...courses], [...assignments], now, fallbackSemesterStart).map((gap) => [
      gap.course.id,
      gap.weekNo,
    ]),
  );

  return [...courses]
    .filter((course) => !course.archived)
    .sort((left, right) => left.sortIndex - right.sortIndex || left.name.localeCompare(right.name, "zh-CN"))
    .map((course) => {
      const list = byCourse.get(course.id) ?? [];
      const semesterStart = course.semesterStart ?? fallbackSemesterStart;
      const weekNo = courseWeekNo(semesterStart, now);
      const thisWeek = weekNo === null ? [] : assignments.filter((item) => item.courseId === course.id && item.weekNo === weekNo);
      const dated = list
        .filter((item) => (item.dueAt ?? item.startAt) !== null)
        .sort((left, right) => (left.dueAt ?? left.startAt ?? 0) - (right.dueAt ?? right.startAt ?? 0));
      const next = dated.find((item) => (item.dueAt ?? item.startAt ?? 0) >= now) ?? null;

      return {
        course,
        weekNo,
        weight: summarizeWeights(list),
        assessmentCount: list.length,
        thisWeekAssignments: thisWeek,
        homeworkMissing: gaps.has(course.id),
        nextAssessment: next
          ? {
              title: next.title,
              kind: next.kind,
              at: next.dueAt ?? next.startAt,
              weight: next.weight,
            }
          : null,
      };
    });
}

/** 顶部「这周有 N 门课还没记作业」的数据源。 */
export function weekOverview(cards: readonly CourseCardModel[]): {
  missing: CourseCardModel[];
  missingCount: number;
  weekNo: number | null;
} {
  const missing = cards.filter((card) => card.homeworkMissing);
  return {
    missing,
    missingCount: missing.length,
    weekNo: missing[0]?.weekNo ?? cards.find((card) => card.weekNo !== null)?.weekNo ?? null,
  };
}

export type WeightStatus = "empty" | "partial" | "full" | "over";

/** 权重条的状态：空 / 未满 / 刚好 100 / 超过 100（超过要标黄）。 */
export function weightStatus(summary: WeightSummary): WeightStatus {
  if (summary.count === 0 || summary.total === 0) return "empty";
  if (summary.total > 100) return "over";
  if (summary.total === 100) return "full";
  return "partial";
}

export function weightStatusLabel(summary: WeightSummary): string {
  const status = weightStatus(summary);
  if (status === "empty") return "还没记录考核项";
  if (status === "over") return `超出 ${summary.overflow}%`;
  if (status === "full") return "已覆盖 100%";
  return `已记录 ${summary.total}%`;
}

/** 按截止时间排序的考核项；没有日期的排在最后。 */
export function sortedAssessments(assessments: readonly Assessment[]): Assessment[] {
  return [...assessments].sort((left, right) => {
    const a = left.dueAt ?? left.startAt ?? Number.POSITIVE_INFINITY;
    const b = right.dueAt ?? right.startAt ?? Number.POSITIVE_INFINITY;
    if (a !== b) return a - b;
    return left.title.localeCompare(right.title, "zh-CN");
  });
}

export interface AssignmentWeekGroup {
  weekNo: number;
  items: Assignment[];
  isCurrent: boolean;
}

/** 按周分组（倒序：最近的周在上），并标出本周。 */
export function groupAssignmentsByWeek(
  assignments: readonly Assignment[],
  currentWeek: number | null,
): AssignmentWeekGroup[] {
  const groups = new Map<number, Assignment[]>();
  for (const item of assignments) {
    const list = groups.get(item.weekNo) ?? [];
    list.push(item);
    groups.set(item.weekNo, list);
  }
  return [...groups.entries()]
    .map(([weekNo, items]) => ({
      weekNo,
      items: [...items].sort((left, right) => (left.dueAt ?? left.createdAt) - (right.dueAt ?? right.createdAt)),
      isCurrent: currentWeek !== null && weekNo === currentWeek,
    }))
    .sort((left, right) => right.weekNo - left.weekNo);
}

/** 详情页的周列表：从第 1 周到本周（含），保证「缺的那几周」也看得见。 */
export function weeksUpToCurrent(currentWeek: number | null): number[] {
  if (currentWeek === null || currentWeek < 1) return [];
  return Array.from({ length: Math.min(currentWeek, 60) }, (_, index) => index + 1);
}

export const ASSESSMENT_KIND_LABEL: Record<AssessmentKind, string> = {
  homework: "作业",
  project: "大作业",
  exam: "考试",
  quiz: "小测验",
  attendance: "考勤",
  other: "其他",
};

/** 权重条按类型分色：颜色全部来自设计令牌（tokens.css），深浅色主题自动跟随。 */
export const ASSESSMENT_KIND_COLOR: Record<AssessmentKind, string> = {
  exam: "var(--danger)",
  project: "var(--accent)",
  homework: "var(--info)",
  quiz: "var(--warning)",
  attendance: "var(--success)",
  other: "var(--ink-300)",
};

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export function assessmentKindTone(kind: AssessmentKind): BadgeTone {
  switch (kind) {
    case "exam":
      return "danger";
    case "project":
      return "accent";
    case "homework":
      return "info";
    case "quiz":
      return "warning";
    case "attendance":
      return "success";
    default:
      return "neutral";
  }
}

export function assessmentStatusLabel(status: Assessment["status"]): string {
  switch (status) {
    case "planned":
      return "未开始";
    case "submitted":
      return "已提交";
    case "done":
      return "已完成";
    case "graded":
      return "已出分";
    default:
      return status;
  }
}

export function assignmentStatusLabel(status: Assignment["status"]): string {
  switch (status) {
    case "todo":
      return "待做";
    case "done":
      return "已完成";
    case "skipped":
      return "已跳过";
    default:
      return status;
  }
}

/** 卡片副标题：教师 · 学分 · 周次。空项自动省略。 */
export function courseSubtitle(card: Pick<CourseCardModel, "course" | "weekNo">): string {
  return [
    card.course.teacher,
    card.course.credits === null ? "" : `${card.course.credits} 学分`,
    card.weekNo === null ? "" : `第 ${card.weekNo} 周`,
  ]
    .filter((part) => part.length > 0)
    .join(" · ");
}

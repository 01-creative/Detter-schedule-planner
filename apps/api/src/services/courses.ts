import {
  COURSE_SETTING_KEYS,
  assessmentTaskDraft,
  assignmentTaskDraft,
  courseWeekNo,
  findHomeworkGaps,
  parseLooseDate,
  parseLooseWeight,
  summarizeWeights,
  type AssessmentKind,
  type AssessmentStatus,
  type Assessment,
  type Assignment,
  type AssignmentStatus,
  type Course,
  type WeightSummary,
} from "@detter/shared";
import type { Db } from "../db/types";
import { ApiError } from "../lib/errors";
import { uuidv7 } from "../lib/ids";
import { createEntity, listPayloads, readPayload, softDeleteEntity, updateEntity } from "../repo/crud";
import { readSettingValues, writeSettings } from "../repo/settings";

/**
 * 课程服务：把「课程 / 考核项 / 每周作业」翻译成「课程实体 + 真实 Task」。
 *
 * 三条约束（也是与 01-DATA-MODEL 的约定）：
 * 1. 提醒调度、日历、四象限只认 Task —— 所以考核项与作业必须生成 Task，
 *    并把 taskId 写回实体；没有 Task 的记录是「计划」，不会出现在日程里。
 * 2. Task 的标题统一带 `[课程名]` 前缀，goalId 继承课程的 goalId（没关联目标就留空）。
 * 3. 所有写入都走 repo 层（createEntity / updateEntity），不在这里写第二套 SQL，
 *    这样同步日志、rev、投影列的行为与 REST/同步完全一致。
 */

type JsonObject = Record<string, unknown>;

export interface CourseServiceContext {
  db: Db;
  userId: string;
  now: number;
}

export interface CourseSummary {
  id: string;
  name: string;
  code: string;
  teacher: string;
  credits: number | null;
  color: string;
  archived: boolean;
  weeklyHomework: boolean;
  semesterStart: string | null;
  weekNo: number | null;
  assessmentCount: number;
  weight: WeightSummary;
  thisWeekAssignments: number;
  homeworkMissing: boolean;
  nextAssessment: { title: string; kind: AssessmentKind; dueAt: number | null; weight: number } | null;
  goalId: string | null;
}

/* -------------------------------------------------------------------------- */
/*                                 读取                                        */
/* -------------------------------------------------------------------------- */

function asCourse(payload: JsonObject): Course {
  return payload as unknown as Course;
}

function asAssessment(payload: JsonObject): Assessment {
  return payload as unknown as Assessment;
}

function asAssignment(payload: JsonObject): Assignment {
  return payload as unknown as Assignment;
}

/** 列表默认不含归档课程；显式 includeArchived 时才包含。 */
export async function listCourses(
  ctx: CourseServiceContext,
  options: { includeArchived?: boolean } = {},
): Promise<Course[]> {
  const { items } = await listPayloads(ctx.db, "course", ctx.userId, {
    limit: 500,
    // 默认只看在用的课；includeArchived 时显式告诉仓储「别加 archived=0 的默认条件」
    query: options.includeArchived ? { includeArchived: "true" } : { archived: "false" },
  });
  return items
    .map(asCourse)
    .sort((left, right) => left.sortIndex - right.sortIndex || left.name.localeCompare(right.name, "zh-CN"));
}

export async function listAssessments(
  ctx: CourseServiceContext,
  courseId?: string,
): Promise<Assessment[]> {
  const { items } = await listPayloads(ctx.db, "assessment", ctx.userId, {
    limit: 500,
    query: courseId ? { courseId } : {},
  });
  return items.map(asAssessment);
}

export async function listAssignments(
  ctx: CourseServiceContext,
  options: { courseId?: string; weekNo?: number } = {},
): Promise<Assignment[]> {
  const query: Record<string, string> = {};
  if (options.courseId) query.courseId = options.courseId;
  if (options.weekNo !== undefined) query.weekNo = String(options.weekNo);
  const { items } = await listPayloads(ctx.db, "assignment", ctx.userId, { limit: 500, query });
  return items.map(asAssignment);
}

export async function readCourse(ctx: CourseServiceContext, courseId: string): Promise<Course> {
  const payload = await readPayload(ctx.db, "course", ctx.userId, courseId);
  if (!payload) throw ApiError.notFound("课程不存在");
  return asCourse(payload);
}

/* -------------------------------------------------------------------------- */
/*                              学期起点 / 查找                                 */
/* -------------------------------------------------------------------------- */

/** 课程自己的学期起点优先，其次全局设置；都没有时返回 null（无法判断第几周）。 */
export async function resolveSemesterStart(
  ctx: CourseServiceContext,
  course?: Pick<Course, "semesterStart"> | null,
): Promise<string | null> {
  const fromCourse = course?.semesterStart ?? null;
  if (fromCourse) return fromCourse;
  const values = await readSettingValues(ctx.db, ctx.userId, [COURSE_SETTING_KEYS.semesterStart]);
  const raw = values[COURSE_SETTING_KEYS.semesterStart];
  return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/** 名称归一化：去空白、全角括号转半角、忽略大小写。用于「按课程名找课」。 */
function normalizeName(value: string): string {
  return value
    .replace(/\s+/g, "")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .toLowerCase();
}

export function findCourseByName(courses: readonly Course[], name: string): Course | null {
  const target = normalizeName(name);
  if (!target) return null;
  const exact = courses.find((course) => normalizeName(course.name) === target);
  if (exact) return exact;
  // 容错：AI 可能只说了「英语」而课程叫「学术英语写作」
  const partial = courses.find(
    (course) => normalizeName(course.name).includes(target) || target.includes(normalizeName(course.name)),
  );
  return partial ?? null;
}

export interface EnsureCourseResult {
  course: Course;
  created: boolean;
}

/**
 * 解析课程：ID 优先，其次按名字找；找不到就自动建。
 *
 * 「自动建」是给 MCP 的容错能力：用户把 PPT 拍照发给 AI，AI 只认得课程名，
 * 不该因为课程没建过就失败。新课程默认 `weeklyHomework = false`（不制造假的遗漏提醒）。
 */
export async function ensureCourse(
  ctx: CourseServiceContext,
  input: { courseId?: string | null; courseName?: string | null; weeklyHomework?: boolean },
): Promise<EnsureCourseResult> {
  if (input.courseId) {
    return { course: await readCourse(ctx, input.courseId), created: false };
  }
  const name = (input.courseName ?? "").trim();
  if (!name) {
    throw new ApiError("validation_error", "需要提供 courseId 或课程名（course）");
  }

  const existing = findCourseByName(await listCourses(ctx, { includeArchived: true }), name);
  if (existing) {
    // 之前自动建过、但现在被归档了：本次写入顺带复活，避免「看得见考核项却看不到课程」
    if (existing.archived) {
      const revived = await updateEntity(ctx.db, "course", ctx.userId, existing.id, { archived: false }, ctx.now);
      return { course: asCourse(revived ?? ({ ...existing, archived: false } as unknown as JsonObject)), created: false };
    }
    return { course: existing, created: false };
  }

  const created = await createEntity(ctx.db, "course", ctx.userId, {
    input: { name, weeklyHomework: input.weeklyHomework === true, deviceId: "" },
    deviceId: "",
    now: ctx.now,
  });
  return { course: asCourse(created), created: true };
}

/* -------------------------------------------------------------------------- */
/*                             考核项 / 作业：写                                */
/* -------------------------------------------------------------------------- */

export interface AssessmentInput {
  title: string;
  kind?: AssessmentKind;
  /** 0..100，已由调用方用 parseLooseWeight 归一化 */
  weight?: number;
  dueAt?: number | null;
  startAt?: number | null;
  note?: string;
  status?: AssessmentStatus;
  score?: number | null;
}

async function createTaskForAssessment(
  ctx: CourseServiceContext,
  course: Course,
  assessment: Pick<Assessment, "id" | "title" | "kind" | "weight" | "dueAt" | "startAt" | "note">,
  source: "ai" | "import" | "manual",
): Promise<JsonObject> {
  const draft = assessmentTaskDraft(course, assessment, { source });
  return createEntity(ctx.db, "task", ctx.userId, {
    input: { ...draft, deviceId: "" },
    deviceId: "",
    now: ctx.now,
  });
}

/** 新建考核项 + 它对应的 Task。返回两者，调用方决定怎么展示。 */
export async function createAssessment(
  ctx: CourseServiceContext,
  course: Course,
  input: AssessmentInput,
  options: { source?: "ai" | "import" | "manual" } = {},
): Promise<{ assessment: Assessment; task: JsonObject }> {
  const id = uuidv7(ctx.now);
  const title = input.title.trim();
  if (!title) throw new ApiError("validation_error", "考核项名称不能为空");
  const weight = input.weight ?? 0;
  const kind = input.kind ?? "homework";

  const task = await createTaskForAssessment(
    ctx,
    course,
    {
      id,
      title,
      kind,
      weight,
      dueAt: input.dueAt ?? null,
      startAt: input.startAt ?? null,
      note: input.note ?? "",
    },
    options.source ?? "manual",
  );

  const payload = await createEntity(ctx.db, "assessment", ctx.userId, {
    input: {
      id,
      courseId: course.id,
      title,
      kind,
      weight,
      dueAt: input.dueAt ?? null,
      startAt: input.startAt ?? null,
      note: input.note ?? "",
      status: input.status ?? "planned",
      score: input.score ?? null,
      taskId: String(task.id),
      deviceId: "",
    },
    deviceId: "",
    now: ctx.now,
  });

  return { assessment: asAssessment(payload), task };
}

export interface AssessmentPatch {
  title?: string;
  kind?: AssessmentKind;
  weight?: number;
  dueAt?: number | null;
  startAt?: number | null;
  note?: string;
  status?: AssessmentStatus;
  score?: number | null;
  courseId?: string;
}

/**
 * 修改考核项，并把变更同步到它的 Task。
 *
 * Task 已经被删除（或从没建过）时重新建一条：这样「编辑一下」也能顺手把日程补回来，
 * 比让用户再点一次「一键生成日程」更符合直觉。
 */
export async function updateAssessment(
  ctx: CourseServiceContext,
  assessmentId: string,
  patch: AssessmentPatch,
  options: { source?: "ai" | "import" | "manual" } = {},
): Promise<{ assessment: Assessment; task: JsonObject | null; taskCreated: boolean }> {
  const current = await readPayload(ctx.db, "assessment", ctx.userId, assessmentId);
  if (!current) throw ApiError.notFound("考核项不存在");

  const next = await updateEntity(ctx.db, "assessment", ctx.userId, assessmentId, patch, ctx.now);
  if (!next) throw ApiError.notFound("考核项不存在");
  const assessment = asAssessment(next);

  const course = await readCourse(ctx, assessment.courseId);
  const draft = assessmentTaskDraft(course, assessment, { source: options.source ?? "manual" });

  if (assessment.taskId) {
    const updated = await updateEntity(ctx.db, "task", ctx.userId, assessment.taskId, draft, ctx.now);
    if (updated) return { assessment, task: updated, taskCreated: false };
  }

  const task = await createTaskForAssessment(ctx, course, assessment, options.source ?? "manual");
  const relinked = await updateEntity(
    ctx.db,
    "assessment",
    ctx.userId,
    assessmentId,
    { taskId: String(task.id) },
    ctx.now,
  );
  return {
    assessment: asAssessment(relinked ?? { ...next, taskId: task.id }),
    task,
    taskCreated: true,
  };
}

/** 「一键生成日程」：已有 Task 就更新，没有就新建（幂等，可重复点）。 */
export async function syncAssessmentTask(
  ctx: CourseServiceContext,
  assessmentId: string,
): Promise<{ assessment: Assessment; task: JsonObject; created: boolean }> {
  const current = await readPayload(ctx.db, "assessment", ctx.userId, assessmentId);
  if (!current) throw ApiError.notFound("考核项不存在");
  const assessment = asAssessment(current);
  const course = await readCourse(ctx, assessment.courseId);
  const draft = assessmentTaskDraft(course, assessment, { source: "manual" });

  if (assessment.taskId) {
    const updated = await updateEntity(ctx.db, "task", ctx.userId, assessment.taskId, draft, ctx.now);
    if (updated) return { assessment, task: updated, created: false };
  }

  const task = await createTaskForAssessment(ctx, course, assessment, "manual");
  const relinked = await updateEntity(
    ctx.db,
    "assessment",
    ctx.userId,
    assessmentId,
    { taskId: String(task.id) },
    ctx.now,
  );
  return { assessment: asAssessment(relinked ?? { ...current, taskId: task.id }), task, created: true };
}

export interface AssignmentInput {
  title: string;
  weekNo?: number;
  dueAt?: number | null;
  note?: string;
  status?: AssignmentStatus;
}

async function createTaskForAssignment(
  ctx: CourseServiceContext,
  course: Course,
  assignment: Pick<Assignment, "title" | "weekNo" | "dueAt" | "note">,
  source: "ai" | "import" | "manual",
): Promise<JsonObject> {
  const draft = assignmentTaskDraft(course, assignment, { source });
  return createEntity(ctx.db, "task", ctx.userId, {
    input: { ...draft, deviceId: "" },
    deviceId: "",
    now: ctx.now,
  });
}

export async function createAssignment(
  ctx: CourseServiceContext,
  course: Course,
  input: AssignmentInput,
  options: { source?: "ai" | "import" | "manual" } = {},
): Promise<{ assignment: Assignment; task: JsonObject }> {
  const title = input.title.trim();
  if (!title) throw new ApiError("validation_error", "作业标题不能为空");
  let weekNo = input.weekNo;
  if (weekNo === undefined) {
    const semesterStart = await resolveSemesterStart(ctx, course);
    const current = courseWeekNo(semesterStart, ctx.now);
    if (current === null) {
      throw new ApiError("validation_error", "这门课没有学期起点，请提供 weekNo 或先设置学期第 1 周");
    }
    weekNo = current;
  }

  const id = uuidv7(ctx.now);
  const task = await createTaskForAssignment(
    ctx,
    course,
    { title, weekNo, dueAt: input.dueAt ?? null, note: input.note ?? "" },
    options.source ?? "manual",
  );

  const payload = await createEntity(ctx.db, "assignment", ctx.userId, {
    input: {
      id,
      courseId: course.id,
      weekNo,
      title,
      dueAt: input.dueAt ?? null,
      status: input.status ?? "todo",
      note: input.note ?? "",
      taskId: String(task.id),
      deviceId: "",
    },
    deviceId: "",
    now: ctx.now,
  });

  return { assignment: asAssignment(payload), task };
}

export interface AssignmentPatch {
  title?: string;
  weekNo?: number;
  dueAt?: number | null;
  note?: string;
  status?: AssignmentStatus;
}

export async function updateAssignment(
  ctx: CourseServiceContext,
  assignmentId: string,
  patch: AssignmentPatch,
): Promise<{ assignment: Assignment; task: JsonObject | null }> {
  const next = await updateEntity(ctx.db, "assignment", ctx.userId, assignmentId, patch, ctx.now);
  if (!next) throw ApiError.notFound("作业不存在");
  const assignment = asAssignment(next);
  const course = await readCourse(ctx, assignment.courseId);
  const draft = assignmentTaskDraft(course, assignment, { source: "manual" });

  if (assignment.taskId) {
    const updated = await updateEntity(ctx.db, "task", ctx.userId, assignment.taskId, draft, ctx.now);
    if (updated) return { assignment, task: updated };
  }
  const task = await createTaskForAssignment(ctx, course, assignment, "manual");
  const relinked = await updateEntity(
    ctx.db,
    "assignment",
    ctx.userId,
    assignmentId,
    { taskId: String(task.id) },
    ctx.now,
  );
  return { assignment: asAssignment(relinked ?? { ...next, taskId: task.id }), task };
}

/* -------------------------------------------------------------------------- */
/*                                  删除                                       */
/* -------------------------------------------------------------------------- */

/** 课程级联删除：考核项 / 作业 / 它们生成的 Task 一起软删，避免留下孤儿日程。 */
export async function deleteAssessment(
  ctx: CourseServiceContext,
  assessmentId: string,
): Promise<{ id: string; taskDeleted: boolean }> {
  const payload = await readPayload(ctx.db, "assessment", ctx.userId, assessmentId);
  if (!payload) throw ApiError.notFound("考核项不存在");
  const assessment = asAssessment(payload);
  const deleted = await softDeleteEntity(ctx.db, "assessment", ctx.userId, assessmentId, ctx.now);
  let taskDeleted = false;
  if (assessment.taskId && deleted) {
    const task = await softDeleteEntity(ctx.db, "task", ctx.userId, assessment.taskId, ctx.now);
    taskDeleted = task !== null;
  }
  return { id: assessmentId, taskDeleted };
}

export async function deleteAssignment(
  ctx: CourseServiceContext,
  assignmentId: string,
): Promise<{ id: string; taskDeleted: boolean }> {
  const payload = await readPayload(ctx.db, "assignment", ctx.userId, assignmentId);
  if (!payload) throw ApiError.notFound("作业不存在");
  const assignment = asAssignment(payload);
  const deleted = await softDeleteEntity(ctx.db, "assignment", ctx.userId, assignmentId, ctx.now);
  let taskDeleted = false;
  if (assignment.taskId && deleted) {
    const task = await softDeleteEntity(ctx.db, "task", ctx.userId, assignment.taskId, ctx.now);
    taskDeleted = task !== null;
  }
  return { id: assignmentId, taskDeleted };
}

/* -------------------------------------------------------------------------- */
/*                             汇总 / 课程计划                                  */
/* -------------------------------------------------------------------------- */

function weightInputs(assessments: readonly Assessment[]) {
  return assessments.map((item) => ({ kind: item.kind, weight: item.weight }));
}

export async function courseSummaries(
  ctx: CourseServiceContext,
  options: { includeArchived?: boolean } = {},
): Promise<CourseSummary[]> {
  const courses = await listCourses(ctx, options);
  const [assessments, assignments] = await Promise.all([listAssessments(ctx), listAssignments(ctx)]);
  const fallbackSemesterStart = await resolveSemesterStart(ctx);

  const byCourseAssessments = new Map<string, Assessment[]>();
  for (const item of assessments) {
    const list = byCourseAssessments.get(item.courseId) ?? [];
    list.push(item);
    byCourseAssessments.set(item.courseId, list);
  }
  const byCourseWeek = new Map<string, Set<number>>();
  for (const item of assignments) {
    const set = byCourseWeek.get(item.courseId) ?? new Set<number>();
    set.add(item.weekNo);
    byCourseWeek.set(item.courseId, set);
  }

  return courses.map((course) => {
    const list = byCourseAssessments.get(course.id) ?? [];
    const semesterStart = course.semesterStart ?? fallbackSemesterStart;
    const weekNo = courseWeekNo(semesterStart, ctx.now);
    const weight = summarizeWeights(weightInputs(list));
    const weeks = byCourseWeek.get(course.id) ?? new Set<number>();
    const missing = weekNo !== null && course.weeklyHomework && !course.archived && !weeks.has(weekNo);
    const upcoming = list
      .map((item) => ({ item, at: item.dueAt ?? item.startAt ?? Number.POSITIVE_INFINITY }))
      .filter((entry) => Number.isFinite(entry.at) && (entry.at as number) >= ctx.now)
      .sort((left, right) => (left.at as number) - (right.at as number))[0];

    return {
      id: course.id,
      name: course.name,
      code: course.code,
      teacher: course.teacher,
      credits: course.credits,
      color: course.color,
      archived: course.archived,
      weeklyHomework: course.weeklyHomework,
      semesterStart,
      weekNo,
      assessmentCount: list.length,
      weight,
      thisWeekAssignments: weekNo === null ? 0 : weeks.has(weekNo) ? 1 : 0,
      homeworkMissing: missing,
      nextAssessment: upcoming
        ? {
            title: upcoming.item.title,
            kind: upcoming.item.kind,
            dueAt: upcoming.item.dueAt,
            weight: upcoming.item.weight,
          }
        : null,
      goalId: course.goalId,
    };
  });
}

/** 一门课的完整计划：考核构成 + 作业历史 + 缺记的周。 */
export async function coursePlan(
  ctx: CourseServiceContext,
  courseId: string,
): Promise<{
  course: Course;
  semesterStart: string | null;
  weekNo: number | null;
  assessments: Assessment[];
  assignments: Assignment[];
  weight: WeightSummary;
  assignmentWeeks: Array<{ weekNo: number; count: number }>;
  missingWeeks: number[];
}> {
  const course = await readCourse(ctx, courseId);
  const [assessments, assignments] = await Promise.all([
    listAssessments(ctx, courseId),
    listAssignments(ctx, { courseId }),
  ]);
  const semesterStart = course.semesterStart ?? (await resolveSemesterStart(ctx, course));
  const weekNo = courseWeekNo(semesterStart, ctx.now);

  const counts = new Map<number, number>();
  for (const item of assignments) counts.set(item.weekNo, (counts.get(item.weekNo) ?? 0) + 1);
  const assignmentWeeks = [...counts.entries()]
    .map(([week, count]) => ({ weekNo: week, count }))
    .sort((left, right) => left.weekNo - right.weekNo);

  const missingWeeks: number[] = [];
  if (course.weeklyHomework && weekNo !== null) {
    for (let week = 1; week <= weekNo; week += 1) {
      if (!counts.has(week)) missingWeeks.push(week);
    }
  }

  return {
    course,
    semesterStart,
    weekNo,
    assessments: [...assessments].sort(
      (left, right) => (left.dueAt ?? left.startAt ?? 0) - (right.dueAt ?? right.startAt ?? 0),
    ),
    assignments: [...assignments].sort(
      (left, right) => left.weekNo - right.weekNo || (left.dueAt ?? 0) - (right.dueAt ?? 0),
    ),
    weight: summarizeWeights(weightInputs(assessments)),
    assignmentWeeks,
    missingWeeks,
  };
}

/** 当前周的遗漏课程（与前端展示同一套规则，见 shared/courses#findHomeworkGaps）。 */
export async function homeworkGaps(ctx: CourseServiceContext): Promise<Array<{ course: Course; weekNo: number }>> {
  const courseList = await listCourses(ctx);
  const assignments = await listAssignments(ctx);
  const fallback = await resolveSemesterStart(ctx);
  return findHomeworkGaps(courseList, assignments, ctx.now, fallback);
}

/* -------------------------------------------------------------------------- */
/*                             学期起点：写                                     */
/* -------------------------------------------------------------------------- */

export async function setSemesterStart(
  ctx: CourseServiceContext,
  date: string,
  course?: Pick<Course, "id"> | null,
): Promise<{ semesterStart: string; scope: "course" | "global" }> {
  const normalized = parseLooseDate(date);
  if (normalized === null || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    throw new ApiError("validation_error", "日期格式必须是 YYYY-MM-DD（学期第 1 周周一）");
  }
  const value = date.trim();
  if (course) {
    await updateEntity(ctx.db, "course", ctx.userId, course.id, { semesterStart: value }, ctx.now);
    return { semesterStart: value, scope: "course" };
  }
  await writeSettings(ctx.db, ctx.userId, { [COURSE_SETTING_KEYS.semesterStart]: value }, ctx.now, {
    deviceId: "",
  });
  return { semesterStart: value, scope: "global" };
}

/** 把 AI 传来的 weight / date 归一化；格式错误时抛 validation_error（而不是静默写 0）。 */
export function normalizeAssessmentArgs(raw: { weight?: unknown; date?: unknown }): {
  weight: number | undefined;
  dueAt: number | null | undefined;
} {
  let weight: number | undefined;
  if (raw.weight !== undefined && raw.weight !== null) {
    const parsed = parseLooseWeight(raw.weight);
    if (parsed === null) {
      throw new ApiError("validation_error", `权重无法解析：${String(raw.weight)}（示例：30 或 "30%"）`);
    }
    weight = parsed;
  }

  let dueAt: number | null | undefined;
  if (raw.date !== undefined) {
    if (raw.date === null) {
      dueAt = null;
    } else {
      const parsed = parseLooseDate(raw.date, { endOfDay: true });
      if (parsed === null) {
        throw new ApiError(
          "validation_error",
          `日期无法解析：${String(raw.date)}（示例：2026-12-01 / 2026-12-01T09:00:00+08:00）`,
        );
      }
      dueAt = parsed;
    }
  }

  return { weight, dueAt };
}

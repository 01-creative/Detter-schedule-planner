import {
  COURSE_SETTING_KEYS,
  assessmentTaskDraft,
  assignmentTaskDraft,
  classTaskDraft,
  dayKey,
  type Assessment,
  type AssessmentKind,
  type AssessmentStatus,
  type Assignment,
  type AssignmentStatus,
  type Course,
  type TimetableImportPlan,
} from "@detter/shared";
import { db } from "@/db";
import { deleteEntity, saveEntity } from "@/db/repo";

/**
 * 课程的写操作。
 *
 * 与其它特性一致：全部经 `@/db/repo`（维护 updatedAt / rev / outbox），
 * 绝不直接 `db.courses.put()`——那会漏掉同步队列。
 *
 * 课程 → Task 的字段映射来自 `@detter/shared`，这样网页建的 Task 与 MCP 建的完全一致。
 */

/* -------------------------------------------------------------------------- */
/*                                  设置                                       */
/* -------------------------------------------------------------------------- */

/** 设置行 id 固定为 `setting:<key>`：同一个 key 永远只有一行（与 quadrant/focus 一致）。 */
export async function writeCourseSetting(key: string, value: unknown): Promise<void> {
  await saveEntity("setting", { id: `setting:${key}`, key, value });
}

export async function saveCourseSettings(input: {
  semesterStart?: string | null;
  periodTimes?: Array<{ start: string; end: string }>;
  homeworkReminder?: { enabled: boolean; weekday: number; time: string };
}): Promise<void> {
  if (input.semesterStart !== undefined) {
    await writeCourseSetting(COURSE_SETTING_KEYS.semesterStart, input.semesterStart);
  }
  if (input.periodTimes !== undefined) {
    await writeCourseSetting(COURSE_SETTING_KEYS.periodTimes, input.periodTimes);
  }
  if (input.homeworkReminder !== undefined) {
    await writeCourseSetting(COURSE_SETTING_KEYS.homeworkReminder, input.homeworkReminder);
  }
}

/* -------------------------------------------------------------------------- */
/*                                  课程                                       */
/* -------------------------------------------------------------------------- */

export interface CourseDraft {
  name: string;
  code?: string;
  teacher?: string;
  credits?: number | null;
  color?: string;
  semesterStart?: string | null;
  weeklyHomework?: boolean;
  note?: string;
  goalId?: string | null;
}

export async function createCourse(draft: CourseDraft, sortIndex = 0): Promise<Course> {
  const row = await saveEntity("course", {
    name: draft.name.trim(),
    code: draft.code?.trim() ?? "",
    teacher: draft.teacher?.trim() ?? "",
    credits: draft.credits ?? null,
    color: draft.color ?? "#6366F1",
    semesterStart: draft.semesterStart ?? null,
    weeklyHomework: draft.weeklyHomework ?? false,
    note: draft.note ?? "",
    goalId: draft.goalId ?? null,
    sortIndex,
  });
  return row as unknown as Course;
}

export async function updateCourseRecord(course: Course, patch: Partial<CourseDraft>): Promise<void> {
  await saveEntity("course", { ...course, ...patch });
}

export async function setCourseSemesterStart(course: Course, semesterStart: string | null): Promise<void> {
  await saveEntity("course", { ...course, semesterStart });
}

/** 课程级联删除：先把考核项/作业生成的 Task 软删掉，再删课程本身。 */
export async function deleteCourseCascade(course: Course): Promise<{ tasks: number; records: number }> {
  const [assessments, assignments] = await Promise.all([
    db.assessments.where("courseId").equals(course.id).toArray(),
    db.assignments.where("courseId").equals(course.id).toArray(),
  ]);

  let tasks = 0;
  let records = 0;
  for (const assessment of assessments) {
    if (assessment.deletedAt) continue;
    if (assessment.taskId) {
      const task = await db.tasks.get(assessment.taskId);
      if (task && !task.deletedAt) {
        await deleteEntity("task", assessment.taskId);
        tasks += 1;
      }
    }
    await deleteEntity("assessment", assessment.id);
    records += 1;
  }
  for (const assignment of assignments) {
    if (assignment.deletedAt) continue;
    if (assignment.taskId) {
      const task = await db.tasks.get(assignment.taskId);
      if (task && !task.deletedAt) {
        await deleteEntity("task", assignment.taskId);
        tasks += 1;
      }
    }
    await deleteEntity("assignment", assignment.id);
    records += 1;
  }
  await deleteEntity("course", course.id);
  return { tasks, records };
}

/* -------------------------------------------------------------------------- */
/*                             考核项 / 作业                                   */
/* -------------------------------------------------------------------------- */

export interface AssessmentDraft {
  title: string;
  kind: AssessmentKind;
  weight: number;
  dueAt: number | null;
  startAt: number | null;
  note: string;
  status: AssessmentStatus;
  score: number | null;
}

async function updateTaskFromDraft(
  taskId: string | null,
  draft: ReturnType<typeof assessmentTaskDraft>,
): Promise<string | null> {
  if (!taskId) return null;
  const existing = await db.tasks.get(taskId);
  if (!existing || existing.deletedAt) return null;
  await saveEntity("task", { ...existing, ...draft });
  return taskId;
}

/** 新建考核项：先写考核项拿到 id，再建 Task，最后把 taskId 回填。 */
export async function addAssessment(course: Course, draft: AssessmentDraft): Promise<Assessment> {
  const created = await saveEntity("assessment", {
    courseId: course.id,
    title: draft.title.trim(),
    kind: draft.kind,
    weight: draft.weight,
    dueAt: draft.dueAt,
    startAt: draft.startAt,
    note: draft.note.trim(),
    status: draft.status,
    score: draft.score,
    taskId: null,
  });
  const assessment = created as unknown as Assessment;
  const task = await saveEntity("task", { ...assessmentTaskDraft(course, assessment, { source: "manual" }) });
  const linked = await saveEntity("assessment", { ...assessment, taskId: String(task.id) });
  return linked as unknown as Assessment;
}

/** 编辑考核项，并把改动同步到已有关联的 Task（标题/日期/备注）。 */
export async function updateAssessmentRecord(
  course: Course,
  assessment: Assessment,
  patch: Partial<AssessmentDraft>,
): Promise<Assessment> {
  const next = { ...assessment, ...patch } as Assessment;
  await saveEntity("assessment", next);
  await updateTaskFromDraft(assessment.taskId, assessmentTaskDraft(course, next, { source: "manual" }));
  return next;
}

/** 「一键生成日程」：有关联 Task 就更新，没有就新建并回填。 */
export async function generateAssessmentTask(course: Course, assessment: Assessment): Promise<boolean> {
  const draft = assessmentTaskDraft(course, assessment, { source: "manual" });
  const updated = await updateTaskFromDraft(assessment.taskId, draft);
  if (updated) return false;
  const task = await saveEntity("task", { ...draft });
  await saveEntity("assessment", { ...assessment, taskId: String(task.id) });
  return true;
}

export async function deleteAssessmentRecord(assessment: Assessment): Promise<void> {
  if (assessment.taskId && (await db.tasks.get(assessment.taskId))) {
    await deleteEntity("task", assessment.taskId);
  }
  await deleteEntity("assessment", assessment.id);
}

export interface AssignmentDraft {
  title: string;
  weekNo: number;
  dueAt: number | null;
  note: string;
  status: AssignmentStatus;
}

export async function addAssignment(course: Course, draft: AssignmentDraft): Promise<Assignment> {
  const created = await saveEntity("assignment", {
    courseId: course.id,
    weekNo: draft.weekNo,
    title: draft.title.trim(),
    dueAt: draft.dueAt,
    status: draft.status,
    note: draft.note.trim(),
    taskId: null,
  });
  const assignment = created as unknown as Assignment;
  const task = await saveEntity("task", {
    ...assignmentTaskDraft(course, assignment, { source: "manual" }),
  });
  const linked = await saveEntity("assignment", { ...assignment, taskId: String(task.id) });
  return linked as unknown as Assignment;
}

/** 修改作业；状态变化会同步到 Task（done → 完成任务，skipped → 丢弃）。 */
export async function updateAssignmentRecord(
  course: Course,
  assignment: Assignment,
  patch: Partial<AssignmentDraft>,
): Promise<Assignment> {
  const next = { ...assignment, ...patch } as Assignment;
  await saveEntity("assignment", next);

  const draft = assignmentTaskDraft(course, next, { source: "manual" });
  const task = assignment.taskId ? await db.tasks.get(assignment.taskId) : null;
  if (task && !task.deletedAt) {
    const status =
      next.status === "done" ? "done" : next.status === "skipped" ? "dropped" : "todo";
    await saveEntity("task", {
      ...task,
      ...draft,
      status,
      completedAt: status === "done" ? (task.completedAt ?? Date.now()) : null,
    });
  } else if (next.status === "todo") {
    // Task 被删过：补一条，避免「作业还在但日程没了」
    const recreated = await saveEntity("task", { ...draft });
    await saveEntity("assignment", { ...next, taskId: String(recreated.id) });
    return { ...next, taskId: String(recreated.id) };
  }
  return next;
}

export async function deleteAssignmentRecord(assignment: Assignment): Promise<void> {
  if (assignment.taskId && (await db.tasks.get(assignment.taskId))) {
    await deleteEntity("task", assignment.taskId);
  }
  await deleteEntity("assignment", assignment.id);
}

/* -------------------------------------------------------------------------- */
/*                                课表导入                                      */
/* -------------------------------------------------------------------------- */

export interface ImportResult {
  coursesCreated: number;
  coursesReused: number;
  seriesCreated: number;
  seriesSkipped: number;
  taskIds: string[];
  warnings: string[];
}

/**
 * 把导入计划落库（幂等）。
 *
 * 幂等键 = 课程 id + 时段键（`slot:TU1-2w1`，包含星期、节次、起始周）：
 * - 同一门课重复导入时，已有的时段会被跳过；
 * - 课程按名字复用（不会每次导入都多出一堆同名课）。
 */
export async function importTimetablePlan(plan: TimetableImportPlan): Promise<ImportResult> {
  const result: ImportResult = {
    coursesCreated: 0,
    coursesReused: 0,
    seriesCreated: 0,
    seriesSkipped: 0,
    taskIds: [],
    warnings: [...plan.warnings],
  };

  const normalize = (value: string) => value.replace(/\s+/g, "").replace(/（/g, "(").replace(/）/g, ")");
  const [existingCourses, existingTasks] = await Promise.all([
    db.courses.toArray(),
    db.tasks.toArray(),
  ]);
  const aliveCourses = existingCourses.filter((row) => !row.deletedAt);
  const taken = new Set<string>();
  for (const task of existingTasks) {
    if (task.deletedAt) continue;
    const courseTag = task.tags.find((tag) => tag.startsWith("course:"));
    const slotTag = task.tags.find((tag) => tag.startsWith("slot:"));
    if (courseTag && slotTag) taken.add(`${courseTag}|${slotTag}`);
  }

  for (const planned of plan.courses) {
    let course = aliveCourses.find((row) => normalize(row.name) === normalize(planned.name)) ?? null;
    if (course) {
      result.coursesReused += 1;
      if (!course.semesterStart) {
        course = (await saveEntity("course", {
          ...course,
          semesterStart: plan.semesterStart,
        })) as unknown as Course;
      }
    } else {
      course = (await saveEntity("course", {
        name: planned.name,
        code: planned.code,
        teacher: planned.teacher,
        color: planned.color,
        semesterStart: plan.semesterStart,
        /*
         * 默认**不开**「每周有作业」。
         * 导入一学期课表往往有十几门课，其中体育、马原这类课并没有周作业；
         * 如果默认打开，全站横幅会一直喊「14 门课还没记作业」，很快就没人看了。
         * 哪门课确实每周都有作业，在课程详情里打开即可。
         */
        weeklyHomework: false,
        note: "由课表导入",
        sortIndex: aliveCourses.length + result.coursesCreated,
      })) as unknown as Course;
      aliveCourses.push(course);
      result.coursesCreated += 1;
    }

    for (const slot of planned.slots) {
      for (const series of slot.series) {
        const key = `course:${course.id}|slot:${series.key}`;
        if (taken.has(key)) {
          result.seriesSkipped += 1;
          continue;
        }
        const task = await saveEntity("task", {
          ...classTaskDraft(course, series, slot, { source: "import" }),
          rrule: series.rrule,
          recurrenceId: null,
          occurrenceKey: null,
        });
        taken.add(key);
        result.taskIds.push(String(task.id));
        result.seriesCreated += 1;
      }
    }
  }

  return result;
}

/** 把毫秒时间戳格式化成 <input type="date"> 需要的 YYYY-MM-DD。 */
export function toDateInputValue(at: number): string {
  return dayKey(at);
}

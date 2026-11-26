import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { buildTimetablePlan, parseTimetableHtml, type Course } from "@detter/shared";
import { db } from "@/db";
import {
  addAssessment,
  addAssignment,
  deleteCourseCascade,
  importTimetablePlan,
} from "../courseActions";

/**
 * 课表导入的落库行为。
 *
 * 最重要的一条：**重复导入必须幂等**。用户换一个更完整的课表文件重新导一次是很正常的，
 * 如果每次多出 7 条重复日程，日历就没法看了。
 *
 * 这里跑在 fake-indexeddb 上（真实 Dexie + 真实 outbox），不走 mock。
 */

/** jsdom 环境下 import.meta.url 不是 file://，所以按候选路径找夹具（从仓库根或 apps/web 运行都能过）。 */
function fixturePath(): string {
  const candidates = [
    path.resolve(process.cwd(), "packages/shared/src/__fixtures__/timetable.sample.html"),
    path.resolve(process.cwd(), "../packages/shared/src/__fixtures__/timetable.sample.html"),
    path.resolve(process.cwd(), "../../packages/shared/src/__fixtures__/timetable.sample.html"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`找不到课表夹具，已尝试：${candidates.join(" | ")}`);
  return found;
}

const FIXTURE = readFileSync(fixturePath(), "utf8");
const SEMESTER = "2026-09-07";

function plan() {
  return buildTimetablePlan(parseTimetableHtml(FIXTURE), { semesterStart: SEMESTER });
}

const alive = async <T extends { deletedAt: number | null }>(rows: Promise<T[]>): Promise<T[]> =>
  (await rows).filter((row) => !row.deletedAt);

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("课表导入", () => {
  it("生成 3 门课 + 7 条周重复日程，且日程带 rrule 与去重标签", async () => {
    const result = await importTimetablePlan(plan());

    expect(result.coursesCreated).toBe(3);
    expect(result.seriesCreated).toBe(7);
    expect(result.seriesSkipped).toBe(0);

    const courses = await alive(db.courses.toArray());
    expect(courses.map((course) => course.name).sort()).toEqual(
      ["学术英语写作", "数字电子技术基础实验（Ⅱ）", "概率统计（理工）"].sort(),
    );

    const tasks = await alive(db.tasks.toArray());
    expect(tasks).toHaveLength(7);
    for (const task of tasks) {
      expect(task.kind).toBe("event");
      expect(task.startAt).not.toBeNull();
      expect(task.tags.some((tag) => tag.startsWith("slot:"))).toBe(true);
      expect(task.tags.some((tag) => tag.startsWith("course:"))).toBe(true);
    }
    // 单周/双周各一段用 INTERVAL=2
    expect(tasks.filter((task) => task.rrule?.includes("INTERVAL=2"))).toHaveLength(2);
    // 周二有两门课（概率统计 + 学术英语写作）
    expect(tasks.filter((task) => task.rrule?.includes("BYDAY=TU"))).toHaveLength(2);
  });

  it("重复导入幂等：第二次全部跳过，任务数不变", async () => {
    await importTimetablePlan(plan());
    const second = await importTimetablePlan(plan());

    expect(second.coursesCreated).toBe(0);
    expect(second.coursesReused).toBe(3);
    expect(second.seriesCreated).toBe(0);
    expect(second.seriesSkipped).toBe(7);
    expect(await alive(db.tasks.toArray())).toHaveLength(7);
  });

  it("考核项会生成带课程前缀的 Task，课程目标被继承", async () => {
    await importTimetablePlan(plan());
    const course = (await alive(db.courses.toArray()))[0] as Course;
    const withGoal = { ...course, goalId: "goal-1" };

    const assessment = await addAssessment(withGoal, {
      title: "大作业",
      kind: "project",
      weight: 30,
      dueAt: new Date(2026, 11, 1).getTime(),
      startAt: null,
      note: "",
      status: "planned",
      score: null,
    });

    const task = await db.tasks.get(assessment.taskId as string);
    expect(task?.title).toBe(`[${course.name}] 大作业`);
    expect(task?.goalId).toBe("goal-1");
    expect(task?.dueAt).toBe(new Date(2026, 11, 1).getTime());
    expect(assessment.taskId).toBeTruthy();
  });

  it("每周作业生成 Task；打开完成状态会把 Task 也标完成", async () => {
    await importTimetablePlan(plan());
    const course = (await alive(db.courses.toArray()))[0] as Course;
    const assignment = await addAssignment(course, {
      title: "第 3 周作业",
      weekNo: 3,
      dueAt: null,
      note: "",
      status: "todo",
    });
    const task = await db.tasks.get(assignment.taskId as string);
    expect(task?.title).toBe(`[${course.name}] 第 3 周作业`);
    expect(task?.tags).toContain("第3周");
  });

  it("删除课程会级联删掉考核项与它们生成的日程", async () => {
    await importTimetablePlan(plan());
    const course = (await alive(db.courses.toArray()))[0] as Course;
    await addAssessment(course, {
      title: "期末",
      kind: "exam",
      weight: 60,
      dueAt: null,
      startAt: null,
      note: "",
      status: "planned",
      score: null,
    });

    const before = await alive(db.tasks.toArray());
    expect(before).toHaveLength(8);

    await deleteCourseCascade(course);

    expect(await alive(db.courses.toArray())).toHaveLength(2);
    expect(await alive(db.tasks.toArray())).toHaveLength(7);
    expect(await alive(db.assessments.toArray())).toHaveLength(0);
  });
});

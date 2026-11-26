import { describe, expect, it } from "vitest";
import { AssessmentSchema, AssignmentSchema, CourseSchema } from "@detter/shared";
import {
  buildCourseCards,
  courseSubtitle,
  defaultSemesterStart,
  groupAssignmentsByWeek,
  readCourseSettings,
  sortedAssessments,
  weekOverview,
  weightStatus,
} from "../coursesModel";

/**
 * /courses 的派生逻辑：
 * 这些断言保护的是「页面上的数字与提示」——权重合计、本周是否缺作业、排序。
 * 它们必须与 MCP / 提醒服务端算出来的一致，所以规则尽量放在 shared，这里只做组合。
 */

const SEMESTER = "2026-09-07"; // 周一
const WEEK3 = new Date(2026, 8, 23, 12).getTime(); // 第 3 周周三

const course = (over: Record<string, unknown> = {}) =>
  CourseSchema.parse({ id: "c1", name: "英语", createdAt: 0, updatedAt: 0, ...over });
const assessment = (over: Record<string, unknown> = {}) =>
  AssessmentSchema.parse({ id: "a1", courseId: "c1", title: "大作业", createdAt: 0, updatedAt: 0, ...over });
const assignment = (over: Record<string, unknown> = {}) =>
  AssignmentSchema.parse({ id: "s1", courseId: "c1", weekNo: 3, title: "作业", createdAt: 0, updatedAt: 0, ...over });

describe("课程卡片派生", () => {
  it("权重合计、考核项数、本周作业状态", () => {
    const cards = buildCourseCards(
      [course({ weeklyHomework: true })],
      [assessment({ weight: 30 }), assessment({ id: "a2", kind: "exam", weight: 50 })],
      [assignment({ weekNo: 2 })],
      WEEK3,
      SEMESTER,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]?.weekNo).toBe(3);
    expect(cards[0]?.weight.total).toBe(80);
    expect(cards[0]?.weight.remaining).toBe(20);
    expect(cards[0]?.assessmentCount).toBe(2);
    // 第 3 周没有作业 → 缺记
    expect(cards[0]?.thisWeekAssignments).toHaveLength(0);
    expect(cards[0]?.homeworkMissing).toBe(true);
  });

  it("本周记过作业后不再缺记", () => {
    const cards = buildCourseCards(
      [course({ weeklyHomework: true })],
      [],
      [assignment({ weekNo: 3 })],
      WEEK3,
      SEMESTER,
    );
    expect(cards[0]?.thisWeekAssignments).toHaveLength(1);
    expect(cards[0]?.homeworkMissing).toBe(false);
  });

  it("归档课程不出现在列表里", () => {
    const cards = buildCourseCards([course({ archived: true })], [], [], WEEK3, SEMESTER);
    expect(cards).toEqual([]);
  });

  it("下一项考核取「还没到期的最近一条」", () => {
    const cards = buildCourseCards(
      [course()],
      [
        assessment({ id: "past", title: "已过去", dueAt: WEEK3 - 86_400_000 }),
        assessment({ id: "next", title: "下一步", dueAt: WEEK3 + 86_400_000 }),
      ],
      [],
      WEEK3,
      SEMESTER,
    );
    expect(cards[0]?.nextAssessment?.title).toBe("下一步");
  });

  it("课程自己的学期起点优先于全局", () => {
    const cards = buildCourseCards(
      [course({ semesterStart: "2026-09-21" })],
      [],
      [],
      WEEK3,
      SEMESTER,
    );
    expect(cards[0]?.weekNo).toBe(1);
  });
});

describe("本周概况", () => {
  it("只统计缺记的课，并给出周次", () => {
    const cards = buildCourseCards(
      [
        course({ id: "c1", name: "英语", weeklyHomework: true }),
        course({ id: "c2", name: "体育", weeklyHomework: false }),
        course({ id: "c3", name: "数学", weeklyHomework: true }),
      ],
      [],
      [assignment({ courseId: "c3", weekNo: 3 })],
      WEEK3,
      SEMESTER,
    );
    const overview = weekOverview(cards);
    expect(overview.missingCount).toBe(1);
    expect(overview.missing[0]?.course.name).toBe("英语");
    expect(overview.weekNo).toBe(3);
  });

  it("没有遗漏时返回 0", () => {
    const cards = buildCourseCards([course({ weeklyHomework: true })], [], [assignment({ weekNo: 3 })], WEEK3, SEMESTER);
    expect(weekOverview(cards)).toMatchObject({ missingCount: 0, missing: [] });
  });
});

describe("权重状态", () => {
  it.each([
    [{ total: 0, remaining: 100, overflow: 0, count: 0, byKind: [] }, "empty"],
    [{ total: 30, remaining: 70, overflow: 0, count: 1, byKind: [] }, "partial"],
    [{ total: 100, remaining: 0, overflow: 0, count: 2, byKind: [] }, "full"],
    [{ total: 110, remaining: 0, overflow: 10, count: 2, byKind: [] }, "over"],
  ])("合计 %o → %s", (summary, expected) => {
    expect(weightStatus(summary as never)).toBe(expected);
  });
});

describe("作业分组与排序", () => {
  it("按周倒序、本周打标、组内按截止时间", () => {
    const groups = groupAssignmentsByWeek(
      [
        assignment({ id: "a", weekNo: 1 }),
        assignment({ id: "b", weekNo: 3, dueAt: 200 }),
        assignment({ id: "c", weekNo: 3, dueAt: 100 }),
      ],
      3,
    );
    expect(groups.map((group) => group.weekNo)).toEqual([3, 1]);
    expect(groups[0]?.isCurrent).toBe(true);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["c", "b"]);
    expect(groups[1]?.isCurrent).toBe(false);
  });

  it("考核项按到期时间排序，没有日期的排最后", () => {
    const sorted = sortedAssessments([
      assessment({ id: "none", dueAt: null, startAt: null }),
      assessment({ id: "late", dueAt: 300 }),
      assessment({ id: "early", dueAt: 100 }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["early", "late", "none"]);
  });
});

describe("设置与文案", () => {
  it("默认学期起点 = 本周周一", () => {
    expect(defaultSemesterStart(WEEK3)).toBe("2026-09-21");
  });

  it("课表设置解析：坏值回落默认", () => {
    const parsed = readCourseSettings({
      semesterStart: "2026/09/07",
      periodTimes: [{ start: "09:00", end: "09:45" }],
      homeworkReminder: { enabled: false, weekday: 9, time: "25:00" },
    });
    expect(parsed.semesterStart).toBeNull();
    expect(parsed.periodTimes[0]).toEqual({ start: "09:00", end: "09:45" });
    // 非法 weekday / time 回落到默认（周日 20:00），但 enabled=false 保留
    expect(parsed.homeworkReminder).toEqual({ enabled: false, weekday: 7, time: "20:00" });
  });

  it("课程副标题省略空项", () => {
    expect(courseSubtitle({ course: course({ teacher: "肖铮", credits: 3 }), weekNo: 3 })).toBe(
      "肖铮 · 3 学分 · 第 3 周",
    );
    expect(courseSubtitle({ course: course({ teacher: "" }), weekNo: null })).toBe("");
  });
});

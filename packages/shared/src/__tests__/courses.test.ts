import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AssessmentSchema, AssignmentSchema, CourseSchema } from "../entities.ts";
import {
  DEFAULT_PERIOD_TIMES,
  buildTimetablePlan,
  classTaskDraft,
  courseWeekNo,
  describePeriods,
  describeWeeks,
  findHomeworkGaps,
  homeworkReminderInstant,
  normalizePeriodTimes,
  parseLooseDate,
  parseLooseWeight,
  resolvePeriodWindow,
  splitWeekRuns,
  summarizeWeights,
  weekdayDateAt,
  assessmentTaskDraft,
  assignmentTaskDraft,
  DEFAULT_HOMEWORK_REMINDER,
  semesterAnchor,
} from "../courses.ts";
import { parseTimetableHtml } from "../timetable.ts";

/**
 * 课程域纯函数：周次拆分、导入计划、宽松参数解析、权重与遗漏判定。
 * 这些是「前端导入 / MCP 写入 / 后端提醒」三条路径共用的规则，必须锁住。
 */

const SEMESTER = "2026-09-07"; // 周一
const DAY = 86_400_000;

const course = (over: Record<string, unknown> = {}) =>
  CourseSchema.parse({ id: "course-1", name: "英语", createdAt: 0, updatedAt: 0, ...over });
const assessment = (over: Record<string, unknown> = {}) =>
  AssessmentSchema.parse({ id: "a-1", courseId: "course-1", title: "大作业", createdAt: 0, updatedAt: 0, ...over });
const assignment = (over: Record<string, unknown> = {}) =>
  AssignmentSchema.parse({ id: "as-1", courseId: "course-1", weekNo: 1, title: "作业", createdAt: 0, updatedAt: 0, ...over });

describe("周次拆分与描述", () => {
  it("连续 17 周是一段", () => {
    expect(splitWeekRuns([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])).toHaveLength(1);
  });

  it("单双周是步长 2 的一段", () => {
    expect(splitWeekRuns([3, 5, 7, 9])).toEqual([[3, 5, 7, 9]]);
  });

  it("有缺口的周次拆成多段", () => {
    const runs = splitWeekRuns([1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16]);
    expect(runs).toHaveLength(2);
    expect(runs[0]?.[0]).toBe(1);
    expect(runs[1]?.[0]).toBe(10);
  });

  it("人话描述：连续 / 单双 / 多段", () => {
    expect(describeWeeks([1, 2, 3, 4])).toBe("1-4周");
    expect(describeWeeks([1, 3, 5, 7])).toBe("1-7(单)周");
    expect(describeWeeks([2, 4, 6])).toBe("2-6(双)周");
    expect(describeWeeks([1, 2, 3, 5, 7])).toBe("1-3,5-7(单)周");
    expect(describeWeeks([4])).toBe("4周");
  });

  it("节次描述", () => {
    expect(describePeriods(1, 2)).toBe("1-2节");
    expect(describePeriods(5, 5)).toBe("第5节");
  });
});

describe("作息表与节次换算", () => {
  it("默认江安作息：1-2 节 08:00-09:40", () => {
    expect(resolvePeriodWindow(DEFAULT_PERIOD_TIMES, 1, 2)).toEqual({ start: "08:00", end: "09:40" });
    expect(resolvePeriodWindow(DEFAULT_PERIOD_TIMES, 5, 7)).toEqual({ start: "14:00", end: "16:45" });
    expect(resolvePeriodWindow(DEFAULT_PERIOD_TIMES, 11, 11)).toEqual({ start: "20:20", end: "21:05" });
    // 晚间大节排到第 12 节：10-12 节必须收在 21:55（用户报过 20:40 的错误下课时间）
    expect(resolvePeriodWindow(DEFAULT_PERIOD_TIMES, 10, 12)).toEqual({ start: "19:30", end: "21:55" });
  });

  it("改过的作息表立即生效，坏项回落默认", () => {
    const custom = normalizePeriodTimes([
      { start: "09:00", end: "09:45" },
      { start: "bad", end: "10:00" },
    ]);
    expect(resolvePeriodWindow(custom, 1, 1)).toEqual({ start: "09:00", end: "09:45" });
    // 第 2 项非法 → 用默认的 08:55-09:40
    expect(resolvePeriodWindow(custom, 2, 2)).toEqual({ start: "08:55", end: "09:40" });
  });

  it("非数组/缺项时得到完整 12 节默认值", () => {
    expect(normalizePeriodTimes(null)).toHaveLength(12);
    expect(normalizePeriodTimes([])[0]).toEqual(DEFAULT_PERIOD_TIMES[0]);
  });
});

describe("学期周次换算", () => {
  it("锚点是学期第 1 周周一", () => {
    expect(semesterAnchor("2026-09-09")).toBe(new Date(2026, 8, 7).getTime());
  });

  it("第 1 / 3 / 17 周", () => {
    expect(courseWeekNo(SEMESTER, new Date(2026, 8, 7, 10).getTime())).toBe(1);
    expect(courseWeekNo(SEMESTER, new Date(2026, 8, 20, 23).getTime())).toBe(2);
    expect(courseWeekNo(SEMESTER, new Date(2026, 8, 23, 1).getTime())).toBe(3);
    expect(courseWeekNo(SEMESTER, new Date(2026, 11, 28, 12).getTime())).toBe(17);
  });

  it("学期开始前返回 null；没有学期起点也返回 null", () => {
    expect(courseWeekNo(SEMESTER, new Date(2026, 8, 1).getTime())).toBeNull();
    expect(courseWeekNo(null, Date.now())).toBeNull();
  });

  it("第 N 周周几的日期", () => {
    expect(weekdayDateAt(SEMESTER, 1, 1)).toBe(new Date(2026, 8, 7).getTime());
    expect(weekdayDateAt(SEMESTER, 3, 5)).toBe(new Date(2026, 8, 25).getTime());
    expect(weekdayDateAt(SEMESTER, 17, 7)).toBe(new Date(2027, 0, 3).getTime());
  });
});

describe("课表 → 导入计划", () => {
  const html = readFileSync(new URL("../__fixtures__/timetable.sample.html", import.meta.url), "utf8");
  const plan = buildTimetablePlan(parseTimetableHtml(html), { semesterStart: SEMESTER });

  it("3 门课 / 6 个时段 / 7 段重复日程", () => {
    expect(plan.totals).toEqual({ courses: 3, slots: 6, series: 7 });
    expect(plan.warnings).toEqual([]);
  });

  it("连续周生成 FREQ=WEEKLY + BYDAY + UNTIL", () => {
    const probability = plan.courses.find((item) => item.name === "概率统计（理工）");
    const first = probability?.slots[0]?.series[0];
    expect(first?.rrule).toBe("FREQ=WEEKLY;BYDAY=TU;UNTIL=20261229T080000Z");
    expect(first?.startAt).toBe(new Date(2026, 8, 8, 8, 0).getTime());
    expect(first?.endAt).toBe(new Date(2026, 8, 8, 9, 40).getTime());
  });

  it("单周用 INTERVAL=2，且 dtstart 落在第一个单周", () => {
    const english = plan.courses.find((item) => item.name === "学术英语写作");
    const odd = english?.slots.find((slot) => slot.weekday === 5);
    expect(odd?.series).toHaveLength(1);
    expect(odd?.series[0]?.rrule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;UNTIL=20261106T140000Z");
    expect(odd?.series[0]?.startAt).toBe(new Date(2026, 8, 25, 14, 0).getTime());
  });

  it("双周同样用 INTERVAL=2，但起点是第 4 周", () => {
    const lab = plan.courses.find((item) => item.name.startsWith("数字电子技术基础实验"));
    expect(lab?.slots[0]?.series[0]?.rrule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;UNTIL=20270108T140000Z");
  });

  it("不连续周次拆成两段日程，第 9 周没有课", () => {
    const probability = plan.courses.find((item) => item.name === "概率统计（理工）");
    const slot = probability?.slots.find((item) => item.startPeriod === 5);
    expect(slot?.series).toHaveLength(2);
    expect(slot?.series[0]?.weeks).toHaveLength(8);
    expect(slot?.series[1]?.weeks[0]).toBe(10);
    expect(slot?.series.every((item) => item.rrule !== null)).toBe(true);
  });

  it("只有一周的时段退化成一次性日程（rrule=null）", () => {
    const single = buildTimetablePlan(
      {
        courses: [
          {
            name: "讲座",
            code: "",
            teacher: "客座",
            slots: [{ weekday: 3, startPeriod: 9, endPeriod: 10, weeks: [5], location: "报告厅" }],
          },
        ],
        warnings: [],
        stats: { cells: 1, courseCells: 1, slots: 1 },
      },
      { semesterStart: SEMESTER },
    );
    expect(single.courses[0]?.slots[0]?.series[0]?.rrule).toBeNull();
    // 第 9 节按默认作息是 18:40 开始
    expect(single.courses[0]?.slots[0]?.series[0]?.startAt).toBe(new Date(2026, 9, 7, 18, 40).getTime());
  });

  it("学期起点不合法时不生成任何日程，并给出警告", () => {
    const broken = buildTimetablePlan(parseTimetableHtml(html), { semesterStart: "2026/09/07" });
    expect(broken.courses).toEqual([]);
    expect(broken.warnings.join()).toContain("学期第 1 周");
  });
});

describe("课程 → Task 映射", () => {
  const english = course({ id: "c-en", name: "英语", teacher: "王老师", goalId: "goal-1" });

  it("考核项标题带课程前缀，并继承课程目标", () => {
    const draft = assessmentTaskDraft(english, assessment({ kind: "project", weight: 30, dueAt: 1000 }));
    expect(draft.title).toBe("[英语] 大作业");
    expect(draft.dueAt).toBe(1000);
    expect(draft.goalId).toBe("goal-1");
    expect(draft.tags).toContain("course:c-en");
    expect(draft.notes).toContain("30%");
    // 只写日期时 dueAt 是 23:59，提前 12 小时才是有用的提醒
    expect(draft.remindOffsets).toEqual([720]);
  });

  it("考试类默认进 Q1（更紧急），作业类进 Q2", () => {
    expect(assessmentTaskDraft(english, assessment({ kind: "exam" })).quadrant).toBe(1);
    expect(assessmentTaskDraft(english, assessment({ kind: "homework" })).quadrant).toBe(2);
  });

  it("每周作业标题带课程前缀与周次标签", () => {
    const draft = assignmentTaskDraft(english, assignment({ weekNo: 4, dueAt: 2000 }));
    expect(draft.title).toBe("[英语] 作业");
    expect(draft.dueAt).toBe(2000);
    expect(draft.tags).toContain("第4周");
  });

  it("上课时段是 event，带地点与节次备注", () => {
    const draft = classTaskDraft(
      english,
      { weeks: [1, 2], startAt: 100, endAt: 200, rrule: "FREQ=WEEKLY;BYDAY=TU", key: "TU1-2w1" },
      { location: "一教B203", startPeriod: 1, endPeriod: 2 },
    );
    expect(draft.kind).toBe("event");
    expect(draft.startAt).toBe(100);
    expect(draft.endAt).toBe(200);
    expect(draft.location).toBe("一教B203");
    expect(draft.tags).toContain("slot:TU1-2w1");
    expect(draft.remindOffsets).toEqual([10]);
  });
});

describe("权重汇总", () => {
  it("合计 / 剩余 / 分类型", () => {
    const summary = summarizeWeights([
      { kind: "exam", weight: 30 },
      { kind: "exam", weight: 20 },
      { kind: "project", weight: 25 },
    ]);
    expect(summary.total).toBe(75);
    expect(summary.remaining).toBe(25);
    expect(summary.overflow).toBe(0);
    expect(summary.byKind[0]).toEqual({ kind: "exam", weight: 50, count: 2 });
  });

  it("超过 100% 时给出 overflow，不把 remaining 弄成负数", () => {
    const summary = summarizeWeights([
      { kind: "exam", weight: 60 },
      { kind: "project", weight: 60 },
    ]);
    expect(summary.total).toBe(120);
    expect(summary.overflow).toBe(20);
    expect(summary.remaining).toBe(0);
  });

  it("空列表是 0 / 100", () => {
    expect(summarizeWeights([])).toMatchObject({ total: 0, remaining: 100, count: 0 });
  });
});

describe("每周作业遗漏判定", () => {
  const now = new Date(2026, 8, 23, 12).getTime(); // 第 3 周周三

  it("weeklyHomework 的课本周没有记录 → 报遗漏", () => {
    const gaps = findHomeworkGaps([course({ weeklyHomework: true })], [], now, SEMESTER);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.weekNo).toBe(3);
  });

  it("已经记过（含 skipped）就不再提示", () => {
    const gaps = findHomeworkGaps(
      [course({ weeklyHomework: true })],
      [assignment({ weekNo: 3, status: "skipped" })],
      now,
      SEMESTER,
    );
    expect(gaps).toEqual([]);
  });

  it("不是每周作业 / 已归档 / 其它周的记录都不算遗漏", () => {
    expect(findHomeworkGaps([course({ weeklyHomework: false })], [], now, SEMESTER)).toEqual([]);
    expect(findHomeworkGaps([course({ weeklyHomework: true, archived: true })], [], now, SEMESTER)).toEqual([]);
    expect(
      findHomeworkGaps([course({ weeklyHomework: true })], [assignment({ weekNo: 2 })], now, SEMESTER),
    ).toHaveLength(1);
  });

  it("课程自己的学期起点优先于全局设置", () => {
    const own = course({ weeklyHomework: true, semesterStart: "2026-09-21" }); // 本周第 1 周
    const gaps = findHomeworkGaps([own], [], now, SEMESTER);
    expect(gaps[0]?.weekNo).toBe(1);
  });

  it("没有学期起点时无法判断，返回空", () => {
    expect(findHomeworkGaps([course({ weeklyHomework: true })], [], now, null)).toEqual([]);
  });
});

describe("每周作业提醒时刻", () => {
  it("默认周日 20:00 落在本周最后一天", () => {
    const now = new Date(2026, 8, 23, 12).getTime(); // 周三
    const fireAt = homeworkReminderInstant(now, DEFAULT_HOMEWORK_REMINDER);
    expect(fireAt).toBe(new Date(2026, 8, 27, 20, 0).getTime()); // 周日
  });

  it("改到周一 09:00 后落在本周第一天", () => {
    const now = new Date(2026, 8, 23, 12).getTime();
    const fireAt = homeworkReminderInstant(now, { enabled: true, weekday: 1, time: "09:00" });
    expect(fireAt).toBe(new Date(2026, 8, 21, 9, 0).getTime());
  });
});

describe("宽松参数解析（给 AI 用）", () => {
  it("日期：YYYY-MM-DD / 带时间 / ISO / 秒级时间戳", () => {
    expect(parseLooseDate("2026-12-01")).toBe(new Date(2026, 11, 1).getTime());
    expect(parseLooseDate("2026-12-01", { endOfDay: true })).toBe(new Date(2026, 11, 1).getTime() + DAY - 1);
    expect(parseLooseDate("2026-12-01 14:30")).toBe(new Date(2026, 11, 1, 14, 30).getTime());
    expect(parseLooseDate("2026-12-01T14:30:00+08:00")).toBe(Date.parse("2026-12-01T14:30:00+08:00"));
    expect(parseLooseDate(1764547200)).toBe(1764547200000);
    expect(parseLooseDate(1764547200000)).toBe(1764547200000);
  });

  it("日期：无法解析时返回 null", () => {
    expect(parseLooseDate("下周三")).toBeNull();
    expect(parseLooseDate(null)).toBeNull();
    expect(parseLooseDate(42)).toBeNull();
  });

  it("权重：20% / 20 / '20分' / 150 夹到 100", () => {
    expect(parseLooseWeight("20%")).toBe(20);
    expect(parseLooseWeight("２０％")).toBe(20);
    expect(parseLooseWeight("20")).toBe(20);
    expect(parseLooseWeight(20)).toBe(20);
    expect(parseLooseWeight("20分")).toBe(20);
    expect(parseLooseWeight(150)).toBe(100);
    expect(parseLooseWeight("abc")).toBeNull();
    expect(parseLooseWeight(null)).toBeNull();
  });
});

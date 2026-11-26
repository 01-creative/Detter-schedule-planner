import { describe, expect, it } from "vitest";
import { HOUR, MINUTE, TaskSchema, addDays, startOfWeek } from "@detter/shared";
import type { Task } from "@detter/shared";
import { buildCalendarItems } from "@/features/calendar/calendarItems";
import {
  describeRRule,
  expandOccurrenceStarts,
  openEndedRRule,
  truncateRRule,
} from "@/features/calendar/recurrence";
import { shiftRRuleWeekdays, combineDateAndTime } from "@/features/calendar/calendarMutations";

/**
 * 重复事件展开与「只改这一次」。
 *
 * 覆盖任务书 §5 的全部语义：
 * - 实例虚拟展开（不落库）；
 * - 只改这一次 → 覆盖记录替换那一周的实例；
 * - 删除某一次 → 墓碑覆盖记录，父系列不动；
 * - 改整个系列 / 改此后所有 → UNTIL 截断后重新展开。
 */

const DATE_BASE = new Date(2026, 0, 1).getTime();
let sequence = 0;

function makeTask(input: Partial<Task> = {}): Task {
  sequence += 1;
  return TaskSchema.parse({
    id: `task-${sequence}`,
    createdAt: DATE_BASE + sequence,
    updatedAt: DATE_BASE + sequence,
    title: "占位",
    ...input,
  });
}

/** 2026-11 某一周的周一 00:00（不写死日期，避免受日历改版影响） */
const MONDAY = startOfWeek(new Date(2026, 10, 23, 15, 0).getTime());
const at = (dayOffset: number, hour: number, minute = 0) =>
  addDays(MONDAY, dayOffset) + hour * HOUR + minute * MINUTE;

const WEEK_RRULE = "FREQ=WEEKLY;BYDAY=MO";

function makeSeries(overrides: Partial<Task> = {}): Task {
  return makeTask({
    id: "series",
    title: "高数课",
    startAt: at(0, 9),
    endAt: at(0, 10, 30),
    rrule: WEEK_RRULE,
    ...overrides,
  });
}

describe("rrule 展开", () => {
  it("每周一 09:00 的系列在 4 周窗口里展开出 4 个实例", () => {
    const parent = makeSeries();
    const starts = expandOccurrenceStarts(parent, MONDAY, addDays(MONDAY, 28));

    expect(starts).toHaveLength(4);
    for (const start of starts) {
      // 本地时区语义：墙上时间永远是 09:00、永远是周一
      expect(new Date(start).getHours()).toBe(9);
      expect(new Date(start).getMinutes()).toBe(0);
      expect(new Date(start).getDay()).toBe(1);
    }
    expect(starts[1]! - starts[0]!).toBe(7 * 24 * HOUR);
    expect(starts[0]).toBe(at(0, 9));
  });

  it("窗口外的实例不展开；没有 rrule 的任务不展开", () => {
    const parent = makeSeries();
    // 周一之后的 3 天里没有任何一次「每周一」
    expect(expandOccurrenceStarts(parent, addDays(MONDAY, 1), addDays(MONDAY, 4))).toHaveLength(0);
    const single = makeTask({ startAt: at(0, 9), endAt: at(0, 10) });
    expect(expandOccurrenceStarts(single, MONDAY, addDays(MONDAY, 28))).toHaveLength(0);
  });

  it("写坏的 rrule 不会抛异常，只是不重复", () => {
    const broken = makeSeries({ rrule: "FREQ=NONSENSE;BYDAY=??" });
    expect(expandOccurrenceStarts(broken, MONDAY, addDays(MONDAY, 28))).toEqual([]);
  });

  it("UNTIL 截断后只剩这一次之前的实例（改此后所有的基础）", () => {
    const parent = makeSeries();
    const truncated = truncateRRule(WEEK_RRULE, at(6, 23, 59));
    const shortened = makeSeries({ rrule: truncated });

    expect(expandOccurrenceStarts(shortened, MONDAY, addDays(MONDAY, 28))).toHaveLength(1);
    // 原始规则仍然展开 4 次，说明截断的是规则本身
    expect(expandOccurrenceStarts(parent, MONDAY, addDays(MONDAY, 28))).toHaveLength(4);
  });

  it("openEndedRRule 去掉 UNTIL / COUNT，供拆分出的新系列使用", () => {
    expect(openEndedRRule(`${WEEK_RRULE};UNTIL=20261207T235900Z`)).toBe(WEEK_RRULE);
    expect(openEndedRRule("FREQ=DAILY;COUNT=10")).toBe("FREQ=DAILY");
  });

  it("重复规则的人话描述", () => {
    expect(describeRRule(WEEK_RRULE)).toBe("每周 周一");
    expect(describeRRule("FREQ=DAILY")).toBe("每天");
    expect(describeRRule("FREQ=MONTHLY")).toBe("每月");
    expect(describeRRule(null)).toBe("");
  });

  it("系列整体挪一天时 BYDAY 跟着平移", () => {
    expect(shiftRRuleWeekdays(WEEK_RRULE, 2)).toBe("FREQ=WEEKLY;BYDAY=WE");
    expect(shiftRRuleWeekdays(WEEK_RRULE, -1)).toBe("FREQ=WEEKLY;BYDAY=SU");
    expect(shiftRRuleWeekdays(WEEK_RRULE, 0)).toBe(WEEK_RRULE);
  });
});

describe("只改这一次（覆盖记录）", () => {
  it("覆盖记录只替换那一周，其它周不变", () => {
    const parent = makeSeries();
    const thirdStart = at(14, 9);
    const override = makeTask({
      id: "override",
      title: "高数课（调课）",
      startAt: at(15, 10),
      endAt: at(15, 11, 30),
      recurrenceId: "series",
      occurrenceKey: String(thirdStart),
      rrule: null,
    });

    const items = buildCalendarItems([parent, override], MONDAY, addDays(MONDAY, 28));
    const seriesItems = items.filter((item) => item.parentId === "series");

    // 4 周仍然是 4 条，但第 3 周从 9:00 挪到了下周二的 10:00
    expect(seriesItems).toHaveLength(4);
    expect(seriesItems.some((item) => item.startAt === thirdStart)).toBe(false);
    const moved = seriesItems.find((item) => item.occurrenceKey === String(thirdStart))!;
    expect(moved).toBeDefined();
    expect(moved.startAt).toBe(at(15, 10));
    expect(moved.endAt).toBe(at(15, 11, 30));
    expect(moved.virtual).toBe(false);
    expect(moved.recurring).toBe(true);

    // 其它三周仍然是虚拟实例，时间原样
    expect(seriesItems.filter((item) => item.virtual)).toHaveLength(3);
    expect(seriesItems.filter((item) => item.virtual).map((item) => item.startAt)).toEqual([
      at(0, 9),
      at(7, 9),
      at(21, 9),
    ]);
  });

  it("删除某一次：status=dropped 的墓碑记录让那一次消失，父任务不动", () => {
    const parent = makeSeries();
    const dropped = makeTask({
      id: "dropped",
      startAt: at(7, 9),
      endAt: at(7, 10, 30),
      recurrenceId: "series",
      occurrenceKey: String(at(7, 9)),
      status: "dropped",
      rrule: null,
    });

    const items = buildCalendarItems([parent, dropped], MONDAY, addDays(MONDAY, 28));
    expect(items.some((item) => item.startAt === at(7, 9))).toBe(false);
    expect(items.filter((item) => item.parentId === "series")).toHaveLength(3);
    // 父任务本身仍然是一条有效的重复任务
    expect(parent.rrule).toBe(WEEK_RRULE);
  });

  it("完成某一次：status=done 的覆盖记录只影响那一次", () => {
    const parent = makeSeries();
    const completed = makeTask({
      id: "done-once",
      startAt: at(7, 9),
      endAt: at(7, 10, 30),
      recurrenceId: "series",
      occurrenceKey: String(at(7, 9)),
      status: "done",
      rrule: null,
    });

    const items = buildCalendarItems([parent, completed], MONDAY, addDays(MONDAY, 28));
    const done = items.find((item) => item.status === "done")!;
    expect(done).toBeDefined();
    expect(done.startAt).toBe(at(7, 9));
    expect(items.filter((item) => item.status !== "done")).toHaveLength(3);
  });

  it("被挪出视图区间的覆盖记录不会凭空多出来", () => {
    const parent = makeSeries();
    const movedOut = makeTask({
      id: "moved-out",
      startAt: addDays(MONDAY, 90) + 10 * HOUR,
      endAt: addDays(MONDAY, 90) + 11 * HOUR,
      recurrenceId: "series",
      occurrenceKey: String(at(7, 9)),
      rrule: null,
    });

    const items = buildCalendarItems([parent, movedOut], MONDAY, addDays(MONDAY, 28));
    expect(items.filter((item) => item.parentId === "series")).toHaveLength(3);
    expect(items.some((item) => item.taskId === "moved-out")).toBe(false);
  });
});

describe("日期与时刻拼装", () => {
  it("用本地时区拼回时间戳，不依赖 Date.parse 的字符串解析", () => {
    const ts = combineDateAndTime("2026-11-27", "14:30");
    const date = new Date(ts);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(10);
    expect(date.getDate()).toBe(27);
    expect(date.getHours()).toBe(14);
    expect(date.getMinutes()).toBe(30);
    expect(date.getSeconds()).toBe(0);
  });
});

describe("普通任务的装配", () => {
  it("系列父任务自己不会额外出现一条（它的第一条实例由 dtstart 生成）", () => {
    const parent = makeSeries();
    const items = buildCalendarItems([parent], MONDAY, addDays(MONDAY, 28));
    expect(items).toHaveLength(4);
    expect(items.every((item) => item.occurrenceKey !== null)).toBe(true);
    expect(items.every((item) => item.virtual)).toBe(true);
  });

  it("只有截止时间的任务进全天行，并与时间轴任务一起按开始时间排序", () => {
    const dueOnly = makeTask({ title: "交作业", dueAt: at(2, 18) });
    const timed = makeTask({ title: "组会", startAt: at(1, 10), endAt: at(1, 11) });
    const items = buildCalendarItems([dueOnly, timed], MONDAY, addDays(MONDAY, 7));

    expect(items.map((item) => item.title)).toEqual(["组会", "交作业"]);
    expect(items[1]!.allDay).toBe(true);
    expect(items[1]!.dueOnly).toBe(true);
    expect(items[1]!.startAt).toBe(at(2, 18));
  });

  it("区间外的任务不返回，跨天任务只要与区间有交集就返回", () => {
    const outside = makeTask({ title: "很久以后", startAt: addDays(MONDAY, 60) });
    const spanning = makeTask({
      title: "跨夜",
      startAt: at(-1, 22),
      endAt: at(0, 2),
    });
    const items = buildCalendarItems([outside, spanning], MONDAY, addDays(MONDAY, 7));
    expect(items.map((item) => item.title)).toEqual(["跨夜"]);
  });

  it("软删除的任务不出现", () => {
    const deleted = makeTask({ title: "已删除", startAt: at(0, 12), deletedAt: DATE_BASE });
    expect(buildCalendarItems([deleted], MONDAY, addDays(MONDAY, 7))).toHaveLength(0);
  });
});

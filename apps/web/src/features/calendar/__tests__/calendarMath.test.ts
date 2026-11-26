import { describe, expect, it } from "vitest";
import { HOUR, MINUTE, addDays, startOfDay, startOfWeek } from "@detter/shared";
import {
  MAX_COLUMNS,
  PX_PER_HOUR,
  PX_PER_MINUTE,
  dayHeightPx,
  dragBubbleLabel,
  layoutDay,
  monthGridStarts,
  offsetPxToTime,
  resolveDrag,
  shiftAnchor,
  snapToStep,
  timeToOffsetPx,
  viewRange,
  weekDayStarts,
} from "@/features/calendar/calendarMath";

/**
 * 日历几何与拖拽的纯函数用例。
 *
 * 这些断言覆盖任务书 §8 里最容易出错、又最难用肉眼验证的几条：
 * 时间↔像素、15 分钟吸附、重叠分列、跨天拖拽、月视图网格。
 * 全部用本地时间构造（`new Date(y, m, d)`），不依赖执行环境的时区。
 */

/** 任意一天 00:00，作为网格起点 */
const DAY0 = new Date(2026, 10, 23).getTime();
const at = (hour: number, minute = 0) => DAY0 + hour * HOUR + minute * MINUTE;

describe("时间 ↔ 像素", () => {
  it("06:00 落在 336px，整天的网格高 1344px", () => {
    expect(PX_PER_HOUR).toBe(56);
    expect(dayHeightPx()).toBe(24 * 56);
    expect(timeToOffsetPx(at(6), DAY0)).toBe(336);
    // 15 分钟 = 14px，1 小时 = 56px
    expect(timeToOffsetPx(at(6, 15), DAY0)).toBe(350);
    expect(timeToOffsetPx(at(7), DAY0) - timeToOffsetPx(at(6), DAY0)).toBe(56);
  });

  it("offsetPxToTime 是 timeToOffsetPx 的逆运算", () => {
    const ts = at(14, 30);
    const px = timeToOffsetPx(ts, DAY0);
    expect(px).toBeCloseTo(870 * PX_PER_MINUTE, 6);
    expect(offsetPxToTime(px, DAY0)).toBe(ts);
    // 反向：312px → 05:34 附近
    expect(offsetPxToTime(336, DAY0)).toBe(at(6));
  });
});

describe("吸附 15 分钟", () => {
  it("14:07 吸到 14:00，14:08 吸到 14:15", () => {
    expect(snapToStep(at(14, 7))).toBe(at(14));
    expect(snapToStep(at(14, 8))).toBe(at(14, 15));
    // 14:22 离 14:15 更近（7 分钟），14:23 才轮到 14:30
    expect(snapToStep(at(14, 22))).toBe(at(14, 15));
    expect(snapToStep(at(14, 23))).toBe(at(14, 30));
  });

  it("跨零点时吸到次日 00:00，且结果一定落在 15 分钟刻度上", () => {
    const snapped = snapToStep(at(23, 53));
    expect(snapped).toBe(addDays(DAY0, 1));
    for (const minute of [0, 1, 7, 8, 14, 29, 44, 59]) {
      const value = snapToStep(at(10, minute));
      expect(new Date(value).getMinutes() % 15).toBe(0);
    }
  });
});

describe("重叠分列（贪心 + 区间划分）", () => {
  const interval = (key: string, startHour: number, endHour: number, endMinute = 0) => ({
    key,
    startAt: at(startHour),
    endAt: at(endHour, endMinute),
  });

  it("不重叠的事件各占满一整列", () => {
    const layout = layoutDay([interval("a", 9, 10), interval("b", 11, 12)], DAY0);
    expect(layout.columns).toBe(1);
    expect(layout.placed.map((placed) => placed.width)).toEqual([1, 1]);
    expect(layout.placed.map((placed) => placed.left)).toEqual([0, 0]);
    expect(layout.overflow).toHaveLength(0);
  });

  it("两个重叠事件各占一半宽度，并按开始时间排序", () => {
    const layout = layoutDay(
      [interval("b", 9, 10, 30), interval("a", 8, 9, 30)],
      DAY0,
    );
    expect(layout.columns).toBe(2);
    const first = layout.placed[0]!;
    const second = layout.placed[1]!;
    expect(first.item.key).toBe("a");
    expect(second.item.key).toBe("b");
    expect(first.column).toBe(0);
    expect(first.left).toBe(0);
    expect(first.width).toBe(0.5);
    expect(second.column).toBe(1);
    expect(second.left).toBe(0.5);
    expect(second.width).toBe(0.5);
    // a 是 08:00 起、1.5 小时 → top = 8 × 56 = 448、height = 84
    expect(first.top).toBe(8 * 56);
    expect(first.height).toBe(84);
  });

  it("三个互相重叠 → 三列，每个 1/3 宽", () => {
    const layout = layoutDay(
      [interval("a", 9, 10), interval("b", 9, 10), interval("c", 9, 10)],
      DAY0,
    );
    expect(layout.columns).toBe(3);
    expect(layout.placed.map((placed) => placed.column)).toEqual([0, 1, 2]);
    expect(layout.placed.every((placed) => Math.abs(placed.width - 1 / 3) < 1e-9)).toBe(true);
  });

  it("链式重叠分成两个簇：前两个两列，后面那个独占整行", () => {
    const layout = layoutDay(
      [interval("a", 9, 10), interval("b", 9, 10, 30), interval("c", 11, 12)],
      DAY0,
    );
    const byKey = new Map(layout.placed.map((placed) => [placed.item.key, placed]));
    expect(byKey.get("a")!.columns).toBe(2);
    expect(byKey.get("b")!.columns).toBe(2);
    expect(byKey.get("c")!.columns).toBe(1);
    expect(byKey.get("c")!.width).toBe(1);
  });

  it("超过 3 层时只渲染 3 列，第 4 个折叠成 +N", () => {
    const layout = layoutDay(
      [interval("a", 9, 10), interval("b", 9, 10), interval("c", 9, 10), interval("d", 9, 10)],
      DAY0,
    );
    expect(layout.columns).toBe(MAX_COLUMNS);
    expect(layout.placed.filter((placed) => placed.hidden)).toHaveLength(1);
    expect(layout.overflow).toHaveLength(1);
    expect(layout.overflow[0]!.count).toBe(1);
    // 隐藏的那个不参与渲染，宽度仍按 3 列算
    expect(layout.placed.find((placed) => placed.hidden)!.column).toBe(3);
  });

  it("跨天的事件在每一天各裁剪一段，并标记「前接 / 后续」", () => {
    const nextDay = addDays(DAY0, 1);
    const spanning = { key: "night", startAt: at(22), endAt: nextDay + 2 * HOUR };
    const firstDay = layoutDay([spanning], DAY0);
    expect(firstDay.placed[0]!.top).toBe(22 * 56);
    expect(firstDay.placed[0]!.height).toBe(2 * 56);
    expect(firstDay.placed[0]!.continuesAfter).toBe(true);
    expect(firstDay.placed[0]!.continuesBefore).toBe(false);

    const secondDay = layoutDay([spanning], nextDay);
    expect(secondDay.placed[0]!.top).toBe(0);
    expect(secondDay.placed[0]!.height).toBe(2 * 56);
    expect(secondDay.placed[0]!.continuesBefore).toBe(true);
    expect(secondDay.placed[0]!.continuesAfter).toBe(false);
  });

  it("没有结束时间的事件按 1 小时占位，短事件有 22px 的最小高度", () => {
    const layout = layoutDay(
      [
        { key: "open", startAt: at(9), endAt: null },
        { key: "tiny", startAt: at(13), endAt: at(13, 10) },
      ],
      DAY0,
    );
    const byKey = new Map(layout.placed.map((placed) => [placed.item.key, placed]));
    expect(byKey.get("open")!.height).toBe(56);
    expect(byKey.get("tiny")!.rawHeight).toBeLessThan(22);
    expect(byKey.get("tiny")!.height).toBe(22);
  });
});

describe("拖拽解析（含跨天）", () => {
  const event = { startAt: at(14), endAt: at(15, 30) };

  it("同一天往下拖 2 小时：时长不变，吸附到 16:00-17:30", () => {
    const next = resolveDrag({
      mode: "move",
      startAt: event.startAt,
      endAt: event.endAt,
      deltaDays: 0,
      deltaMinutes: 120,
    });
    expect(next.startAt).toBe(at(16));
    expect(next.endAt).toBe(at(17, 30));
    expect(next.endAt - next.startAt).toBe(event.endAt - event.startAt);
  });

  it("拖到非整刻度也会吸附到 15 分钟", () => {
    const next = resolveDrag({
      mode: "move",
      startAt: event.startAt,
      endAt: event.endAt,
      deltaDays: 0,
      deltaMinutes: 118, // 15:58 → 16:00
    });
    expect(next.startAt).toBe(at(16));
    expect(new Date(next.startAt).getMinutes() % 15).toBe(0);
  });

  it("跨天拖拽：跨两列后日期变成后天，时分保留", () => {
    const next = resolveDrag({
      mode: "move",
      startAt: event.startAt,
      endAt: event.endAt,
      deltaDays: 2,
      deltaMinutes: 0,
    });
    expect(new Date(next.startAt).getDate()).toBe(new Date(at(14)).getDate() + 2);
    expect(new Date(next.startAt).getHours()).toBe(14);
    expect(new Date(next.startAt).getMinutes()).toBe(0);
    expect(next.endAt - next.startAt).toBe(90 * MINUTE);
  });

  it("跨天 + 纵向偏移可以组合", () => {
    const next = resolveDrag({
      mode: "move",
      startAt: event.startAt,
      endAt: event.endAt,
      deltaDays: 2,
      deltaMinutes: 90,
    });
    expect(new Date(next.startAt).getHours()).toBe(15);
    expect(new Date(next.startAt).getMinutes()).toBe(30);
  });

  it("拉底边只改结束时间，且不小于 15 分钟", () => {
    const longer = resolveDrag({
      mode: "resize-end",
      startAt: at(14),
      endAt: at(15, 30),
      deltaDays: 0,
      deltaMinutes: 150,
    });
    expect(longer.startAt).toBe(at(14));
    expect(longer.endAt).toBe(at(18));

    const tooShort = resolveDrag({
      mode: "resize-end",
      startAt: at(14),
      endAt: at(15, 30),
      deltaDays: 0,
      deltaMinutes: -600,
    });
    expect(tooShort.endAt).toBe(at(14, 15));
  });

  it("拖拽气泡显示 14:30 - 15:30，跨天时带日期", () => {
    expect(dragBubbleLabel(at(14, 30), at(15, 30))).toBe("14:30 - 15:30");
    expect(dragBubbleLabel(at(23), addDays(DAY0, 1) + HOUR)).toContain("11月23日");
  });
});

describe("周期与网格生成", () => {
  it("周视图给出 7 个「日 0 点」，从周一开始", () => {
    const days = weekDayStarts(new Date(2026, 10, 25, 15, 30).getTime());
    expect(days).toHaveLength(7);
    expect(days[0]).toBe(startOfWeek(days[0]!));
    expect(new Date(days[0]!).getDay()).toBe(1);
    expect(days[6]! - days[0]!).toBe(6 * 24 * HOUR);
    expect(days.every((day) => day === startOfDay(day))).toBe(true);
  });

  it("月视图固定 6×7 = 42 格，第一格是周一，且包含当月 1 号", () => {
    const anchor = new Date(2026, 10, 15, 12).getTime();
    const days = monthGridStarts(anchor);
    expect(days).toHaveLength(42);
    expect(new Date(days[0]!).getDay()).toBe(1);
    expect(days[1]! - days[0]!).toBe(24 * HOUR);
    const firstOfMonth = new Date(2026, 10, 1).getTime();
    expect(days).toContain(firstOfMonth);
    // 1 号在第一行，行号 = 0
    expect(days.indexOf(firstOfMonth)).toBeLessThan(7);
  });

  it("视图区间：周 = 周一 00:00 起 7 天，日 = 当天 00:00 起 1 天", () => {
    const wed = new Date(2026, 10, 25, 15, 30).getTime();
    const week = viewRange("week", wed);
    expect(week.from).toBe(startOfWeek(wed));
    expect(new Date(week.from).getDay()).toBe(1);
    expect(new Date(week.from).getHours()).toBe(0);
    expect(week.to - week.from).toBe(7 * 24 * HOUR);

    const day = viewRange("day", wed);
    expect(day.from).toBe(startOfDay(wed));
    expect(day.to - day.from).toBe(24 * HOUR);
  });

  it("月视图翻页：1 月 31 日 → 2 月 28 日，不会漂到 3 月", () => {
    const jan31 = new Date(2026, 0, 31, 10).getTime();
    const next = shiftAnchor("month", jan31, 1);
    expect(new Date(next).getMonth()).toBe(1);
    expect(new Date(next).getDate()).toBe(28);
  });
});

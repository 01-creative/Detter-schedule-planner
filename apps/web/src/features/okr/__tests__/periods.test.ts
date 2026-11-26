import { describe, expect, it } from "vitest";
import { DAY, addDays, dayKey } from "@detter/shared";
import { OkrSchema } from "@detter/shared";
import type { Okr, OkrPeriod } from "@detter/shared";
import {
  findPreviousRangeWithOkrs,
  okrMatchesRange,
  okrPeriodText,
  okrRange,
  pickOkrsOfRange,
  shiftAnchor,
  shiftOkrRange,
} from "../periods";

/**
 * 周期边界：与 @detter/shared 的 periodRange 对齐 —— 周一开学、自然月/季/年。
 * 复盘页用同一套函数，所以这里锁住的就是两页共同的时间语义。
 */

const NOW = new Date(2026, 10, 26, 15, 0, 0).getTime(); // 2026-11-26 周四 15:00

function makeOkr(patch: Partial<Okr> & { id: string }): Okr {
  return OkrSchema.parse({
    title: `Objective ${patch.id}`,
    period: "week",
    periodStart: "2026-11-23",
    periodEnd: "2026-11-29",
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  });
}

describe("okrRange 周期边界", () => {
  it("周从周一开始，到周日结束", () => {
    const week = okrRange("week", NOW, NOW);
    expect(dayKey(week.start)).toBe("2026-11-23");
    expect(dayKey(week.end)).toBe("2026-11-29");
    expect(week.startKey).toBe("2026-11-23");
    expect(week.endKey).toBe("2026-11-29");
    expect(week.label).toBe("11/23 - 11/29");
    expect(week.caption).toBe("2026-11-23 → 2026-11-29 · 共 7 天");
    expect(week.isCurrent).toBe(true);
  });

  it("月按自然月，periodStart 是 1 号日期键", () => {
    const month = okrRange("month", NOW, NOW);
    expect(month.startKey).toBe("2026-11-01");
    expect(month.endKey).toBe("2026-11-30");
    expect(month.key).toBe("2026-11");
    expect(month.label).toBe("2026年11月");
  });

  it("季按自然季度", () => {
    const quarter = okrRange("quarter", NOW, NOW);
    expect(quarter.startKey).toBe("2026-10-01");
    expect(quarter.endKey).toBe("2026-12-31");
    expect(quarter.key).toBe("2026-Q4");
    expect(quarter.label).toBe("2026 Q4");
  });

  it("年按自然年", () => {
    const year = okrRange("year", NOW, NOW);
    expect(year.startKey).toBe("2026-01-01");
    expect(year.endKey).toBe("2026-12-31");
    expect(year.key).toBe("2026");
    expect(year.label).toBe("2026年");
  });

  it("跨年周会补上年份，避免 12/29 分不清是哪年", () => {
    const crossYear = new Date(2026, 11, 31, 12, 0, 0).getTime();
    expect(okrRange("week", crossYear, NOW).label).toBe("2026年 12/28 - 1/3");
  });
});

describe("周期平移", () => {
  const week = okrRange("week", NOW, NOW);
  const month = okrRange("month", NOW, NOW);

  it("周向前后各一周", () => {
    expect(shiftAnchor("week", week.start, -1)).toBe(addDays(week.start, -7));
    expect(shiftAnchor("week", week.start, 1)).toBe(addDays(week.start, 7));
  });

  it("跨年平移不会溢出（11 月 +2 = 次年 1 月）", () => {
    expect(shiftAnchor("month", month.start, 2)).toBe(new Date(2027, 0, 1).getTime());
    expect(shiftAnchor("month", month.start, -11)).toBe(new Date(2025, 11, 1).getTime());
    expect(shiftAnchor("quarter", okrRange("quarter", NOW, NOW).start, 1)).toBe(
      new Date(2027, 0, 1).getTime(),
    );
    expect(shiftAnchor("year", okrRange("year", NOW, NOW).start, -1)).toBe(
      new Date(2025, 0, 1).getTime(),
    );
  });

  it("shiftOkrRange 返回完整的新周期", () => {
    const previous = shiftOkrRange("week", week, -1, NOW);
    expect(previous.startKey).toBe("2026-11-16");
    expect(previous.endKey).toBe("2026-11-22");
    expect(previous.isCurrent).toBe(false);
    expect(dayKey(previous.end)).toBe(dayKey(week.start - DAY));
  });
});

describe("Objective 与周期的匹配", () => {
  const week = okrRange("week", NOW, NOW);

  it("period + periodStart 同时匹配才算；兼容 periodRange.key 写法", () => {
    expect(okrMatchesRange(makeOkr({ id: "a" }), week)).toBe(true);
    expect(okrMatchesRange(makeOkr({ id: "b", periodStart: "2026-11-16" }), week)).toBe(false);
    expect(okrMatchesRange(makeOkr({ id: "c", period: "month" }), week)).toBe(false);

    const month = okrRange("month", NOW, NOW);
    expect(
      okrMatchesRange(
        makeOkr({ id: "d", period: "month", periodStart: "2026-11", periodEnd: "2026-11-30" }),
        month,
      ),
    ).toBe(true);
  });

  it("pickOkrsOfRange 按 sortIndex 排序并过滤墓碑", () => {
    const list = [
      makeOkr({ id: "b", sortIndex: 2 }),
      makeOkr({ id: "a", sortIndex: 0 }),
      makeOkr({ id: "c", sortIndex: 1, deletedAt: 99 }),
    ];
    expect(pickOkrsOfRange(list, week).map((okr) => okr.id)).toEqual(["a", "b"]);
  });

  it("找不到上一期时返回 null，跨过空周期找到最近一期", () => {
    const month = okrRange("month", NOW, NOW);
    expect(findPreviousRangeWithOkrs([], "month", month, NOW)).toBeNull();

    const september = makeOkr({
      id: "sep",
      period: "month",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    });
    const found = findPreviousRangeWithOkrs([september], "month", month, NOW);
    expect(found?.startKey).toBe("2026-09-01");
    expect(found?.endKey).toBe("2026-09-30");
  });
});

describe("Objective 周期文字", () => {
  it("周/月/季/年各一句", () => {
    const cases: Array<[OkrPeriod, string, string]> = [
      ["week", "2026-11-23", "2026-11-23 → 2026-11-29"],
      ["month", "2026-11-01", "2026年11月"],
      ["quarter", "2026-11-01", "2026 Q4"],
      ["year", "2026-01-01", "2026年"],
    ];
    for (const [period, start, expected] of cases) {
      const okr = makeOkr({
        id: period,
        period,
        periodStart: start,
        periodEnd: period === "week" ? "2026-11-29" : "2026-12-31",
      });
      expect(okrPeriodText(okr)).toBe(expected);
    }
  });
});

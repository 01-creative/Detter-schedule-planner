import { describe, expect, it } from "vitest";
import { localWins, applyChange, type ChangeRow } from "../sync";
import { addDays, dayKey, periodRange, startOfWeek, isoWeekday } from "../time";

describe("time", () => {
  const t = new Date(2026, 10, 25, 10, 0, 0).getTime(); // 2026-11-25 周三

  it("dayKey 使用本地日历日", () => {
    expect(dayKey(t)).toBe("2026-11-25");
  });

  it("isoWeekday 周日=7", () => {
    expect(isoWeekday(t)).toBe(3);
    expect(isoWeekday(new Date(2026, 10, 29).getTime())).toBe(7);
  });

  it("startOfWeek 落在周一", () => {
    const mon = startOfWeek(t);
    expect(dayKey(mon)).toBe("2026-11-23");
  });

  it("periodRange week 覆盖 7 天", () => {
    const r = periodRange("week", t);
    expect(dayKey(r.start)).toBe("2026-11-23");
    expect(dayKey(r.end)).toBe("2026-11-29");
  });

  it("periodRange quarter", () => {
    const r = periodRange("quarter", t);
    expect(r.key).toBe("2026-Q4");
  });

  it("addDays 跨月安全", () => {
    expect(dayKey(addDays(new Date(2026, 10, 30).getTime(), 2))).toBe("2026-12-02");
  });
});

describe("sync 冲突消解", () => {
  it("时间更新的胜出", () => {
    expect(localWins({ updatedAt: 2 }, { updatedAt: 1 })).toBe(true);
    expect(localWins({ updatedAt: 1 }, { updatedAt: 2 })).toBe(false);
  });

  it("时间相同时按 deviceId 决胜，保证确定性", () => {
    expect(localWins({ updatedAt: 5, deviceId: "b" }, { updatedAt: 5, deviceId: "a" })).toBe(true);
    expect(localWins({ updatedAt: 5, deviceId: "a" }, { updatedAt: 5, deviceId: "b" })).toBe(false);
  });

  it("墓碑删除会从本地表移除", () => {
    const table = new Map<string, { id: string; rev: number }>();
    table.set("t1", { id: "t1", rev: 1 });
    applyChange(table, { entityId: "t1", deleted: true, payload: null, rev: 2 });
    expect(table.has("t1")).toBe(false);
  });

  it("旧版本变更不会覆盖新版本", () => {
    const table = new Map<string, { id: string; rev: number; title: string }>();
    table.set("t1", { id: "t1", rev: 3, title: "new" });
    applyChange(table, {
      entityId: "t1",
      deleted: false,
      payload: { id: "t1", rev: 2, title: "old" },
      rev: 2,
    });
    expect(table.get("t1")?.title).toBe("new");
  });
});

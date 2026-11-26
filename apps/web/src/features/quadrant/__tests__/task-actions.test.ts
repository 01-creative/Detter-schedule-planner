import { describe, expect, it } from "vitest";
import { buildTaskInput } from "../task-actions";

/**
 * 新建任务的坐标与象限必须在写库前定好：
 * quadrant 是坐标的函数，不是第二个输入。
 */
describe("buildTaskInput", () => {
  it("不传坐标时落在 Q2 近中心，并写 quadrant=2", () => {
    const input = buildTaskInput({ title: "随手记的" }, 1_700_000_000_000);
    expect(input.posX).toBeCloseTo(0.44, 5);
    expect(input.posY).toBeCloseTo(0.44, 5);
    expect(input.quadrant).toBe(2);
    expect(input.manualQuadrant).toBe(true);
  });

  it("显式坐标决定象限（0.8,0.2 → Q1）", () => {
    const input = buildTaskInput({ title: "交作业", posX: 0.8, posY: 0.2 });
    expect(input.quadrant).toBe(1);
    expect(input.posX).toBe(0.8);
    expect(input.posY).toBe(0.2);
  });

  it("越界坐标夹到 0..1，NaN 回退到中点", () => {
    const low = buildTaskInput({ title: "低", posX: -3, posY: 9 });
    expect(low.posX).toBe(0);
    expect(low.posY).toBe(1);
    expect(low.quadrant).toBe(4);

    const nan = buildTaskInput({ title: "坏", posX: Number.NaN, posY: Number.NaN });
    expect(nan.posX).toBe(0.5);
    expect(nan.posY).toBe(0.5);
  });

  it("每个象限的边界都能从坐标推出来", () => {
    const cases = [
      { posX: 0.8, posY: 0.2, quadrant: 1 },
      { posX: 0.2, posY: 0.2, quadrant: 2 },
      { posX: 0.8, posY: 0.8, quadrant: 3 },
      { posX: 0.2, posY: 0.8, quadrant: 4 },
    ] as const;
    for (const entry of cases) {
      expect(buildTaskInput({ title: "x", ...entry }).quadrant).toBe(entry.quadrant);
    }
  });
});

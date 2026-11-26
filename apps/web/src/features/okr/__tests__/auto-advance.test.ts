import { describe, expect, it } from "vitest";
import { KeyResultSchema, TaskSchema } from "@detter/shared";
import type { KeyResult, Task } from "@detter/shared";
import {
  autoAdvanceSignature,
  canAutoAdvance,
  nextAutoValue,
  shouldAutoAdvance,
  type AutoAdvanceConfig,
} from "../auto-advance";

/**
 * 自动推进的触发条件。
 * 这是唯一会「自己改库」的逻辑，宁可保守：非 number、没挂满任务、已经到目标、
 * 签名没变，都不动。
 */

function makeKr(patch: Partial<KeyResult> & { id: string }): KeyResult {
  return KeyResultSchema.parse({
    okrId: "okr-1",
    title: `KR ${patch.id}`,
    metricType: "number",
    startValue: 0,
    targetValue: 3,
    currentValue: 0,
    unit: "次",
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  });
}

function makeTask(patch: Partial<Task> & { id: string }): Task {
  return TaskSchema.parse({
    title: `任务 ${patch.id}`,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  });
}

const enabled: AutoAdvanceConfig = { enabled: true, step: 1 };
const doneTask = makeTask({ id: "t1", status: "done" });
const todoTask = makeTask({ id: "t1", status: "todo" });

describe("shouldAutoAdvance", () => {
  const kr = makeKr({ id: "k1", linkedTaskIds: ["t1"] });

  it("开关关闭 / 非 number 型都不触发", () => {
    expect(shouldAutoAdvance(kr, [doneTask], { enabled: false, step: 1 })).toBe(false);
    expect(shouldAutoAdvance(kr, [doneTask], undefined)).toBe(false);
    expect(
      shouldAutoAdvance({ ...kr, metricType: "percent" }, [doneTask], enabled),
    ).toBe(false);
  });

  it("任务没全部完成时不触发", () => {
    expect(shouldAutoAdvance(kr, [todoTask], enabled)).toBe(false);
    expect(shouldAutoAdvance(makeKr({ id: "k2" }), [doneTask], enabled)).toBe(false);
  });

  it("任务全部完成且签名变化时触发；签名相同则不重复加", () => {
    expect(shouldAutoAdvance(kr, [doneTask], enabled)).toBe(true);
    const signature = autoAdvanceSignature(kr, [doneTask]);
    expect(shouldAutoAdvance(kr, [doneTask], { ...enabled, lastSignature: signature })).toBe(false);
    expect(shouldAutoAdvance(kr, [doneTask], { ...enabled, lastSignature: "old" })).toBe(true);
  });

  it("已到目标、或有任务被删除时不动", () => {
    expect(
      shouldAutoAdvance({ ...kr, currentValue: 3 }, [doneTask], enabled),
    ).toBe(false);
    expect(shouldAutoAdvance({ ...kr, linkedTaskIds: ["t1", "t2"] }, [doneTask], enabled)).toBe(
      false,
    );
  });

  it("canAutoAdvance 只判断结构性前提", () => {
    expect(canAutoAdvance(kr)).toBe(true);
    expect(canAutoAdvance({ ...kr, metricType: "boolean" })).toBe(false);
    expect(canAutoAdvance({ ...kr, currentValue: 3 })).toBe(false);
    expect(canAutoAdvance({ ...kr, linkedTaskIds: [] })).toBe(false);
  });
});

describe("nextAutoValue", () => {
  it("按 step 递增，并在目标值处封顶", () => {
    expect(nextAutoValue(makeKr({ id: "a", currentValue: 1 }), enabled)).toBe(2);
    expect(nextAutoValue(makeKr({ id: "b", currentValue: 2.5 }), enabled)).toBe(3);
    expect(nextAutoValue(makeKr({ id: "c", currentValue: 0 }), { enabled: true, step: 0.5 })).toBe(0.5);
    expect(nextAutoValue(makeKr({ id: "d", currentValue: 0 }), { enabled: true, step: 0 })).toBe(1);
  });
});

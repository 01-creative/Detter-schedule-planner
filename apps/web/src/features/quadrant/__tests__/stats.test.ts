import { describe, expect, it } from "vitest";
import { TaskSchema } from "@detter/shared";
import type { Task } from "@detter/shared";
import { computeBoardStats } from "../stats";

function makeTask(patch: Partial<Task> & { id: string }): Task {
  return TaskSchema.parse({ title: `任务 ${patch.id}`, createdAt: 1, updatedAt: 1, ...patch });
}

describe("computeBoardStats", () => {
  const now = new Date(2026, 10, 26, 10, 0, 0, 0).getTime();

  const tasks = [
    makeTask({ id: "q1-today", quadrant: 1, posX: 0.8, posY: 0.2, dueAt: now + 3_600_000 }),
    makeTask({ id: "q2-plain", quadrant: 2, posX: 0.2, posY: 0.2 }),
    makeTask({ id: "q2-overdue", quadrant: 2, posX: 0.3, posY: 0.3, dueAt: now - 86_400_000 }),
    makeTask({ id: "q3-done", quadrant: 3, status: "done", posX: 0.8, posY: 0.8, dueAt: now - 1000 }),
    makeTask({ id: "q3-open", quadrant: 3, posX: 0.7, posY: 0.7, startAt: now + 1_800_000 }),
    makeTask({ id: "q4-dropped", quadrant: 4, status: "dropped", posX: 0.2, posY: 0.8 }),
  ];

  it("今日 / 逾期只算未完成，Q2 占比按未完成总量算", () => {
    const stats = computeBoardStats(tasks, now);
    expect(stats.open).toBe(4);
    expect(stats.overdue).toBe(1);
    expect(stats.today).toBe(2); // q1-today + q3-open
    expect(stats.q2Share).toBe(50); // 4 条未完成里 2 条在 Q2
  });

  it("四象限计数只算未完成，标题角标与圆点一致", () => {
    const stats = computeBoardStats(tasks, now);
    expect(stats.quadrants).toEqual({ 1: 1, 2: 2, 3: 1, 4: 0 });
  });

  it("没有任务时 Q2 占比为 0 而不是 NaN", () => {
    expect(computeBoardStats([], now)).toEqual({
      today: 0,
      overdue: 0,
      q2Share: 0,
      open: 0,
      quadrants: { 1: 0, 2: 0, 3: 0, 4: 0 },
    });
  });
});

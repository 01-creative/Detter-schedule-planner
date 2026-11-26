import { describe, expect, it, vi } from "vitest";
import { TaskSchema } from "@detter/shared";
import type { Quadrant, Task } from "@detter/shared";
import { COORD_VERSION, planLegacyMigration, runCoordinateMigration } from "../coord-migration";
import type { CoordinateMigrationDeps, LegacyPlanEntry } from "../coord-migration";
import { quadrantFromPosition } from "../geometry";

/**
 * 一次性坐标迁移。
 *
 * 迁移是「打开首页时顺手做掉」的后台动作，用户看不到过程；因此必须用单测锁住：
 * 公式对不对、重合的旧点会不会挤成一坨、标记之后会不会重复跑。
 */

function makeTask(
  id: string,
  quadrant: Quadrant,
  posX = 0.5,
  posY = 0.5,
  patch: Partial<Task> = {},
): Task {
  return TaskSchema.parse({
    id,
    title: `任务 ${id}`,
    createdAt: Number(id.replace(/\D/g, "")) || 1,
    updatedAt: 1,
    quadrant,
    posX,
    posY,
    ...patch,
  });
}

describe("planLegacyMigration", () => {
  it("四个象限的格内中心换算成平面的四个区块中心", () => {
    const plan = planLegacyMigration([
      makeTask("1", 1),
      makeTask("2", 2),
      makeTask("3", 3),
      makeTask("4", 4),
    ]);
    const byQuadrant = new Map(plan.map((entry) => [entry.quadrant, entry]));
    expect(byQuadrant.get(1)).toMatchObject({ x: 0.75, y: 0.25 });
    expect(byQuadrant.get(2)).toMatchObject({ x: 0.25, y: 0.25 });
    expect(byQuadrant.get(3)).toMatchObject({ x: 0.75, y: 0.75 });
    expect(byQuadrant.get(4)).toMatchObject({ x: 0.25, y: 0.75 });
  });

  it("同一格里重合的旧坐标会被错开，且仍留在原象限", () => {
    const plan = planLegacyMigration([
      makeTask("1", 2),
      makeTask("2", 2),
      makeTask("3", 2),
      makeTask("4", 2),
    ]);
    const points = plan.map((entry) => ({ x: entry.x, y: entry.y }));
    for (let i = 0; i < points.length; i += 1) {
      expect(quadrantFromPosition(points[i]!.x, points[i]!.y)).toBe(2);
      for (let j = i + 1; j < points.length; j += 1) {
        expect(
          Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y),
        ).toBeGreaterThanOrEqual(0.034);
      }
    }
  });

  it("按 createdAt 稳定排序，结果可重复", () => {
    const tasks = [makeTask("9", 2), makeTask("10", 2), makeTask("11", 2)];
    const first = planLegacyMigration(tasks).map((entry) => entry.task.id);
    const second = planLegacyMigration([...tasks].reverse()).map((entry) => entry.task.id);
    expect(first).toEqual(["9", "10", "11"]);
    expect(second).toEqual(first);
  });

  it("软删除的任务不参与迁移", () => {
    const plan = planLegacyMigration([
      makeTask("1", 1),
      makeTask("2", 1, 0.5, 0.5, { deletedAt: 123 }),
    ]);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.task.id).toBe("1");
  });

  it("非默认格内坐标按公式缩放，不会被二次压缩", () => {
    const [entry] = planLegacyMigration([makeTask("1", 3, 0.2, 0.8)]);
    expect(entry?.x).toBeCloseTo(0.6, 6);
    expect(entry?.y).toBeCloseTo(0.9, 6);
  });
});

interface FakeStore {
  tasks: Task[];
  version: string | null;
  writes: LegacyPlanEntry[];
  markerWrites: number;
}

function makeDeps(store: FakeStore): CoordinateMigrationDeps {
  return {
    readVersion: async () => store.version,
    loadAliveTasks: async () => store.tasks.filter((task) => !task.deletedAt),
    writeTaskPosition: async (entry) => {
      store.writes.push(entry);
      const index = store.tasks.findIndex((task) => task.id === entry.task.id);
      if (index >= 0) {
        store.tasks[index] = {
          ...store.tasks[index]!,
          posX: entry.x,
          posY: entry.y,
          quadrant: entry.quadrant,
        };
      }
    },
    writeVersion: async () => {
      store.markerWrites += 1;
      store.version = COORD_VERSION;
    },
  };
}

function makeStore(tasks: Task[]): FakeStore {
  return { tasks, version: null, writes: [], markerWrites: 0 };
}

describe("runCoordinateMigration", () => {
  it("第一次运行写入所有任务，最后才写版本标记", async () => {
    const store = makeStore([makeTask("1", 1), makeTask("2", 3)]);
    const markerOrder: string[] = [];
    const deps = makeDeps(store);
    const originalWrite = deps.writeTaskPosition;
    deps.writeTaskPosition = async (entry) => {
      markerOrder.push(entry.task.id);
      await originalWrite(entry);
    };
    deps.writeVersion = async () => {
      markerOrder.push("marker");
      store.markerWrites += 1;
      store.version = COORD_VERSION;
    };

    const result = await runCoordinateMigration(deps);
    expect(result).toEqual({ skipped: false, migrated: 2 });
    expect(store.writes).toHaveLength(2);
    expect(markerOrder).toEqual(["1", "2", "marker"]);
    expect(store.version).toBe(COORD_VERSION);
  });

  it("已经有 plane-v1 标记时完全跳过，不读写任务", async () => {
    const store = makeStore([makeTask("1", 1)]);
    store.version = COORD_VERSION;
    const load = vi.fn(async () => store.tasks);
    const write = vi.fn(async () => {});
    const result = await runCoordinateMigration({
      readVersion: async () => COORD_VERSION,
      loadAliveTasks: load,
      writeTaskPosition: write,
      writeVersion: async () => {
        throw new Error("不该再写标记");
      },
    });
    expect(result).toEqual({ skipped: true, migrated: 0 });
    expect(load).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("第二次运行幂等：坐标不再变化，也不再写库", async () => {
    const store = makeStore([makeTask("1", 2), makeTask("2", 2)]);
    const deps = makeDeps(store);
    await runCoordinateMigration(deps);
    const snapshot = store.tasks.map((task) => ({ posX: task.posX, posY: task.posY }));
    const writesAfterFirst = store.writes.length;

    const second = await runCoordinateMigration(deps);
    expect(second).toEqual({ skipped: true, migrated: 0 });
    expect(store.tasks.map((task) => ({ posX: task.posX, posY: task.posY }))).toEqual(snapshot);
    expect(store.writes).toHaveLength(writesAfterFirst);
  });

  it("空库也会写标记，下次不再扫描", async () => {
    const store = makeStore([]);
    const result = await runCoordinateMigration(makeDeps(store));
    expect(result.migrated).toBe(0);
    expect(store.markerWrites).toBe(1);
  });

  it("迁移后的 quadrant 与坐标一致（可用作筛选/统计）", async () => {
    const store = makeStore([
      makeTask("1", 1),
      makeTask("2", 2),
      makeTask("3", 3),
      makeTask("4", 4),
    ]);
    await runCoordinateMigration(makeDeps(store));
    for (const task of store.tasks) {
      expect(quadrantFromPosition(task.posX, task.posY)).toBe(task.quadrant);
    }
  });
});

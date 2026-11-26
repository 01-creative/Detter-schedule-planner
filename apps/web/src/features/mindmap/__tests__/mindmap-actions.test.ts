import { beforeEach, describe, expect, it } from "vitest";
import { TaskSchema } from "@detter/shared";
import type { Task } from "@detter/shared";
import { db } from "@/db";
import { createMindMap, createNode, patchNode } from "../mindmap-actions";
import {
  convertNodeToTask,
  deleteSubtree,
  generateFromGoal,
  pinNode,
  reparentNode,
  resolveGoalId,
  restoreNodes,
  setLinkedTaskDone,
} from "../mindmap-actions";
import { buildMindTree } from "../tree";

/**
 * 写操作的集成测试（跑在 fake-indexeddb 上）。
 *
 * 这些用例守的是「落库之后还能读回来」：转任务有没有带上 goalId、
 * 改父级有没有清掉手动坐标、删掉整棵子树再撤销能不能原样恢复。
 */

beforeEach(async () => {
  await db.delete();
  await db.open();
});

function makeTask(patch: Partial<Task> & { id: string; title: string }): Task {
  return TaskSchema.parse({ createdAt: 1, updatedAt: 1, ...patch });
}

async function aliveNodes() {
  const rows = await db.mindNodes.toArray();
  return rows.filter((row) => !row.deletedAt);
}

describe("建图与建节点", () => {
  it("落库时补齐默认值：坐标为 0（交给自动布局）、未折叠、无颜色", async () => {
    const map = await createMindMap({ title: "  学英语  " });
    expect(map.title).toBe("学英语");
    expect(map.viewportZoom).toBe(1);

    const root = await createNode({ mapId: map.id, parentId: null, text: "根" });
    const stored = await db.mindNodes.get(root.id);
    expect(stored).toMatchObject({
      mapId: map.id,
      parentId: null,
      text: "根",
      x: 0,
      y: 0,
      kind: "idea",
      refId: null,
      collapsed: false,
      deletedAt: null,
    });
  });

  it("拖到空白 → 写坐标；拖到节点上 → 改父级并清空坐标", async () => {
    const map = await createMindMap({ title: "图" });
    const root = await createNode({ mapId: map.id, parentId: null, text: "根" });
    const child = await createNode({ mapId: map.id, parentId: root.id, text: "子", sortIndex: 0 });

    const pinned = await pinNode(child, 320.6, -48.2);
    expect(pinned.x).toBe(321);
    expect(pinned.y).toBe(-48);

    const moved = await reparentNode(pinned, root.id, 2);
    expect(moved.parentId).toBe(root.id);
    expect(moved.sortIndex).toBe(2);
    expect([moved.x, moved.y]).toEqual([0, 0]);
  });
});

describe("删除子树与撤销", () => {
  it("删掉的是一整棵子树，撤销后父子关系原样恢复", async () => {
    const map = await createMindMap({ title: "图" });
    const root = await createNode({ mapId: map.id, parentId: null, text: "根" });
    const branch = await createNode({ mapId: map.id, parentId: root.id, text: "分支", sortIndex: 0 });
    const leafA = await createNode({ mapId: map.id, parentId: branch.id, text: "叶A", sortIndex: 0 });
    const leafB = await createNode({ mapId: map.id, parentId: branch.id, text: "叶B", sortIndex: 1 });
    const sibling = await createNode({ mapId: map.id, parentId: root.id, text: "另一支", sortIndex: 1 });

    const tree = buildMindTree(await aliveNodes());
    const snapshots = await deleteSubtree(tree, branch.id);
    expect(snapshots).toHaveLength(3);
    expect((await aliveNodes()).map((row) => row.id).sort()).toEqual([root.id, sibling.id].sort());

    await restoreNodes(snapshots);
    const restored = await aliveNodes();
    expect(restored).toHaveLength(5);
    const restoredTree = buildMindTree(restored);
    expect(restoredTree.parentOf.get(leafA.id)).toBe(branch.id);
    expect(restoredTree.parentOf.get(leafB.id)).toBe(branch.id);
    expect(restoredTree.childrenOf.get(root.id)?.sort()).toEqual([branch.id, sibling.id].sort());
  });
});

describe("节点转任务", () => {
  it("任务落进 Q2、带 goalId、节点变成 task 引用", async () => {
    const map = await createMindMap({ title: "图", goalId: "goal-1" });
    const root = await createNode({ mapId: map.id, parentId: null, text: "背单词" });

    const { task, node } = await convertNodeToTask(root, "goal-1");
    const storedTask = await db.tasks.get(task.id);
    expect(storedTask).toMatchObject({
      title: "背单词",
      quadrant: 2,
      status: "todo",
      goalId: "goal-1",
      source: "goal",
    });

    const storedNode = await db.mindNodes.get(root.id);
    expect(storedNode).toMatchObject({ kind: "task", refId: task.id, text: "背单词" });
    expect(node.refId).toBe(task.id);
  });

  it("任务完成后节点可以读到完成态（用于打勾变灰）", async () => {
    const map = await createMindMap({ title: "图" });
    const root = await createNode({ mapId: map.id, parentId: null, text: "跑步" });
    const { task } = await convertNodeToTask(root, null);

    const done = await setLinkedTaskDone(task.id, true);
    expect(done?.status).toBe("done");
    expect(done?.completedAt).toBeTypeOf("number");

    const reopened = await setLinkedTaskDone(task.id, false);
    expect(reopened?.status).toBe("todo");
    expect(reopened?.completedAt).toBeNull();
  });

  it("goalId 沿祖先链解析：最近的 goal 节点优先", async () => {
    const map = await createMindMap({ title: "图" });
    const goalNode = await createNode({
      mapId: map.id,
      parentId: null,
      text: "目标",
      kind: "goal",
      refId: "goal-9",
    });
    const mid = await createNode({ mapId: map.id, parentId: goalNode.id, text: "中间层" });
    const leaf = await createNode({ mapId: map.id, parentId: mid.id, text: "叶子" });
    const tree = buildMindTree(await aliveNodes());

    expect(resolveGoalId(tree, leaf.id)).toBe("goal-9");
    expect(resolveGoalId(tree, goalNode.id)).toBe("goal-9");
    await patchNode(mid, { kind: "goal", refId: "goal-mid" });
    const tree2 = buildMindTree(await aliveNodes());
    expect(resolveGoalId(tree2, leaf.id)).toBe("goal-mid");
  });
});

describe("从目标生成", () => {
  it("根 = 目标，第一层最多 12 个任务", async () => {
    const tasks = Array.from({ length: 15 }, (_, index) =>
      makeTask({ id: `t${index}`, title: `任务 ${index}`, goalId: "goal-1", sortIndex: index }),
    );
    await db.tasks.bulkPut(tasks);
    const goal = {
      id: "goal-1",
      title: "三个月拿下驾照",
      color: "#6355F6",
    } as Parameters<typeof generateFromGoal>[0];

    const result = await generateFromGoal(goal, tasks);
    expect(result.map.goalId).toBe("goal-1");
    expect(result.map.title).toBe("三个月拿下驾照");
    expect(result.root.kind).toBe("goal");
    expect(result.root.refId).toBe("goal-1");
    expect(result.children).toHaveLength(12);
    expect(result.children[0]?.refId).toBe("t0");
    expect(result.children.every((node) => node.parentId === result.root.id)).toBe(true);

    const live = await aliveNodes();
    expect(live).toHaveLength(13);
  });

  it("只带该目标下的任务，别的目标的不会被混进来", async () => {
    const tasks = [
      makeTask({ id: "a", title: "A", goalId: "goal-1" }),
      makeTask({ id: "b", title: "B", goalId: "goal-2" }),
      makeTask({ id: "c", title: "C", goalId: null }),
    ];
    const goal = { id: "goal-1", title: "目标一", color: "#6355F6" } as Parameters<
      typeof generateFromGoal
    >[0];
    const result = await generateFromGoal(goal, tasks);
    expect(result.children.map((node) => node.refId)).toEqual(["a"]);
  });
});

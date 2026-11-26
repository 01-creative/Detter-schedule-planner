import { describe, expect, it } from "vitest";
import { MindNodeSchema } from "@detter/shared";
import type { MindNode } from "@detter/shared";
import {
  buildMindTree,
  canReparent,
  isDescendant,
  nextSortIndex,
  subtreeIds,
} from "../tree";

/**
 * 父子关系是导图里最容易出脏数据的地方（同步冲突、脏 parentId、拖拽成环）。
 * 这些用例守的是「无论库里多脏，画布上都不会丢节点、不会死循环」。
 */

function makeNode(patch: Partial<MindNode> & { id: string }): MindNode {
  return MindNodeSchema.parse({
    mapId: "map-1",
    text: patch.id,
    createdAt: patch.createdAt ?? 1,
    updatedAt: patch.updatedAt ?? 1,
    ...patch,
  });
}

describe("buildMindTree", () => {
  it("兄弟按 sortIndex 排序，同值时按 createdAt 兜底", () => {
    const tree = buildMindTree([
      makeNode({ id: "root", parentId: null, sortIndex: 0 }),
      makeNode({ id: "c", parentId: "root", sortIndex: 2 }),
      makeNode({ id: "a", parentId: "root", sortIndex: 0, createdAt: 5 }),
      makeNode({ id: "b", parentId: "root", sortIndex: 0, createdAt: 3 }),
    ]);
    expect(tree.childrenOf.get("root")).toEqual(["b", "a", "c"]);
    expect(tree.order).toEqual(["root", "b", "a", "c"]);
  });

  it("层级与左右侧：根的第一个孩子（偶数 sortIndex）在右，深度向下继承侧", () => {
    const tree = buildMindTree([
      makeNode({ id: "root", parentId: null, sortIndex: 0 }),
      makeNode({ id: "r0", parentId: "root", sortIndex: 0 }),
      makeNode({ id: "l1", parentId: "root", sortIndex: 1 }),
      makeNode({ id: "r2", parentId: "root", sortIndex: 2 }),
      makeNode({ id: "deep", parentId: "l1", sortIndex: 0 }),
    ]);
    expect(tree.sideOf.get("r0")).toBe(1);
    expect(tree.sideOf.get("l1")).toBe(-1);
    expect(tree.sideOf.get("r2")).toBe(1);
    expect(tree.sideOf.get("deep")).toBe(-1);
    expect(tree.depthOf.get("deep")).toBe(2);
  });

  it("parentId 指向不存在的节点时被根收养，不会从画布上消失", () => {
    const tree = buildMindTree([
      makeNode({ id: "root", parentId: null, sortIndex: 0 }),
      makeNode({ id: "orphan", parentId: "ghost", sortIndex: 1 }),
    ]);
    expect(tree.rootId).toBe("root");
    expect(tree.parentOf.get("orphan")).toBe("root");
    expect(tree.childrenOf.get("root")).toContain("orphan");
    expect(tree.order).toContain("orphan");
  });

  it("互为父节点的环会被打断，依旧能遍历完整棵树", () => {
    const tree = buildMindTree([
      makeNode({ id: "r", parentId: null, sortIndex: 0 }),
      makeNode({ id: "a", parentId: "b", sortIndex: 1 }),
      makeNode({ id: "b", parentId: "a", sortIndex: 0 }),
    ]);
    expect(tree.rootId).toBe("r");
    expect(tree.order).toHaveLength(3);
    expect(tree.order[0]).toBe("r");
    // 不再存在 a→b→a 的闭环
    let cursor: string | null | undefined = "a";
    const seen = new Set<string>();
    while (cursor) {
      expect(seen.has(cursor)).toBe(false);
      seen.add(cursor);
      cursor = tree.parentOf.get(cursor) ?? null;
    }
  });

  it("折叠会让整棵子树标记为 hidden", () => {
    const tree = buildMindTree([
      makeNode({ id: "root", parentId: null, sortIndex: 0, collapsed: true }),
      makeNode({ id: "child", parentId: "root", sortIndex: 0 }),
      makeNode({ id: "grand", parentId: "child", sortIndex: 0 }),
    ]);
    expect(tree.hiddenOf.get("root")).toBe(false);
    expect(tree.hiddenOf.get("child")).toBe(true);
    expect(tree.hiddenOf.get("grand")).toBe(true);
  });

  it("空列表不抛错", () => {
    const tree = buildMindTree([]);
    expect(tree.rootId).toBeNull();
    expect(tree.order).toEqual([]);
  });
});

describe("子树与改父级", () => {
  const nodes = [
    makeNode({ id: "root", parentId: null, sortIndex: 0 }),
    makeNode({ id: "a", parentId: "root", sortIndex: 0 }),
    makeNode({ id: "a1", parentId: "a", sortIndex: 0 }),
    makeNode({ id: "b", parentId: "root", sortIndex: 1 }),
  ];
  const tree = buildMindTree(nodes);

  it("subtreeIds 含自身，只收自己那一支", () => {
    expect(subtreeIds(tree, "a")).toEqual(["a", "a1"]);
    expect(subtreeIds(tree, "a1")).toEqual(["a1"]);
    expect(subtreeIds(tree, "root").sort()).toEqual(["a", "a1", "b", "root"]);
    expect(subtreeIds(tree, "ghost")).toEqual([]);
  });

  it("isDescendant 只看真正的后代", () => {
    expect(isDescendant(tree, "a", "a1")).toBe(true);
    expect(isDescendant(tree, "root", "a1")).toBe(true);
    expect(isDescendant(tree, "a1", "a")).toBe(false);
    expect(isDescendant(tree, "a", "a")).toBe(false);
  });

  it("canReparent 拒绝自己、自己的后代和原地不动", () => {
    expect(canReparent(tree, "a", "a").reason).toBe("self");
    expect(canReparent(tree, "a", "a1").reason).toBe("descendant");
    expect(canReparent(tree, "a", "root").reason).toBe("same-parent");
    expect(canReparent(tree, "a", "b").ok).toBe(true);
    expect(canReparent(tree, "ghost", "b").reason).toBe("missing");
  });

  it("nextSortIndex 取兄弟最大值 + 1", () => {
    const uneven = buildMindTree([
      makeNode({ id: "root", parentId: null, sortIndex: 0 }),
      makeNode({ id: "x", parentId: "root", sortIndex: 4 }),
      makeNode({ id: "y", parentId: "root", sortIndex: 9 }),
    ]);
    expect(nextSortIndex(uneven, "root")).toBe(10);
    expect(nextSortIndex(uneven, "x")).toBe(0);
    // childrenOf.get(null) 里放的是根节点本身，不会有人往这里插兄弟
    expect(nextSortIndex(uneven, null)).toBe(1);
  });
});

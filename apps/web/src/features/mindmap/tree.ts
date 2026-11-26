import type { MindNode } from "@detter/shared";

/**
 * 导图的树结构推导。
 *
 * 库里存的是「扁平的一堆 node + parentId」，但画布上要的是树。所有与父子关系有关的
 * 判断（建子节点、改父级、删子树、折叠、布局）都从这里拿同一份结构，避免各处
 * 各写一遍 `nodes.filter(n => n.parentId === id)` 然后各错各的。
 *
 * 三个必须兜住的脏数据场景：
 * 1. parentId 指向一个被删掉/不存在的节点 —— 该节点会被「收养」到根，绝不凭空消失；
 * 2. 两条记录互为父节点（同步冲突的典型残骸）—— 走一遍爬链检测，发现环就挂回根；
 * 3. 多棵树（历史数据里出现两个 parentId=null）—— 只认一棵，其余并入根，
 *    这样布局、连线、可见性都只需要处理单一根。
 */

export type NodeSide = 1 | -1;

export interface MindTree {
  /** 唯一根的 id；没有任何节点时为 null */
  rootId: string | null;
  byId: Map<string, MindNode>;
  /** parentId → 子节点 id（按 sortIndex 升序，同值时按 createdAt、id 兜底，保证稳定） */
  childrenOf: Map<string | null, string[]>;
  parentOf: Map<string, string | null>;
  depthOf: Map<string, number>;
  sideOf: Map<string, NodeSide | 0>;
  /** 祖先里有折叠节点 → 自己不该出现在画布上 */
  hiddenOf: Map<string, boolean>;
  /** 先序（根在前），包含被折叠隐藏的节点 */
  order: string[];
}

interface SiblingSortKey {
  sortIndex: number;
  createdAt: number;
  id: string;
}

/** 兄弟排序：sortIndex 为主，时间与 id 只是为了让同值时也有确定顺序。 */
export function compareSiblings(a: SiblingSortKey, b: SiblingSortKey): number {
  if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function isAlive(node: MindNode): boolean {
  return !node.deletedAt;
}

/**
 * 把扁平节点列表整理成一棵树。
 *
 * 时间复杂度 O(n log n)（只有兄弟排序是 n log n），500 节点无压力。
 */
export function buildMindTree(input: readonly MindNode[]): MindTree {
  const nodes = input.filter(isAlive);
  const byId = new Map<string, MindNode>();
  for (const node of nodes) {
    // 同 id 重复时保留 updatedAt 较新的那条（理论上不会发生，防御而已）
    const existing = byId.get(node.id);
    if (!existing || existing.updatedAt <= node.updatedAt) byId.set(node.id, node);
  }

  /* 1) 选出唯一的根：parentId 为空、指向自己、或指向不存在的节点都算候选。 */
  const parentOf = new Map<string, string | null>();
  const candidates: string[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId;
    if (!parent || parent === node.id || !byId.has(parent)) {
      parentOf.set(node.id, null);
      candidates.push(node.id);
    } else {
      parentOf.set(node.id, parent);
    }
  }

  const rootId =
    candidates.length === 0
      ? null
      : candidates.reduce((best, id) => {
          const a = byId.get(id)!;
          const b = byId.get(best)!;
          return compareSiblings(
            { sortIndex: a.sortIndex, createdAt: a.createdAt, id: a.id },
            { sortIndex: b.sortIndex, createdAt: b.createdAt, id: b.id },
          ) < 0
            ? id
            : best;
        }, candidates[0]!);

  // 没有根（例如父子链是个完整的环）时，取最早创建的那个当根，保证有东西可画
  let effectiveRoot = rootId;
  if (!effectiveRoot && byId.size > 0) {
    effectiveRoot = [...byId.values()].reduce((best, node) => {
      if (!best) return node.id;
      const a = byId.get(best)!;
      return compareSiblings(
        { sortIndex: node.sortIndex, createdAt: node.createdAt, id: node.id },
        { sortIndex: a.sortIndex, createdAt: a.createdAt, id: a.id },
      ) < 0
        ? node.id
        : best;
    }, null as string | null);
    parentOf.set(effectiveRoot!, null);
  }

  /* 2) 断链检测：顺着 parent 往上爬，爬回自己说明成环，把该节点挂回根。 */
  if (effectiveRoot) {
    for (const id of byId.keys()) {
      if (id === effectiveRoot) continue;
      const seen = new Set<string>([id]);
      let cursor = parentOf.get(id) ?? null;
      while (cursor) {
        if (cursor === id || seen.has(cursor)) {
          parentOf.set(id, effectiveRoot);
          break;
        }
        seen.add(cursor);
        cursor = parentOf.get(cursor) ?? null;
      }
    }
  }

  /* 3) 孤儿/多根收养：所有 parent 为 null 的非根节点挂到根下。 */
  for (const [id, parent] of parentOf) {
    if (parent === null && effectiveRoot && id !== effectiveRoot) {
      parentOf.set(id, effectiveRoot);
    }
  }

  /* 4) 建子索引并按兄弟规则排序。 */
  const childrenOf = new Map<string | null, string[]>();
  for (const id of byId.keys()) childrenOf.set(id, []);
  childrenOf.set(null, []);
  for (const [id, parent] of parentOf) {
    const key = parent ?? null;
    const list = childrenOf.get(key);
    if (list) list.push(id);
    else childrenOf.set(key, [id]);
  }
  for (const [key, list] of childrenOf) {
    if (list.length > 1) {
      list.sort((a, b) => {
        const na = byId.get(a)!;
        const nb = byId.get(b)!;
        return compareSiblings(
          { sortIndex: na.sortIndex, createdAt: na.createdAt, id: na.id },
          { sortIndex: nb.sortIndex, createdAt: nb.createdAt, id: nb.id },
        );
      });
    }
    childrenOf.set(key, list);
  }

  /* 5) 先序计算 depth / side / hidden。side 只由「根的第几个孩子」决定并向下继承，
     用 sortIndex 的奇偶而不是下标：新增节点不会把已有分支从一侧甩到另一侧。 */
  const depthOf = new Map<string, number>();
  const sideOf = new Map<string, NodeSide | 0>();
  const hiddenOf = new Map<string, boolean>();
  const order: string[] = [];

  if (effectiveRoot) {
    const stack: Array<{ id: string; depth: number; side: NodeSide | 0; hidden: boolean }> = [
      { id: effectiveRoot, depth: 0, side: 0, hidden: false },
    ];
    const visited = new Set<string>();

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      order.push(current.id);
      depthOf.set(current.id, current.depth);
      sideOf.set(current.id, current.side);
      hiddenOf.set(current.id, current.hidden);

      const node = byId.get(current.id)!;
      const children = childrenOf.get(current.id) ?? [];
      const nextHidden = current.hidden || node.collapsed;
      // 倒序入栈，出栈时才是 sortIndex 正序
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const childId = children[index]!;
        const side: NodeSide | 0 =
          current.side === 0 ? ((byId.get(childId)!.sortIndex % 2 === 0 ? 1 : -1) as NodeSide) : current.side;
        stack.push({ id: childId, depth: current.depth + 1, side, hidden: nextHidden });
      }
    }
  }

  return { rootId: effectiveRoot, byId, childrenOf, parentOf, depthOf, sideOf, hiddenOf, order };
}

/** 子树里所有节点 id（含自身），先序。 */
export function subtreeIds(tree: MindTree, nodeId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [nodeId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id) || !tree.byId.has(id)) continue;
    seen.add(id);
    out.push(id);
    const children = tree.childrenOf.get(id) ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]!);
  }
  return out;
}

/** candidate 是不是 ancestor 的后代（含自身传 false）。 */
export function isDescendant(tree: MindTree, ancestorId: string, candidateId: string): boolean {
  if (ancestorId === candidateId) return false;
  let cursor = tree.parentOf.get(candidateId) ?? null;
  let guard = 0;
  while (cursor && guard < 10_000) {
    if (cursor === ancestorId) return true;
    cursor = tree.parentOf.get(cursor) ?? null;
    guard += 1;
  }
  return false;
}

export interface ReparentCheck {
  ok: boolean;
  reason?: "self" | "descendant" | "missing" | "same-parent";
}

/**
 * 能否把 nodeId 挂到 targetId 下。
 * 最关键的否决条件是「目标在自己的子树里」——否则树会变成一个环，
 * 表现为布局里某个分支整体消失。
 */
export function canReparent(tree: MindTree, nodeId: string, targetId: string): ReparentCheck {
  if (!tree.byId.has(nodeId) || !tree.byId.has(targetId)) return { ok: false, reason: "missing" };
  if (nodeId === targetId) return { ok: false, reason: "self" };
  if (isDescendant(tree, nodeId, targetId)) return { ok: false, reason: "descendant" };
  if ((tree.parentOf.get(nodeId) ?? null) === targetId) return { ok: false, reason: "same-parent" };
  return { ok: true };
}

/** 父节点下应该插入的 sortIndex：当前最大值 + 1。 */
export function nextSortIndex(tree: MindTree, parentId: string | null): number {
  const children = tree.childrenOf.get(parentId) ?? [];
  let max = -1;
  for (const id of children) {
    const node = tree.byId.get(id);
    if (node) max = Math.max(max, node.sortIndex);
  }
  return max + 1;
}

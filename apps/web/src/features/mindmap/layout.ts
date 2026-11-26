import type { MindNode, MindNodeKind } from "@detter/shared";
import type { Bounds, Camera, ViewportSize } from "./camera";
import { visibleWorldRect } from "./camera";
import { buildMindTree, type MindTree } from "./tree";

/**
 * 左右树布局。
 *
 * 为什么是「左右树」而不是自由布局：这个页面的定位是「把一个目标拆成能执行的节点」，
 * 结构本身就是信息。方向（左右）、层级（横向距离）、顺序（纵向位置）都应该稳定可预期，
 * 而不是靠用户摆得好看。
 *
 * 三段式计算：
 * 1) 结构段：depth → x，叶子顺序 → row，父节点纵向居中于首尾子节点之间（tidy tree 的简化版），
 *    再折算出 y = row * 64。同一份结构永远得到同一个位置，不做任何随机/历史依赖。
 * 2) 手动段：`x/y` 非 0 的节点视为「手动拖过（pinned）」，用它的坐标覆盖结构位置；
 *    它的子树整体跟着平移，避免一次拖拽把树枝扯断。
 * 3) 裁剪段：只把视口 ±400px 内的节点交给 React 渲染（见 cullLayout）。
 *
 * 这里只有纯函数：不读 DOM、不读时间、不写库，因此可以直接单测。
 */

/** 横向层级间距（任务书 §3.3：x = depth * 220） */
export const X_GAP = 220;
/** 纵向兄弟间距（任务书 §3.3：y 递增 64） */
export const Y_GAP = 64;

export const NODE_MIN_WIDTH = 112;
export const NODE_MAX_WIDTH = 200;
export const NODE_PAD_X = 12;
export const NODE_PAD_Y = 9;
export const NODE_LINE_HEIGHT = 20;
export const NODE_MAX_LINES = 4;
/** 引用实体（目标/任务/KR）的只读标题条高度 */
export const NODE_CHIP_HEIGHT = 18;

const CJK_RE = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;

export interface LayoutNode {
  id: string;
  /** 原始实体，渲染文本/颜色/引用时直接读它 */
  node: MindNode;
  /** 左上角世界坐标 */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 距离根的层级（根为 0） */
  depth: number;
  /** +1 右侧 / -1 左侧 / 0 根 */
  side: 1 | -1 | 0;
  /** 纵向行号（叶子按顺序占整数行，父节点取子节点中值） */
  row: number;
  parentId: string | null;
  childIds: string[];
  /** 全部子节点数（含被折叠隐藏的），用于折叠圆点上的计数 */
  childCount: number;
  hasChildren: boolean;
  collapsed: boolean;
  /** 手动拖过：位置来自库里的 x/y，不参与自动布局 */
  pinned: boolean;
  isRoot: boolean;
}

export interface LayoutEdge {
  id: string;
  fromId: string;
  toId: string;
  /** 贝塞尔曲线 `M ... C ...` */
  path: string;
  /** 路径包围盒，用于视口裁剪 */
  box: Bounds;
}

export interface MindLayout {
  tree: MindTree;
  /** 先序；只含可见节点（被折叠的子树不在内） */
  nodes: LayoutNode[];
  byId: Map<string, LayoutNode>;
  edges: LayoutEdge[];
  /** 可见节点的世界包围盒 */
  bounds: Bounds;
}

export interface NodeSize {
  width: number;
  height: number;
}

/** 粗略估算一段文字的像素宽度：中文按 14px、西文按 7.4px，足够让宽度稳定而不抖动。 */
export function textWidthPx(text: string): number {
  let width = 0;
  for (const char of text) {
    width += CJK_RE.test(char) ? 14 : char === " " ? 4 : 7.4;
  }
  return width;
}

/**
 * 节点尺寸。
 *
 * 关键点：**宽度是算出来的，并且真的按这个宽度渲染**（节点卡片写死 width/height），
 * 这样连线端点、裁剪矩形、拖拽命中框三者永远一致，不需要 ResizeObserver 回读 DOM。
 * 高度按「行数 × 20 + 内边距（+ 引用条）」闭式算出，最多 4 行，超出裁掉。
 */
export function estimateNodeSize(
  text: string,
  options: { isRoot?: boolean; chip?: boolean } = {},
): NodeSize {
  const content = text.trim().length > 0 ? text.trim() : "新节点";
  const textWidth = textWidthPx(content);
  const minWidth = options.isRoot ? NODE_MIN_WIDTH + 20 : NODE_MIN_WIDTH;
  const width = Math.round(
    Math.min(NODE_MAX_WIDTH, Math.max(minWidth, textWidth + NODE_PAD_X * 2 + 4)),
  );
  const available = Math.max(24, width - NODE_PAD_X * 2 - 2);
  const lines = Math.max(1, Math.min(NODE_MAX_LINES, Math.ceil(textWidth / available)));
  const height =
    lines * NODE_LINE_HEIGHT +
    NODE_PAD_Y * 2 +
    2 +
    (options.chip ? NODE_CHIP_HEIGHT + 2 : 0);
  return { width, height };
}

/**
 * `x/y` 全 0 表示「没手动拖过」。
 *
 * 契约里 x/y 是必填 number（默认 0），没有单独的 pinned 字段，所以用「是否非零」判断：
 * 自动布局永远不会把非根节点放在 (0, 0)（非根节点 |x| ≥ 220），根节点落在 (0,0) 时
 * 自动位置本来就是 (0,0)，两边语义一致。
 */
export function isPinnedNode(node: Pick<MindNode, "x" | "y">): boolean {
  return node.x !== 0 || node.y !== 0;
}

function nodeChipVisible(kind: MindNodeKind, refId: string | null): boolean {
  if (!refId) return false;
  return kind === "goal" || kind === "task" || kind === "kr";
}

/** 连线：父节点朝向子节点一侧的边缘 → 子节点朝向父节点一侧的边缘。 */
export function edgePath(
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number },
): string {
  const fromCenterX = from.x + from.width / 2;
  const toCenterX = to.x + to.width / 2;
  const rightward = toCenterX >= fromCenterX;
  const x1 = rightward ? from.x + from.width : from.x;
  const x2 = rightward ? to.x : to.x + to.width;
  const y1 = from.y + from.height / 2;
  const y2 = to.y + to.height / 2;
  const dx = Math.max(28, Math.abs(x2 - x1) * 0.5);
  const c1 = rightward ? x1 + dx : x1 - dx;
  const c2 = rightward ? x2 - dx : x2 + dx;
  const round = (value: number) => Math.round(value * 10) / 10;
  return `M ${round(x1)} ${round(y1)} C ${round(c1)} ${round(y1)}, ${round(c2)} ${round(y2)}, ${round(x2)} ${round(y2)}`;
}

/** 三次贝塞尔的最小包围盒（控制点只会把曲线撑得更大，用它做保守裁剪判定足够）。 */
export function edgeBox(
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number },
): Bounds {
  const fromCenterX = from.x + from.width / 2;
  const toCenterX = to.x + to.width / 2;
  const rightward = toCenterX >= fromCenterX;
  const x1 = rightward ? from.x + from.width : from.x;
  const x2 = rightward ? to.x : to.x + to.width;
  const y1 = from.y + from.height / 2;
  const y2 = to.y + to.height / 2;
  const minX = Math.min(x1, x2) - 8;
  const maxX = Math.max(x1, x2) + 8;
  const minY = Math.min(y1, y2) - 8;
  const maxY = Math.max(y1, y2) + 8;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function emptyBounds(): Bounds {
  return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
}

/** 所有可见节点的包围盒。空图返回 0 尺寸（由 fitCamera 兜底成「屏幕中心」）。 */
export function layoutBounds(nodes: readonly LayoutNode[]): Bounds {
  if (nodes.length === 0) return emptyBounds();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * 计算整张图的布局。
 *
 * 结构段是递归的（先算子树、再定父节点的纵向中点），最大递归深度 = 树深；
 * 500 个节点的扁平结构（一两层）只有几毫秒，即便是一条 500 层的链也远低于栈上限。
 */
export function layoutMindMap(input: readonly MindNode[]): MindLayout {
  const tree = buildMindTree(input);
  const byId = new Map<string, LayoutNode>();
  const nodes: LayoutNode[] = [];
  /** 结构位置（未叠加 pinned 平移） */
  const baseX = new Map<string, number>();
  const baseY = new Map<string, number>();
  let nextRow = 0;

  const build = (id: string): LayoutNode | null => {
    const node = tree.byId.get(id);
    if (!node) return null;
    const isRoot = id === tree.rootId;
    const allChildren = tree.childrenOf.get(id) ?? [];
    // 折叠的节点不再为子树占行：收起后整棵树要真的变矮
    const visibleChildren = node.collapsed ? [] : allChildren;
    const childNodes: LayoutNode[] = [];
    for (const childId of visibleChildren) {
      const child = build(childId);
      if (child) childNodes.push(child);
    }

    const size = estimateNodeSize(node.text ?? "", {
      isRoot,
      chip: nodeChipVisible(node.kind, node.refId),
    });

    let row: number;
    if (childNodes.length === 0) {
      row = nextRow;
      nextRow += 1;
    } else {
      const first = childNodes[0]!.row;
      const last = childNodes[childNodes.length - 1]!.row;
      row = (first + last) / 2;
    }

    const depth = tree.depthOf.get(id) ?? 0;
    const side = tree.sideOf.get(id) ?? 0;
    const x = isRoot
      ? -size.width / 2
      : side === -1
        ? -depth * X_GAP - size.width
        : depth * X_GAP;
    const y = row * Y_GAP - size.height / 2;

    const layoutNode: LayoutNode = {
      id,
      node,
      x,
      y,
      width: size.width,
      height: size.height,
      depth,
      side,
      row,
      parentId: tree.parentOf.get(id) ?? null,
      childIds: childNodes.map((child) => child.id),
      childCount: allChildren.length,
      hasChildren: allChildren.length > 0,
      collapsed: Boolean(node.collapsed),
      pinned: isPinnedNode(node),
      isRoot,
    };
    baseX.set(id, x);
    baseY.set(id, y);
    byId.set(id, layoutNode);
    nodes.push(layoutNode);
    return layoutNode;
  };

  if (tree.rootId) build(tree.rootId);

  // nodes 是先序 push 的，但每个父节点在子树之后才 push（递归回来才 push），
  // 所以这里按 tree.order 重排一次，保证「父在前、子在后」。
  const ordered: LayoutNode[] = [];
  for (const id of tree.order) {
    const layoutNode = byId.get(id);
    if (layoutNode) ordered.push(layoutNode);
  }
  nodes.length = 0;
  nodes.push(...ordered);

  /* 手动位置：pinned 节点用库里的 x/y；它的后代整体跟着平移（不打断树枝）。 */
  const deltaOf = new Map<string, { x: number; y: number }>();
  for (const id of tree.order) {
    const layoutNode = byId.get(id);
    if (!layoutNode) continue;
    const parentId = layoutNode.parentId;
    const inherited = parentId ? deltaOf.get(parentId) : undefined;
    let delta = inherited ?? { x: 0, y: 0 };
    if (layoutNode.pinned) {
      const node = layoutNode.node;
      delta = { x: node.x - (baseX.get(id) ?? 0), y: node.y - (baseY.get(id) ?? 0) };
    }
    deltaOf.set(id, delta);
    layoutNode.x += delta.x;
    layoutNode.y += delta.y;
  }

  const edges: LayoutEdge[] = [];
  for (const layoutNode of nodes) {
    const parent = layoutNode.parentId ? byId.get(layoutNode.parentId) : undefined;
    if (!parent) continue;
    edges.push({
      id: `${parent.id}:${layoutNode.id}`,
      fromId: parent.id,
      toId: layoutNode.id,
      path: edgePath(parent, layoutNode),
      box: edgeBox(parent, layoutNode),
    });
  }

  return { tree, nodes, byId, edges, bounds: layoutBounds(nodes) };
}

function rectsIntersect(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** 节点矩形 → 包围盒（和 Bounds 同一套字段，省得裁剪时到处换算）。 */
function nodeBounds(node: { x: number; y: number; width: number; height: number }): Bounds {
  return {
    minX: node.x,
    minY: node.y,
    maxX: node.x + node.width,
    maxY: node.y + node.height,
    width: node.width,
    height: node.height,
  };
}

export interface CullResult {
  /** 视口（±margin）内的节点，先序 */
  nodes: LayoutNode[];
  /** 至少有一端在视口内的连线 */
  edges: LayoutEdge[];
  nodeIds: string[];
  edgeIds: string[];
  /** 可见集合的签名：用它做 memo 依赖，平移时只在「进出视口」那一刻重渲染 */
  signature: string;
}

/**
 * 视口裁剪。
 *
 * 500 个节点里通常只有几十个在屏幕内，剩下的既不渲染节点卡片也不渲染连线，
 * 这是「500 节点仍能拖」的第一道保险（第二道是拖拽走 ref，第三道是 React.memo）。
 */
export function cullLayout(
  layout: MindLayout,
  camera: Camera,
  viewport: ViewportSize,
  margin = 400,
): CullResult {
  const world = visibleWorldRect(camera, viewport, margin);
  const visibleIds = new Set<string>();
  const nodes: LayoutNode[] = [];

  for (const node of layout.nodes) {
    if (rectsIntersect(nodeBounds(node), world)) {
      visibleIds.add(node.id);
      nodes.push(node);
    }
  }

  const edges: LayoutEdge[] = [];
  const edgeIds: string[] = [];
  for (const edge of layout.edges) {
    // 只要有一端在视口内就画：否则拖动时会出现「节点在但线断了」的跳变
    if (visibleIds.has(edge.fromId) || visibleIds.has(edge.toId) || rectsIntersect(edge.box, world)) {
      edges.push(edge);
      edgeIds.push(edge.id);
    }
  }

  const nodeIds = nodes.map((node) => node.id);
  return {
    nodes,
    edges,
    nodeIds,
    edgeIds,
    signature: `${nodeIds.join(",")}#${edgeIds.join(",")}`,
  };
}

/** 连线是否高亮：选中的节点自己连出去的、连进来的都算。 */
export function isEdgeSelected(edge: LayoutEdge, selectedId: string | null): boolean {
  return Boolean(selectedId) && (edge.fromId === selectedId || edge.toId === selectedId);
}

import { describe, expect, it } from "vitest";
import { MindNodeSchema } from "@detter/shared";
import type { MindNode } from "@detter/shared";
import {
  X_GAP,
  Y_GAP,
  cullLayout,
  edgePath,
  estimateNodeSize,
  layoutMindMap,
  isEdgeSelected,
} from "../layout";

/**
 * 布局是纯计算，但如果算错，表现是「连线接到空气里」「拖过之后节点乱飞」，
 * 靠肉眼排查非常低效。所以这里把节点边界的量级、层级间距、折叠、裁剪都钉死。
 */

function makeNode(patch: Partial<MindNode> & { id: string }): MindNode {
  return MindNodeSchema.parse({
    mapId: "map-1",
    text: patch.id,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  });
}

/** 根 + 两个子节点（右 / 左）+ 一个孙节点 */
function buildSample(): MindNode[] {
  return [
    makeNode({ id: "root", text: "目标", parentId: null, sortIndex: 0 }),
    makeNode({ id: "r1", text: "子一", parentId: "root", sortIndex: 0 }),
    makeNode({ id: "l1", text: "子二", parentId: "root", sortIndex: 1 }),
    makeNode({ id: "r1a", text: "孙", parentId: "r1", sortIndex: 0 }),
  ];
}

describe("estimateNodeSize", () => {
  it("宽度随文字增长但夹在 112–200 之间，高度按行数算", () => {
    const short = estimateNodeSize("短");
    const long = estimateNodeSize("这是一个非常非常长的节点标题用来触发换行和行数上限的计算逻辑");
    expect(short.width).toBeGreaterThanOrEqual(112);
    expect(long.width).toBeLessThanOrEqual(200);
    expect(long.height).toBeGreaterThan(short.height);
    // 4 行封顶：120 字符也不会无限变高
    expect(long.height).toBeLessThanOrEqual(4 * 20 + 18 + 2);
  });

  it("带引用条的节点要高出 20px（18 + 2）", () => {
    expect(estimateNodeSize("任务", { chip: true }).height - estimateNodeSize("任务").height).toBe(20);
  });
});

describe("左右树布局", () => {
  it("根在中间，depth → x：右侧 +220，左侧 -220 - 宽度", () => {
    const layout = layoutMindMap(buildSample());
    const root = layout.byId.get("root")!;
    const right = layout.byId.get("r1")!;
    const left = layout.byId.get("l1")!;

    expect(root.x).toBeCloseTo(-root.width / 2, 5);
    expect(right.x).toBe(220);
    expect(right.x - root.x).toBeGreaterThan(0);
    expect(left.x).toBe(-X_GAP - left.width);
    expect(right.side).toBe(1);
    expect(left.side).toBe(-1);
    // 二级节点在二级层上
    expect(layout.byId.get("r1a")!.x).toBe(2 * X_GAP);
  });

  it("纵向：兄弟间距 ≥ 64，父节点居中于首尾子节点", () => {
    const layout = layoutMindMap(buildSample());
    const right = layout.byId.get("r1")!;
    const left = layout.byId.get("l1")!;
    const root = layout.byId.get("root")!;

    expect(left.row - right.row).toBe(1);
    expect(left.y - right.y).toBeGreaterThanOrEqual(Y_GAP);
    expect(root.row).toBeCloseTo((right.row + left.row) / 2, 5);
    // 父节点的纵向中心落在首尾子节点的中心之间
    expect(root.y + root.height / 2).toBeCloseTo((right.y + right.height / 2 + left.y + left.height / 2) / 2, 5);
  });

  it("先序输出：父节点一定排在子节点前面", () => {
    const layout = layoutMindMap(buildSample());
    const order = layout.nodes.map((node) => node.id);
    expect(order).toEqual(["root", "r1", "r1a", "l1"]);
  });

  it("折叠的节点不为子树占行：收起后布局里只剩自己", () => {
    const nodes = buildSample();
    nodes[0] = makeNode({ id: "root", text: "目标", parentId: null, sortIndex: 0, collapsed: true });
    const layout = layoutMindMap(nodes);
    expect(layout.nodes.map((node) => node.id)).toEqual(["root"]);
    expect(layout.edges).toHaveLength(0);
    expect(layout.byId.get("root")!.childCount).toBe(2);
    expect(layout.byId.get("root")!.collapsed).toBe(true);
  });
});

describe("手动位置（pinned）", () => {
  it("x/y 非 0 的节点保持自己的坐标，子树整体跟着平移", () => {
    const baseline = layoutMindMap(buildSample());
    const nodes = buildSample();
    nodes[1] = makeNode({ id: "r1", text: "子一", parentId: "root", sortIndex: 0, x: 500, y: 100 });
    const layout = layoutMindMap(nodes);
    const r1 = layout.byId.get("r1")!;
    const grandchild = layout.byId.get("r1a")!;

    expect(r1.pinned).toBe(true);
    expect(r1.x).toBe(500);
    expect(r1.y).toBe(100);
    // 孙节点本身没有被拖过，但要跟着父节点一起移动同样的位移
    const originalR1 = baseline.byId.get("r1")!;
    const originalGrandchild = baseline.byId.get("r1a")!;
    expect(grandchild.x - originalGrandchild.x).toBeCloseTo(500 - originalR1.x, 5);
    expect(grandchild.y - originalGrandchild.y).toBeCloseTo(100 - originalR1.y, 5);
    expect(grandchild.pinned).toBe(false);
  });

  it("根节点被拖走后整棵树跟着走；0/0 视为未手动拖动", () => {
    const baseline = layoutMindMap(buildSample());
    const nodes = buildSample();
    nodes[0] = makeNode({ id: "root", text: "目标", parentId: null, sortIndex: 0, x: 40, y: 60 });
    const layout = layoutMindMap(nodes);
    const root = layout.byId.get("root")!;
    const right = layout.byId.get("r1")!;
    const deltaX = 40 - baseline.byId.get("root")!.x;
    const deltaY = 60 - baseline.byId.get("root")!.y;

    expect(root.x).toBe(40);
    expect(root.y).toBe(60);
    expect(right.x).toBeCloseTo(baseline.byId.get("r1")!.x + deltaX, 5);
    expect(right.y).toBeCloseTo(baseline.byId.get("r1")!.y + deltaY, 5);
    expect(layout.byId.get("l1")!.pinned).toBe(false);
  });
});

describe("连线", () => {
  it("右侧子节点：从父节点右边缘连到子节点左边缘的贝塞尔曲线", () => {
    const layout = layoutMindMap(buildSample());
    const edge = layout.edges.find((item) => item.toId === "r1")!;
    const parent = layout.byId.get("root")!;
    const child = layout.byId.get("r1")!;
    const expected = edgePath(parent, child);
    expect(edge.path).toBe(expected);
    expect(edge.path.startsWith(`M ${parent.x + parent.width} ${parent.y + parent.height / 2}`)).toBe(true);
    expect(edge.path.endsWith(`${child.x} ${child.y + child.height / 2}`)).toBe(true);
    expect(edge.path).toContain("C");
  });

  it("左侧子节点从父节点左边缘连出，方向相反", () => {
    const layout = layoutMindMap(buildSample());
    const edge = layout.edges.find((item) => item.toId === "l1")!;
    const parent = layout.byId.get("root")!;
    expect(edge.path.startsWith(`M ${parent.x} `)).toBe(true);
  });

  it("选中节点相邻的连线高亮，其它不受影响", () => {
    const layout = layoutMindMap(buildSample());
    const edge = layout.edges.find((item) => item.toId === "r1")!;
    expect(isEdgeSelected(edge, "root")).toBe(true);
    expect(isEdgeSelected(edge, "l1")).toBe(false);
    expect(isEdgeSelected(edge, null)).toBe(false);
  });
});

describe("视口裁剪", () => {
  it("视口外的节点不渲染，±400 的余量内仍然渲染", () => {
    const nodes = [
      makeNode({ id: "root", text: "根", parentId: null, sortIndex: 0 }),
      makeNode({ id: "near", text: "近", parentId: "root", sortIndex: 0, x: 1100, y: 0 }),
      makeNode({ id: "farParent", text: "远分支", parentId: "root", sortIndex: 2, x: 6000, y: 3000 }),
      makeNode({ id: "farChild", text: "远的子", parentId: "farParent", sortIndex: 0, x: 6220, y: 3000 }),
    ];
    const layout = layoutMindMap(nodes);
    const camera = { x: 0, y: 0, zoom: 1 };
    const culled = cullLayout(layout, camera, { width: 800, height: 600 }, 400);
    const ids = culled.nodes.map((node) => node.id);
    expect(ids).toContain("root");
    expect(ids).toContain("near");
    expect(ids).not.toContain("farParent");
    expect(ids).not.toContain("farChild");
    // 跨过视口的线仍要画（否则会看到「节点在、线断了」），两端都在视口外的线跳过
    expect(culled.edgeIds).toContain("root:farParent");
    expect(culled.edgeIds).not.toContain("farParent:farChild");
  });

  it("缩放后可见集合变大；签名只在集合变化时变", () => {
    const nodes = [
      makeNode({ id: "root", text: "根", parentId: null, sortIndex: 0 }),
      makeNode({ id: "a", text: "甲", parentId: "root", sortIndex: 0 }),
      makeNode({ id: "b", text: "乙", parentId: "root", sortIndex: 2, x: 1200, y: 0 }),
    ];
    const layout = layoutMindMap(nodes);
    const at1 = cullLayout(layout, { x: 0, y: 0, zoom: 1 }, { width: 400, height: 300 }, 100);
    const at025 = cullLayout(layout, { x: 0, y: 0, zoom: 0.25 }, { width: 400, height: 300 }, 100);
    expect(at1.nodeIds).not.toContain("b");
    expect(at025.nodeIds).toContain("b");
    expect(at1.signature).not.toBe(at025.signature);
  });
});

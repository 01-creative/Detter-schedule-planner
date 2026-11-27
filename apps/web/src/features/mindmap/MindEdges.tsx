import { memo } from "react";
import { isEdgeSelected, type LayoutEdge } from "./layout";

/**
 * 连线层。
 *
 * 整张图只有这一个 `<svg>`：500 个节点各挂一个 svg 会直接把合成层数量打爆。
 * 坐标直接用世界坐标，svg 自身是 1×1 + `overflow: visible`（与 React Flow 相同的做法），
 * 因此既不需要给巨大的 viewBox 留内存，也不用为每条线写 transform。
 *
 * 注意：这里**不能**加「每次渲染都用 props 重写 d」的 effect。
 * 拖动时节点与连线都是命令式更新的，松手瞬间由 MindMapStage 用本地算出的布局抢先画对；
 * 如果这里再用（可能还没更新的）props 覆盖一次，就会把刚画对的路径又踩回旧位置——
 * 那正是「松手后线条飞出去」的成因。
 */

export interface MindEdgesProps {
  edges: readonly LayoutEdge[];
  selectedId: string | null;
}

function MindEdgesInner({ edges, selectedId }: MindEdgesProps) {
  return (
    <svg
      aria-hidden="true"
      data-testid="mindmap-edges"
      width={1}
      height={1}
      className="pointer-events-none absolute top-0 left-0"
      style={{ overflow: "visible" }}
    >
      {edges.map((edge) => {
        const selected = isEdgeSelected(edge, selectedId);
        return (
          <path
            key={edge.id}
            data-edge-id={edge.id}
            d={edge.path}
            fill="none"
            strokeWidth={selected ? 2 : 1.5}
            strokeLinecap="round"
            style={{ stroke: selected ? "var(--accent)" : "var(--border-strong)" }}
          />
        );
      })}
    </svg>
  );
}

export const MindEdges = memo(MindEdgesInner);
MindEdges.displayName = "MindEdges";

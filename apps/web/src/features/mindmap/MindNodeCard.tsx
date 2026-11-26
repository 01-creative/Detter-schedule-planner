import { memo, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { CircleCheck, Gauge, Lightbulb, ListTodo, StickyNote, Target } from "lucide-react";
import type { MindNodeKind } from "@detter/shared";
import { cn } from "@detter/ui";
import {
  NODE_PAD_X,
  NODE_PAD_Y,
  estimateNodeSize,
  type LayoutNode,
} from "./layout";

/**
 * 一个节点。
 *
 * 性能上的三条硬约定（见任务书 §4）：
 * 1. `React.memo` + 全部 props 都是原始值/稳定回调 —— 平移、缩放、拖另一个节点时它不重渲染；
 * 2. 位置写在 `style.transform` 上，拖拽期间由 stage 直接用 ref 改这个字符串，
 *    不触发任何 setState；
 * 3. 尺寸是算出来的定值（width/height 都写死），连线端点和命中框因此永远对得上。
 */

export type EditIntent = "commit" | "child" | "cancel";

export interface MindNodeCardProps {
  layoutNode: LayoutNode;
  selected: boolean;
  editing: boolean;
  dropTarget: boolean;
  /** 正在被拖动：半透明 + 重投影，避免完全盖住落点目标 */
  dragging: boolean;
  /** 关联任务是任务时的完成态；不适用传 null */
  taskDone: boolean | null;
  /** 引用实体的标题（目标 / 任务），没有引用传 null */
  refTitle: string | null;
  /** 引用条的说明文字，例如「目标」「任务」 */
  refLabel: string | null;
  onPointerDown: (layoutNode: LayoutNode, event: ReactPointerEvent<HTMLElement>) => void;
  onDoubleClick: (layoutNode: LayoutNode) => void;
  onToggleCollapse: (layoutNode: LayoutNode) => void;
  onToggleTask: (layoutNode: LayoutNode) => void;
  onOpenRef: (layoutNode: LayoutNode) => void;
  onEditEnd: (layoutNode: LayoutNode, text: string | null, intent: EditIntent) => void;
  registerRef: (id: string, element: HTMLElement | null) => void;
}

const KIND_ICON: Record<MindNodeKind, typeof Lightbulb | null> = {
  idea: null,
  note: StickyNote,
  goal: Target,
  task: ListTodo,
  kr: Gauge,
};

const KIND_LABEL: Record<MindNodeKind, string> = {
  idea: "想法",
  note: "笔记",
  goal: "目标",
  task: "任务",
  kr: "KR",
};

function MindNodeCardInner({
  layoutNode,
  selected,
  editing,
  dropTarget,
  dragging,
  taskDone,
  refTitle,
  refLabel,
  onPointerDown,
  onDoubleClick,
  onToggleCollapse,
  onToggleTask,
  onOpenRef,
  onEditEnd,
  registerRef,
}: MindNodeCardProps) {
  const { node, side, width, height, isRoot, childCount, collapsed } = layoutNode;
  const [draft, setDraft] = useState(node.text);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // 进入编辑态时重置草稿并全选：新建出来的「新节点」直接输入即替换
  useEffect(() => {
    if (!editing) return;
    setDraft(node.text);
    const element = textareaRef.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    element.select();
  }, [editing, node.text]);

  // 自动高度：先归零再按 scrollHeight 撑开，才能随删字变矮
  useEffect(() => {
    if (!editing) return;
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.max(20, element.scrollHeight)}px`;
  }, [editing, draft]);

  const Icon = KIND_ICON[node.kind];
  const done = taskDone === true;
  const editWidth = editing
    ? Math.max(width, estimateNodeSize(draft, { isRoot, chip: Boolean(refTitle) }).width)
    : width;
  const accent = node.color ?? undefined;

  const finish = (intent: EditIntent) => {
    if (intent === "cancel") {
      onEditEnd(layoutNode, null, "cancel");
      return;
    }
    onEditEnd(layoutNode, draft, intent);
  };

  return (
    <article
      ref={(element) => registerRef(layoutNode.id, element)}
      data-node-id={layoutNode.id}
      data-kind={node.kind}
      data-selected={selected ? "true" : undefined}
      data-drop-target={dropTarget ? "true" : undefined}
      data-dragging={dragging ? "true" : undefined}
      data-done={done ? "true" : undefined}
      role="treeitem"
      aria-selected={selected}
      aria-level={layoutNode.depth + 1}
      aria-label={`${KIND_LABEL[node.kind]}：${node.text || "未命名"}`}
      tabIndex={selected ? 0 : -1}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: editWidth,
        height: editing ? "auto" : height,
        padding: `${NODE_PAD_Y}px ${NODE_PAD_X}px`,
        transform: `translate3d(${layoutNode.x}px, ${layoutNode.y}px, 0)`,
        borderColor: accent ?? undefined,
        boxShadow: dropTarget
          ? "0 0 0 2px var(--accent), 0 0 0 6px var(--accent-soft), var(--shadow-2)"
          : selected
            ? "0 0 0 2px var(--accent), var(--shadow-2)"
            : dragging
              ? "var(--shadow-3)"
              : undefined,
        touchAction: "none",
      }}
      className={cn(
        "pointer-events-auto cursor-grab touch-none rounded-md border border-border-strong bg-surface-solid text-ink-900 shadow-1 select-none",
        "transition-[box-shadow,background-color,border-color,opacity] duration-[var(--dur-1)] ease-out",
        isRoot && "font-strong",
        isRoot && !accent && "border-accent/40 bg-accent-soft",
        dropTarget && "bg-accent-soft",
        dragging && "cursor-grabbing opacity-80",
        !selected && !dropTarget && "hover:shadow-2",
        done && "text-ink-300 opacity-70",
      )}
      onPointerDown={(event) => onPointerDown(layoutNode, event)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onDoubleClick(layoutNode);
      }}
    >
      <div className="flex items-start gap-1.5">
        {node.kind === "task" && taskDone !== null && (
          <button
            type="button"
            aria-label={done ? "取消完成" : "标记完成"}
            aria-pressed={done}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onToggleTask(layoutNode);
            }}
            className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full text-success transition-transform duration-[var(--dur-1)] hover:scale-110"
          >
            {done ? (
              <CircleCheck className="size-4" aria-hidden="true" />
            ) : (
              <span className="size-3 rounded-full border border-border-strong" aria-hidden="true" />
            )}
          </button>
        )}
        {Icon && node.kind !== "task" && (
          <Icon className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden="true" />
        )}
        {editing ? (
          <textarea
            ref={textareaRef}
            value={draft}
            aria-label="节点文本"
            rows={1}
            className="w-full resize-none border-0 bg-transparent p-0 text-body leading-5 text-ink-900 outline-none"
            style={{ minHeight: 20 }}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => finish("commit")}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                finish("commit");
              } else if (event.key === "Tab") {
                event.preventDefault();
                finish("child");
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                finish("cancel");
              }
            }}
          />
        ) : (
          <p
            className={cn(
              "min-w-0 flex-1 whitespace-pre-wrap break-words text-body leading-5",
              done && "line-through",
            )}
            style={{ maxHeight: 4 * 20, overflow: "hidden" }}
          >
            {node.text || "未命名"}
          </p>
        )}
      </div>

      {refTitle && refLabel && (
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onOpenRef(layoutNode);
          }}
          className="mt-1 flex w-full items-center gap-1 truncate rounded-sm text-left text-micro text-ink-500 hover:text-accent"
          title={`${refLabel}：${refTitle}（点击跳转）`}
        >
          <span className="shrink-0 text-ink-300">{refLabel}</span>
          <span className="min-w-0 flex-1 truncate">{refTitle}</span>
        </button>
      )}

      {childCount > 0 && (
        <button
          type="button"
          aria-label={collapsed ? `展开 ${childCount} 个子节点` : "折叠子节点"}
          aria-expanded={!collapsed}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapse(layoutNode);
          }}
          style={side === -1 ? { left: -9 } : { right: -9 }}
          className={cn(
            "absolute top-1/2 z-10 grid size-[18px] -translate-y-1/2 place-items-center rounded-full border bg-surface-solid text-[10px] font-strong tabular",
            "transition-transform duration-[var(--dur-1)] hover:scale-110",
            collapsed ? "border-accent text-accent" : "border-border-strong text-ink-500",
          )}
        >
          {collapsed ? childCount : "−"}
        </button>
      )}
    </article>
  );
}

export const MindNodeCard = memo(MindNodeCardInner);
MindNodeCard.displayName = "MindNodeCard";

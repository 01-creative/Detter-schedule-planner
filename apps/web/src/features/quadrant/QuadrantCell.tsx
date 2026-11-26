import { useMemo, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, Plus } from "lucide-react";
import type { Goal, Quadrant, Task } from "@detter/shared";
import { QUADRANT_META } from "@detter/shared";
import { cn } from "@detter/ui";
import { TaskCard } from "@/components/common/TaskCard";
import { InlineComposer } from "./InlineComposer";
import { stackOffsets } from "./geometry";
import type { ViewMode } from "./types";

/**
 * 一个象限格。
 *
 * 三种形态：
 * - 列表（默认）：卡片纵向流式，格体独立滚动；
 * - 自由：卡片按 posX/posY 绝对定位，格体裁切、不滚动；
 * - 移动端：整页滚动，格体不再自己滚，并且可以折叠。
 *
 * 拖拽高亮由父级传进来的 `overQuadrant` / `goalDragActive` 决定：
 * 拖任务时只有目标格亮，拖目标时四格一起亮（因为「放到哪一格」就是「这条任务进哪」）。
 */
export interface QuadrantCellProps {
  quadrant: Quadrant;
  tasks: Task[];
  viewMode: ViewMode;
  goalsById: Map<string, Goal>;
  selectedId: string | null;
  draggingTaskId: string | null;
  overQuadrant: Quadrant | null;
  goalDragActive: boolean;
  composer: { posX: number; posY: number } | null;
  preview: { taskId: string; posX: number; posY: number } | null;
  onOpen: (task: Task) => void;
  onToggleDone: (task: Task) => void;
  onContextMenu: (task: Task, event: ReactMouseEvent) => void;
  onStartDrag: (task: Task, event: ReactPointerEvent<HTMLElement>) => void;
  onCellContextMenu: (quadrant: Quadrant, event: ReactMouseEvent) => void;
  onCellDoubleClick: (quadrant: Quadrant, event: ReactMouseEvent) => void;
  onAdd: (quadrant: Quadrant) => void;
  onComposerSubmit: (title: string) => void;
  onComposerCancel: () => void;
}

export function QuadrantCell({
  quadrant,
  tasks,
  viewMode,
  goalsById,
  selectedId,
  draggingTaskId,
  overQuadrant,
  goalDragActive,
  composer,
  preview,
  onOpen,
  onToggleDone,
  onContextMenu,
  onStartDrag,
  onCellContextMenu,
  onCellDoubleClick,
  onAdd,
  onComposerSubmit,
  onComposerCancel,
}: QuadrantCellProps) {
  const meta = QUADRANT_META[quadrant];
  const accent = `var(--q${quadrant}-accent)`;
  const [collapsed, setCollapsed] = useState(false);
  const free = viewMode === "free";
  const isOver = overQuadrant === quadrant;
  const openCount = tasks.filter((task) => task.status !== "done" && task.status !== "dropped").length;
  const finishedCount = tasks.length - openCount;
  const stack = useMemo(() => stackOffsets(tasks), [tasks]);

  const highlightStyle = isOver
    ? { outline: `2px solid ${accent}`, outlineOffset: "-2px" }
    : goalDragActive
      ? { outline: "2px dashed var(--accent)", outlineOffset: "-2px" }
      : undefined;

  const positionStyle = (task: Task): CSSProperties => {
    const override = preview?.taskId === task.id ? preview : null;
    const posX = override?.posX ?? task.posX;
    const posY = override?.posY ?? task.posY;
    const offset = stack.get(task.id) ?? 0;
    return {
      "--pos-x": posX,
      "--pos-y": posY,
      "--stack-x": `${offset}px`,
      "--stack-y": `${offset}px`,
      left: "calc(var(--pos-x) * 100%)",
      top: "calc(var(--pos-y) * 100%)",
      transform:
        "translate(calc(var(--pos-x) * -100% + var(--stack-x)), calc(var(--pos-y) * -100% + var(--stack-y)))",
      width: "clamp(176px, 58%, 320px)",
      zIndex: offset > 0 ? 1 + Math.round(offset / 6) : undefined,
    } as CSSProperties;
  };

  const cardNode = (task: Task) => (
    <TaskCard
      task={task}
      goal={task.goalId ? (goalsById.get(task.goalId) ?? null) : null}
      dragging={draggingTaskId === task.id}
      selected={selectedId === task.id}
      onOpen={onOpen}
      onToggleDone={onToggleDone}
      onContextMenu={onContextMenu}
      onPointerDown={onStartDrag}
    />
  );

  /**
   * 拖拽中的源位置：卡片本体隐藏但保留布局，原位画一个虚线占位框。
   *
   * 结构必须从头到尾保持不变（占位 div + 内容 div），只切换类名：
   * 如果拖拽开始时才插入外层 div，React 会重建 article 节点，
   * 正在捕获指针的那个元素被移除，部分浏览器会直接发 pointercancel，拖拽当场断掉。
   */
  const dragSource = (task: Task) => {
    const isDragged = draggingTaskId === task.id;
    return (
      <div className="relative">
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 rounded-lg border border-dashed border-border-strong bg-surface-solid/35",
            !isDragged && "hidden",
          )}
        />
        <div className={isDragged ? "invisible" : undefined}>{cardNode(task)}</div>
      </div>
    );
  };

  return (
    <section
      data-q={quadrant}
      data-quadrant={quadrant}
      aria-labelledby={`quadrant-${quadrant}-title`}
      onContextMenu={(event) => {
        if (event.defaultPrevented) return;
        onCellContextMenu(quadrant, event);
      }}
      onDoubleClick={(event) => {
        if (event.defaultPrevented) return;
        const target = event.target as HTMLElement;
        if (target.closest("[data-task-id], button, input, textarea, select, [role='menu']")) return;
        onCellDoubleClick(quadrant, event);
      }}
      style={highlightStyle}
      className={cn(
        "quadrant-cell cell-inner-ring group/cell relative flex min-h-0 flex-col overflow-hidden rounded-2xl",
        "border border-white/50 shadow-1 dark:border-white/5",
        "transition-transform duration-[var(--dur-2)] ease-out",
        isOver && "scale-[1.005]",
        // 移动端 260 → 128：格子的高度不该由「最小高度」决定，而该由里面有几张卡决定。
        // 260 的时候一格只有一张卡也会留 150px 空白，四格叠起来就是半屏 —— 一屏看不满三个象限。
        "max-md:min-h-[128px]",
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 px-3.5">
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: accent }}
        />
        <h2
          id={`quadrant-${quadrant}-title`}
          className="shrink-0 text-[15px] leading-[22px] font-strong text-ink-900"
        >
          {meta.name}
        </h2>
        <span
          className="tabular shrink-0 rounded-full bg-surface-solid/70 px-1.5 text-micro text-ink-500"
          title={`${openCount} 条未完成`}
        >
          {openCount}
        </span>
        {finishedCount > 0 && (
          <span className="hidden shrink-0 text-micro text-ink-500/60 sm:inline">
            +{finishedCount} 完成
          </span>
        )}
        <p className="ml-1 hidden min-w-0 flex-1 truncate text-micro text-ink-500/60 lg:block">
          {meta.hint}
        </p>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onAdd(quadrant)}
            aria-label={`在「${meta.name}」新建任务`}
            className={cn(
              "relative inline-flex size-7 items-center justify-center rounded-md text-ink-500",
              "transition-colors duration-[var(--dur-1)] hover:bg-surface-solid/70 hover:text-ink-900",
              // 命中区 44×44（视觉 28）：左边是空白（标题/计数都不是控件），借 14px；
              // 右边紧邻折叠按钮，只借 2px 刚好填满 4px 间距的一半。
              "after:absolute after:-inset-y-2 after:-left-3.5 after:-right-0.5 after:content-['']",
              // 这里不做「悬停才可点」的门控：格头没有别的竞争动作，
              // 而门控会让触屏平板（≥768 且无 hover）彻底点不到它。
              "opacity-100 md:opacity-0 md:group-hover/cell:opacity-100 md:focus-visible:opacity-100",
            )}
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? `展开「${meta.name}」` : `收起「${meta.name}」`}
            className={cn(
              "relative inline-flex size-7 items-center justify-center rounded-md text-ink-500 transition-colors duration-[var(--dur-1)] hover:bg-surface-solid/70 hover:text-ink-900 md:hidden",
              // 同上，方向相反：右边是格头的 14px 内边距，借满正好贴到格边
              "after:absolute after:-inset-y-2 after:-left-0.5 after:-right-3.5 after:content-['']",
            )}
          >
            <ChevronDown
              className={cn(
                "size-4 transition-transform duration-[var(--dur-2)]",
                collapsed && "-rotate-90",
              )}
              aria-hidden="true"
            />
          </button>
        </div>
      </header>

      <div
        data-quadrant-body=""
        className={cn(
          "relative min-h-0 flex-1 px-2.5 pb-2 md:pb-2.5",
          free ? "overflow-hidden max-md:min-h-[300px]" : "overflow-y-auto overscroll-contain max-md:overflow-visible",
          collapsed && "hidden md:block",
        )}
      >
        {free ? (
          <div data-quadrant-layer="" className="absolute inset-x-2 top-1 bottom-2">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="absolute transition-transform duration-[var(--dur-2)] hover:z-30 focus-within:z-30"
                style={positionStyle(task)}
              >
                {dragSource(task)}
              </div>
            ))}

            {composer && (
              <div
                className="absolute z-20 w-[min(240px,88%)]"
                style={{
                  left: `${composer.posX * 100}%`,
                  top: `${composer.posY * 100}%`,
                  transform: "translate(-40%, -30%)",
                }}
              >
                <InlineComposer
                  label={`在「${meta.name}」新建任务`}
                  onSubmit={onComposerSubmit}
                  onCancel={onComposerCancel}
                />
              </div>
            )}

            {tasks.length === 0 && !composer && <CellEmptyHint accent={accent} free />}
          </div>
        ) : (
          <>
            {composer && (
              <div className="mb-2">
                <InlineComposer
                  label={`在「${meta.name}」新建任务`}
                  onSubmit={onComposerSubmit}
                  onCancel={onComposerCancel}
                />
              </div>
            )}
            <ul className="flex flex-col gap-2 max-md:gap-1.5">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  // 219 张卡片时只渲染视口内的那几张：滚动/拖拽时不再为整列付布局与绘制成本。
                  // contain-intrinsic-size 用 auto，卡片一旦渲染过就记住真实高度，滚动条不会跳。
                  className="[contain-intrinsic-size:auto_56px] [content-visibility:auto]"
                >
                  {dragSource(task)}
                </li>
              ))}
            </ul>
            {tasks.length === 0 && !composer && <CellEmptyHint accent={accent} />}
          </>
        )}
      </div>
    </section>
  );
}

function CellEmptyHint({ accent, free = false }: { accent: string; free?: boolean }) {
  return (
    <div
      className={cn(
        "pointer-events-none flex flex-col items-center justify-center gap-2 px-4 text-center",
        free ? "absolute inset-0" : "py-6",
      )}
    >
      <span
        aria-hidden="true"
        className="size-10 rounded-full"
        style={{
          backgroundImage: `radial-gradient(circle at 35% 30%, ${accent}33 0%, transparent 70%)`,
        }}
      />
      <p className="text-caption text-ink-500/70">双击空白，或把任务拖到这里</p>
    </div>
  );
}

export default QuadrantCell;

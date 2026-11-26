import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { Goal, Quadrant, Task } from "@detter/shared";
import { TaskCard } from "@/components/common/TaskCard";
import { createDragController } from "./drag-controller";
import { useBoardSetting } from "./useBoardSetting";
import type { DragPayload, DragSnapshot, DropHandlers, SortMode, ViewMode } from "./types";

/**
 * 四象限的拖拽 + 板级设置上下文。
 *
 * 目标栏也要能「把目标拖到象限」，而板子和目标栏是两个兄弟组件，
 * 所以拖拽引擎、视图模式、目标落点回调都放在这一层，页面只负责把它们包起来。
 */

interface QuadrantDragValue {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  sortMode: SortMode;
  setSortMode: (mode: SortMode) => void;

  /** 当前拖的是任务还是目标（决定格子的高亮样式） */
  draggingKind: "task" | "goal" | null;
  draggingTaskId: string | null;
  draggingGoalId: string | null;
  /** 指针当前悬停的象限 */
  overQuadrant: Quadrant | null;

  startTaskDrag: (task: Task, goal: Goal | null, event: ReactPointerEvent<HTMLElement>) => void;
  startGoalDrag: (goal: Goal, event: ReactPointerEvent<HTMLElement>) => void;
  /** 拖拽刚结束时用来吞掉一次 click */
  isClickSuppressed: () => boolean;
  /** 浮层首次出现时把位置对齐到指针（之后由 rAF 接管） */
  applyOverlay: () => void;

  setDropHandlers: (handlers: DropHandlers) => void;
}

const QuadrantDragContext = createContext<QuadrantDragValue | null>(null);

export function useQuadrantDrag(): QuadrantDragValue {
  const value = useContext(QuadrantDragContext);
  if (!value) throw new Error("useQuadrantDrag 必须在 <QuadrantProvider> 内使用");
  return value;
}

export function QuadrantProvider({ children }: { children: ReactNode }) {
  const [viewMode, setViewMode] = useBoardSetting<ViewMode>("quadrant.viewMode", "list");
  const [sortMode, setSortMode] = useBoardSetting<SortMode>("quadrant.sortMode", "smart");
  const [drag, setDrag] = useState<DragSnapshot | null>(null);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const handlersRef = useRef<DropHandlers>({});
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  const [controller] = useState(() =>
    createDragController({
      getOverlay: () => overlayRef.current,
      isFreeMode: () => viewModeRef.current === "free",
      onDrop: (payload, target) => {
        void handlersRef.current.drop?.(payload, target);
      },
      onSnapshot: (snapshot) => setDrag(snapshot),
    }),
  );

  useEffect(() => () => controller.dispose(), [controller]);

  // 浮层挂载后立刻摆到指针位置，避免第一帧闪在左上角
  useLayoutEffect(() => {
    if (drag) controller.applyOverlay();
  }, [drag, controller]);

  const setDropHandlers = useCallback((handlers: DropHandlers) => {
    handlersRef.current = handlers;
  }, []);

  const startTaskDrag = useCallback(
    (task: Task, goal: Goal | null, event: ReactPointerEvent<HTMLElement>) => {
      controller.start({ kind: "task", task, goal }, event);
    },
    [controller],
  );

  const startGoalDrag = useCallback(
    (goal: Goal, event: ReactPointerEvent<HTMLElement>) => {
      controller.start({ kind: "goal", goal }, event);
    },
    [controller],
  );

  const isClickSuppressed = controller.isClickSuppressed;

  const value = useMemo<QuadrantDragValue>(
    () => ({
      viewMode,
      setViewMode,
      sortMode,
      setSortMode,
      draggingKind: drag?.payload.kind ?? null,
      draggingTaskId: drag?.payload.kind === "task" ? drag.payload.task.id : null,
      draggingGoalId: drag?.payload.kind === "goal" ? drag.payload.goal.id : null,
      overQuadrant: drag?.overQuadrant ?? null,
      startTaskDrag,
      startGoalDrag,
      isClickSuppressed,
      applyOverlay: controller.applyOverlay,
      setDropHandlers,
    }),
    [
      viewMode,
      setViewMode,
      sortMode,
      setSortMode,
      drag,
      startTaskDrag,
      startGoalDrag,
      isClickSuppressed,
      controller,
      setDropHandlers,
    ],
  );

  return (
    <QuadrantDragContext.Provider value={value}>
      {children}
      {/* 浮层常驻挂载位：只在拖拽时才有内容，pointer-events-none 保证它不挡命中测试 */}
      <div
        ref={overlayRef}
        aria-hidden="true"
        className="pointer-events-none fixed top-0 left-0 z-[80] transition-opacity duration-[var(--dur-1)] will-change-transform"
        style={{
          width: drag?.width ? `${drag.width}px` : 0,
          opacity: drag ? 1 : 0,
        }}
      >
        {drag?.payload.kind === "task" && (
          <TaskCard task={drag.payload.task} goal={drag.payload.goal} dragging />
        )}
        {drag?.payload.kind === "goal" && (
          <div className="flex rotate-[.4deg] items-center gap-2 rounded-lg border border-accent/30 bg-surface-solid px-3 py-2.5 shadow-3">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: drag.payload.goal.color }}
            />
            <span className="min-w-0 flex-1 truncate text-body font-strong text-ink-900">
              {drag.payload.goal.title}
            </span>
            <span className="shrink-0 text-micro text-ink-500">松手建任务</span>
          </div>
        )}
      </div>
    </QuadrantDragContext.Provider>
  );
}

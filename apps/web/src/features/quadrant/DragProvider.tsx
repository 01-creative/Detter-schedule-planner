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
import type { Goal, Quadrant } from "@detter/shared";
import { createDragController } from "./drag-controller";
import type { DragSnapshot, DropHandlers } from "./types";

/**
 * 四象限的拖拽上下文（只负责「从目标栏拖一条目标到平面上」）。
 *
 * 任务圆点的拖动是平面自己的指针逻辑（需要实时坐标读数与松手才落库），
 * 不走这套浮层；但目标栏和平面是两个兄弟组件，所以把引擎放在这里共享。
 */

interface QuadrantDragValue {
  /** 当前拖的是任务还是目标（决定平面的高亮样式） */
  draggingKind: "task" | "goal" | null;
  draggingTaskId: string | null;
  draggingGoalId: string | null;
  /** 指针当前悬停的象限 */
  overQuadrant: Quadrant | null;

  startGoalDrag: (goal: Goal, event: ReactPointerEvent<HTMLElement>) => void;
  /** 拖拽刚结束时用来吞掉一次 click */
  isClickSuppressed: () => boolean;

  setDropHandlers: (handlers: DropHandlers) => void;
}

const QuadrantDragContext = createContext<QuadrantDragValue | null>(null);

export function useQuadrantDrag(): QuadrantDragValue {
  const value = useContext(QuadrantDragContext);
  if (!value) throw new Error("useQuadrantDrag 必须在 <QuadrantProvider> 内使用");
  return value;
}

export function QuadrantProvider({ children }: { children: ReactNode }) {
  const [drag, setDrag] = useState<DragSnapshot | null>(null);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const handlersRef = useRef<DropHandlers>({});

  const [controller] = useState(() =>
    createDragController({
      getOverlay: () => overlayRef.current,
      // 平面没有「列表/自由」两种落点语义，浮层永远投影到目标坐标
      isFreeMode: () => true,
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

  const startGoalDrag = useCallback(
    (goal: Goal, event: ReactPointerEvent<HTMLElement>) => {
      controller.start({ kind: "goal", goal }, event);
    },
    [controller],
  );

  const isClickSuppressed = controller.isClickSuppressed;

  const value = useMemo<QuadrantDragValue>(
    () => ({
      draggingKind: drag?.payload.kind ?? null,
      draggingTaskId: drag?.payload.kind === "task" ? drag.payload.task.id : null,
      draggingGoalId: drag?.payload.kind === "goal" ? drag.payload.goal.id : null,
      overQuadrant: drag?.overQuadrant ?? null,
      startGoalDrag,
      isClickSuppressed,
      setDropHandlers,
    }),
    [drag, startGoalDrag, isClickSuppressed, setDropHandlers],
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

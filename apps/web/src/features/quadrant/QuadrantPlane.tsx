import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { Goal, Quadrant, Task } from "@detter/shared";
import { QUADRANT_META } from "@detter/shared";
import { cn } from "@detter/ui";
import { formatWhen } from "@/lib/format";
import { PlaneAxes, PlaneBackdrop, PlaneQuadrantHeaders } from "./PlaneChrome";
import { PlaneTaskMarker } from "./PlaneTaskMarker";
import { InlineComposer } from "./InlineComposer";
import type { BoardStats } from "./stats";
import type { PlaneLabelLayout } from "./types";
import {
  clampPlanePoint,
  coordinateReadout,
  layoutPlaneLabels,
  quadrantFromPosition,
  resolveTaskPoint,
  unitFromPoint,
  type PlanePoint,
} from "./geometry";
import { useMediaQuery } from "./useMediaQuery";

/**
 * 一张连续的坐标系平面（不是四个格子）。
 *
 * 数据 → 坐标 → 圆点；象限只是坐标的函数，绘制时按 `quadrantFromPosition` 得到角标区域。
 * 拖动使用自己的指针会话：移动过程中只更新本地坐标（React state + rAF），
 * 松手才调用 onMoveTask 落库；因此中途刷新不会留下半截坐标。
 */
export interface QuadrantPlaneProps {
  tasks: Task[];
  goalsById: Map<string, Goal>;
  stats: BoardStats;
  selectedId: string | null;
  overQuadrant: Quadrant | null;
  goalDragActive: boolean;
  composer: PlanePoint | null;
  preview: { taskId: string; posX: number; posY: number } | null;
  onSelect: (id: string | null) => void;
  onOpen: (task: Task) => void;
  onToggleDone: (task: Task) => void;
  onContextMenu: (task: Task, event: ReactMouseEvent<HTMLElement>) => void;
  onLongPress: (task: Task, x: number, y: number) => void;
  onBlankContextMenu: (point: PlanePoint, event: ReactMouseEvent<HTMLElement>) => void;
  onBlankDoubleClick: (point: PlanePoint) => void;
  onMoveTask: (task: Task, point: PlanePoint) => Promise<void>;
  onComposerSubmit: (title: string) => void;
  onComposerCancel: () => void;
}

interface DragVisual {
  taskId: string;
  x: number;
  y: number;
}

interface DragSession {
  task: Task;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  rect: DOMRect;
  active: boolean;
  latest: PlanePoint;
  raf: number;
  longPress: number;
  longPressFired: boolean;
}

const MOUSE_THRESHOLD = 3;
const TOUCH_THRESHOLD = 6;
const LONG_PRESS_MS = 460;
const CLICK_SUPPRESS_MS = 380;
const DOT_INSET = 0.012;

/** 悬停卡片的出现延迟：要比双击间隔（~300ms）短，比"扫过"停留的时间长。 */
const HOVER_SHOW_DELAY_MS = 140;

function isInteractive(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "[data-plane-task], [data-plane-label], [data-plane-hover-card], [data-plane-composer], [data-plane-peek], [role='menu'], input, textarea, button",
      ),
    )
  );
}

function eventPoint(
  event: { clientX: number; clientY: number },
  rect: DOMRect,
): PlanePoint {
  return clampPlanePoint(
    unitFromPoint(event.clientX, event.clientY, {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    }),
    DOT_INSET,
  );
}

function roundPoint(point: PlanePoint): PlanePoint {
  return {
    x: Math.round(point.x * 1000) / 1000,
    y: Math.round(point.y * 1000) / 1000,
  };
}

export function QuadrantPlane({
  tasks,
  goalsById,
  stats,
  selectedId,
  overQuadrant,
  goalDragActive,
  composer,
  preview,
  onSelect,
  onOpen,
  onToggleDone,
  onContextMenu,
  onLongPress,
  onBlankContextMenu,
  onBlankDoubleClick,
  onMoveTask,
  onComposerSubmit,
  onComposerCancel,
}: QuadrantPlaneProps) {
  const phone = useMediaQuery("(max-width: 640px)");
  const planeRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragVisual | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const hoverShowTimer = useRef<number | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const suppressClickUntil = useRef(0);
  const sessionRef = useRef<DragSession | null>(null);
  const touchTapRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const lastTouchDoubleRef = useRef(0);

  /* ------------------------------- 尺寸测量 ------------------------------- */

  useLayoutEffect(() => {
    const element = planeRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize((current) =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      );
    };
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
      if (hoverShowTimer.current) window.clearTimeout(hoverShowTimer.current);
      const session = sessionRef.current;
      if (session?.raf) cancelAnimationFrame(session.raf);
      if (session?.longPress) window.clearTimeout(session.longPress);
    },
    [],
  );

  /* ------------------------------- 基础数据 ------------------------------- */

  const basePoints = useMemo(() => {
    const map = new Map<string, PlanePoint>();
    for (const task of tasks) map.set(task.id, resolveTaskPoint(task));
    return map;
  }, [tasks]);

  const markers = useMemo(
    () =>
      tasks.map((task) => {
        const base = basePoints.get(task.id) ?? { x: 0.44, y: 0.44 };
        const dragPoint = drag && drag.taskId === task.id ? drag : null;
        const previewPoint =
          preview && preview.taskId === task.id ? { x: preview.posX, y: preview.posY } : null;
        const point = dragPoint
          ? { x: dragPoint.x, y: dragPoint.y }
          : previewPoint
            ? clampPlanePoint(previewPoint, DOT_INSET)
            : base;
        return {
          task,
          point,
          quadrant: quadrantFromPosition(point.x, point.y),
        };
      }),
    [tasks, basePoints, drag, preview],
  );

  const labels = useMemo(() => {
    if (phone || size.width === 0 || size.height === 0) {
      return new Map<string, PlaneLabelLayout>();
    }
    const layouts = layoutPlaneLabels(
      markers.map((marker) => ({
        id: marker.task.id,
        x: marker.point.x,
        y: marker.point.y,
        title: marker.task.title,
      })),
      { width: size.width, height: size.height },
    );
    return new Map(layouts.map((layout) => [layout.id, layout]));
  }, [markers, phone, size.height, size.width]);

  const hoverCard = useMemo(() => {
    if (!hoveredId || size.width === 0) return null;
    const marker = markers.find((entry) => entry.task.id === hoveredId);
    if (!marker) return null;
    const dotX = marker.point.x * size.width;
    const dotY = marker.point.y * size.height;
    const cardWidth = 236;
    const left =
      dotX + 14 + cardWidth <= size.width - 8
        ? dotX + 14
        : Math.max(8, dotX - 14 - cardWidth);
    const top = Math.min(Math.max(8, dotY - 32), Math.max(8, size.height - 86));
    return { left, top };
  }, [hoveredId, markers, size.height, size.width]);

  const peek = useMemo(() => {
    if (!peekId || size.width === 0) return null;
    const marker = markers.find((entry) => entry.task.id === peekId);
    if (!marker) return null;
    const dotX = marker.point.x * size.width;
    const dotY = marker.point.y * size.height;
    const width = 248;
    const cardHeight = 116;
    const left = Math.min(Math.max(10, dotX - 24), Math.max(10, size.width - width - 10));
    // 下半屏优先往上弹，避免盖住 Q3/Q4 的标题和底部轴标签
    const below = dotY + 16;
    const top =
      below + cardHeight > size.height - 10
        ? Math.max(10, dotY - cardHeight - 16)
        : below;
    return { marker, left, top };
  }, [markers, peekId, size.height, size.width]);

  /* -------------------------------- 悬停 --------------------------------- */

  /**
   * 悬停要「延迟出现、立即消失」：
   * 卡片一出场就占住一块可点击区域，如果它跟着指针瞬间出现，
   * 用户双击空白新建时第二下会落在卡片上（isInteractive 为真），双击就失效了。
   * 已经在悬停状态时切换任务则不打延迟，避免扫过一排圆点时一顿一顿的。
   */
  const handleHover = useCallback((task: Task | null) => {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    if (hoverShowTimer.current) {
      window.clearTimeout(hoverShowTimer.current);
      hoverShowTimer.current = null;
    }
    if (task) {
      if (hoveredRef.current) {
        setHoveredId(task.id);
        return;
      }
      hoverShowTimer.current = window.setTimeout(() => {
        hoverShowTimer.current = null;
        setHoveredId(task.id);
      }, HOVER_SHOW_DELAY_MS);
      return;
    }
    // 从圆点移到标签/卡片时会短暂 leave，留 100ms 让指针接上
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      setHoveredId(null);
    }, 100);
  }, []);

  useEffect(() => {
    hoveredRef.current = hoveredId;
  }, [hoveredId]);

  /* -------------------------------- 拖动 --------------------------------- */

  const cleanupSession = useCallback((options: { commit?: boolean; point?: PlanePoint } = {}) => {
    const session = sessionRef.current;
    if (!session) return;
    if (session.raf) cancelAnimationFrame(session.raf);
    if (session.longPress) window.clearTimeout(session.longPress);
    sessionRef.current = null;

    if (options.commit && options.point) {
      const point = roundPoint(options.point);
      // 保持拖动中的视觉位置，等 liveQuery 回来再撤掉，避免闪回旧坐标
      setDrag({ taskId: session.task.id, x: point.x, y: point.y });
      suppressClickUntil.current = Date.now() + CLICK_SUPPRESS_MS;
      void onMoveTask(session.task, point).finally(() => {
        setDrag(null);
      });
    } else {
      setDrag(null);
      if (session.active) suppressClickUntil.current = Date.now() + CLICK_SUPPRESS_MS;
    }
  }, [onMoveTask]);

  const beginDrag = useCallback(
    (task: Task, event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const plane = planeRef.current;
      if (!plane || sessionRef.current) return;
      const rect = plane.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      onSelect(task.id);
      setPeekId(null);
      setHoveredId(null);

      const start = clampPlanePoint(resolveTaskPoint(task), DOT_INSET);
      const session: DragSession = {
        task,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        startX: event.clientX,
        startY: event.clientY,
        rect,
        active: false,
        latest: start,
        raf: 0,
        longPress: 0,
        longPressFired: false,
      };
      sessionRef.current = session;

      const schedule = (point: PlanePoint) => {
        session.latest = point;
        if (session.raf) return;
        session.raf = requestAnimationFrame(() => {
          session.raf = 0;
          setDrag({ taskId: task.id, x: session.latest.x, y: session.latest.y });
        });
      };

      const cleanupListeners = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKeyDown);
      };

      const onMove = (moveEvent: PointerEvent) => {
        const current = sessionRef.current;
        if (!current || moveEvent.pointerId !== current.pointerId) return;
        const distance = Math.hypot(
          moveEvent.clientX - current.startX,
          moveEvent.clientY - current.startY,
        );
        if (!current.active) {
          if (distance <= (current.pointerType === "touch" ? TOUCH_THRESHOLD : MOUSE_THRESHOLD)) {
            return;
          }
          current.active = true;
          if (current.longPress) {
            window.clearTimeout(current.longPress);
            current.longPress = 0;
          }
        }
        if (moveEvent.cancelable) moveEvent.preventDefault();
        schedule(eventPoint(moveEvent, current.rect));
      };

      const onUp = (upEvent: PointerEvent) => {
        const current = sessionRef.current;
        if (!current || upEvent.pointerId !== current.pointerId) return;
        cleanupListeners();
        if (current.active) {
          cleanupSession({ commit: true, point: eventPoint(upEvent, current.rect) });
          return;
        }
        const longPressed = current.longPressFired;
        cleanupSession();
        if (longPressed) {
          // 在松手时才真正弹菜单：长按期间菜单若已经出现在手指下方，
          // 抬手产生的 click 会直接点到第一个菜单项（例如「新建任务」）。
          onLongPress(task, upEvent.clientX, upEvent.clientY);
        }
      };

      const onCancel = (cancelEvent: PointerEvent) => {
        const current = sessionRef.current;
        if (!current || cancelEvent.pointerId !== current.pointerId) return;
        cleanupListeners();
        cleanupSession();
      };

      const onKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key !== "Escape") return;
        keyEvent.preventDefault();
        cleanupListeners();
        cleanupSession();
      };

      if (event.pointerType === "touch") {
        session.longPress = window.setTimeout(() => {
          const current = sessionRef.current;
          if (!current || current.active) return;
          current.longPressFired = true;
          // 先压掉抬手后那一下 click；真正的菜单在 pointerup 时打开
          suppressClickUntil.current = Date.now() + CLICK_SUPPRESS_MS + LONG_PRESS_MS;
        }, LONG_PRESS_MS);
      }

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKeyDown);
    },
    [cleanupSession, onLongPress, onSelect],
  );

  /* ------------------------------ 空白交互 ------------------------------- */

  const pointFromMouse = useCallback((event: ReactMouseEvent<HTMLElement>): PlanePoint | null => {
    const plane = planeRef.current;
    if (!plane) return null;
    const rect = plane.getBoundingClientRect();
    return eventPoint(event, rect);
  }, []);

  const handlePlanePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (isInteractive(event.target)) return;
      if (peekId) setPeekId(null);
      if (hoveredId) setHoveredId(null);
      onSelect(null);
    },
    [hoveredId, onSelect, peekId],
  );

  const handlePlaneContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (isInteractive(event.target)) return;
      event.preventDefault();
      const point = pointFromMouse(event);
      if (point) onBlankContextMenu(point, event);
    },
    [onBlankContextMenu, pointFromMouse],
  );

  const handlePlaneDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (isInteractive(event.target)) return;
      event.preventDefault();
      if (Date.now() - lastTouchDoubleRef.current < 500) return;
      const point = pointFromMouse(event);
      if (point) onBlankDoubleClick(point);
    },
    [onBlankDoubleClick, pointFromMouse],
  );

  const handlePlanePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType !== "touch") return;
      if (Date.now() < suppressClickUntil.current) return;
      if (isInteractive(event.target)) return;
      const plane = planeRef.current;
      if (!plane) return;
      const point = eventPoint(event, plane.getBoundingClientRect());
      const now = Date.now();
      const previous = touchTapRef.current;
      if (
        previous &&
        now - previous.at < 320 &&
        Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 28
      ) {
        touchTapRef.current = null;
        lastTouchDoubleRef.current = now;
        onBlankDoubleClick(point);
        return;
      }
      touchTapRef.current = { at: now, x: event.clientX, y: event.clientY };
    },
    [onBlankDoubleClick],
  );

  const handleMarkerClick = useCallback(
    (task: Task) => {
      if (Date.now() < suppressClickUntil.current) return;
      if (phone) {
        setPeekId((current) => (current === task.id ? null : task.id));
        return;
      }
      onOpen(task);
    },
    [onOpen, phone],
  );

  const handleFollowUp = useCallback(
    (task: Task) => {
      setPeekId(null);
      onOpen(task);
    },
    [onOpen],
  );

  /* -------------------------------- 渲染 --------------------------------- */

  const dragMarker = drag ? markers.find((marker) => marker.task.id === drag.taskId) : null;
  const showEmpty = tasks.length === 0 && !composer;

  return (
    <div
      ref={planeRef}
      data-plane=""
      data-goal-drag={goalDragActive ? "true" : undefined}
      className={cn("plane-frame h-[560px] w-full select-none md:h-auto md:flex-1")}
      onPointerDown={handlePlanePointerDown}
      onPointerUp={handlePlanePointerUp}
      onContextMenu={handlePlaneContextMenu}
      onDoubleClick={handlePlaneDoubleClick}
      role="group"
      aria-label="四象限平面：横轴紧急度，纵轴重要度"
    >
      <PlaneBackdrop overQuadrant={overQuadrant} />
      <PlaneAxes />
      <PlaneQuadrantHeaders counts={stats.quadrants} />

      {showEmpty && (
        <p className="plane-empty-copy">
          双击平面任意位置，写下第一件事
          <br />
          横轴越靠右越紧急，纵轴越靠上越重要
        </p>
      )}

      {/* 引线画在标签下面：只有标签被错开时才出现 */}
      <svg className="plane-leader" aria-hidden="true">
        {[...labels.values()].map((layout) => {
          if (Math.abs(layout.leader.y2 - layout.leader.y1) <= 2.5) return null;
          const offset = layout.side === "right" ? 5 : -5;
          return (
            <line
              key={layout.id}
              x1={layout.leader.x1 + offset}
              y1={layout.leader.y1}
              x2={layout.leader.x2}
              y2={layout.leader.y2}
            />
          );
        })}
      </svg>

      {markers.map(({ task, point, quadrant }) => (
        <PlaneTaskMarker
          key={task.id}
          task={task}
          goal={task.goalId ? (goalsById.get(task.goalId) ?? null) : null}
          point={point}
          quadrant={quadrant}
          selected={selectedId === task.id}
          dragging={drag?.taskId === task.id}
          phone={phone}
          label={labels.get(task.id) ?? null}
          hovered={hoveredId === task.id}
          hoverCard={hoveredId === task.id ? hoverCard : null}
          onClick={handleMarkerClick}
          onDoubleClickDone={onToggleDone}
          onContextMenu={onContextMenu}
          onPointerDown={beginDrag}
          onHover={handleHover}
        />
      ))}

      {composer && size.width > 0 && (
        <div
          data-plane-composer=""
          className="absolute z-[55] w-[248px]"
          style={{
            left: Math.min(
              Math.max(8, composer.x * size.width - 18),
              Math.max(8, size.width - 256),
            ),
            top: Math.min(
              Math.max(8, composer.y * size.height - 24),
              Math.max(8, size.height - 108),
            ),
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <InlineComposer
            label="在平面新建任务"
            placeholder="写下要做的事，Enter 保存"
            onSubmit={onComposerSubmit}
            onCancel={onComposerCancel}
          />
        </div>
      )}

      {dragMarker && drag && (
        <span
          className="plane-readout"
          style={
            phone
              ? { left: "50%", bottom: 18, top: "auto", transform: "translateX(-50%)" }
              : {
                  left: `${drag.x * 100}%`,
                  top: `${drag.y * 100}%`,
                  transform: `translate(-50%, ${drag.y < 0.08 ? "16px" : "calc(-100% - 15px)"})`,
                }
          }
          role="status"
          aria-live="polite"
        >
          {coordinateReadout(drag.x, drag.y)}
        </span>
      )}

      {peek && phone && (
        <div
          className="plane-peek"
          data-plane-peek=""
          role="dialog"
          aria-label={`${peek.marker.task.title} 摘要`}
          style={{ left: peek.left, top: peek.top }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <span
            aria-hidden="true"
            className="plane-hover-card-bar"
            style={{
              backgroundColor: peek.marker.task.goalId
                ? (goalsById.get(peek.marker.task.goalId)?.color ?? "#94a3b8")
                : "#94a3b8",
            }}
          />
          <p className="plane-peek-title">{peek.marker.task.title}</p>
          <p className="plane-peek-meta">
            {formatWhen(peek.marker.task)} · Q{peek.marker.quadrant}{" "}
            {QUADRANT_META[peek.marker.quadrant].short}
          </p>
          <button
            type="button"
            onClick={() => handleFollowUp(peek.marker.task)}
            className="mt-2 inline-flex h-8 items-center rounded-md bg-accent-soft px-3 text-caption font-strong text-accent"
          >
            查看详情
          </button>
        </div>
      )}
    </div>
  );
}

export default QuadrantPlane;

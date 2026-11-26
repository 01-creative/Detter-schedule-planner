import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { ArrowUpRight } from "lucide-react";
import type { Goal, Quadrant, Task } from "@detter/shared";
import { QUADRANT_META } from "@detter/shared";
import { cn } from "@detter/ui";
import { formatWhen } from "@/lib/format";
import type { PlaneLabelLayout } from "./types";
import type { PlanePoint } from "./geometry";

/**
 * 平面上的一个任务标记：圆点 + 标签 + 悬停卡片。
 *
 * 坐标由外层算好（拖动时是临时坐标），这里只负责把 9px 的圆点放到百分比位置。
 * 标签宽度由 layoutPlaneLabels 显式给出——绝对定位 + 自适应宽度会把中文压成竖排，
 * 这是样张第一版踩过的坑。
 */
export interface PlaneTaskMarkerProps {
  task: Task;
  goal: Goal | null;
  point: PlanePoint;
  quadrant: Quadrant;
  selected: boolean;
  dragging: boolean;
  phone: boolean;
  label: PlaneLabelLayout | null;
  hovered: boolean;
  hoverCard: { left: number; top: number } | null;
  onClick: (task: Task) => void;
  onDoubleClickDone: (task: Task) => void;
  onContextMenu: (task: Task, event: ReactMouseEvent<HTMLElement>) => void;
  onPointerDown: (task: Task, event: ReactPointerEvent<HTMLElement>) => void;
  onHover: (task: Task | null) => void;
}

function markerColor(goal: Goal | null): string {
  return goal?.color ?? "#94a3b8";
}

function taskMeta(task: Task, goal: Goal | null): string {
  const when = formatWhen(task);
  const parts: string[] = [];
  if (when !== "未排期") parts.push(when);
  for (const tag of task.tags.slice(0, 2)) parts.push(`#${tag}`);
  if (goal) parts.push(`@${goal.title}`);
  return parts.join(" · ");
}

export function PlaneTaskMarker({
  task,
  goal,
  point,
  quadrant,
  selected,
  dragging,
  phone,
  label,
  hovered,
  hoverCard,
  onClick,
  onDoubleClickDone,
  onContextMenu,
  onPointerDown,
  onHover,
}: PlaneTaskMarkerProps) {
  const done = task.status === "done";
  const dropped = task.status === "dropped";
  const color = markerColor(goal);
  const importance = 1 - point.y;
  const meta = taskMeta(task, goal);
  const labelCls = cn(
    "plane-label",
    (done || dropped) && "is-done",
    (dragging || (phone && hovered)) && "is-hidden",
  );

  const shared = {
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      event.stopPropagation();
      onClick(task);
    },
    onDoubleClick: (event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!phone) onDoubleClickDone(task);
    },
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onContextMenu(task, event);
    },
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      event.stopPropagation();
      onPointerDown(task, event);
    },
    onPointerEnter: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse") onHover(task);
    },
    onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse") onHover(null);
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      // 旧 TaskCard 的键盘行为：Enter 打开、Space 完成。原生 button 的 Enter
      // 会走 click，这里只接管 Space，避免它变成「打开详情」。
      if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        event.stopPropagation();
        onDoubleClickDone(task);
      }
    },
  };

  return (
    <>
      <button
        type="button"
        data-plane-task={task.id}
        data-quadrant={quadrant}
        data-x={point.x.toFixed(3)}
        data-y={point.y.toFixed(3)}
        aria-label={`${task.title}${done ? "，已完成" : ""}，Q${quadrant} ${QUADRANT_META[quadrant].name}，紧急度 ${point.x.toFixed(2)}，重要度 ${importance.toFixed(2)}`}
        aria-pressed={done}
        className={cn(
          "plane-dot-button",
          dragging && "is-dragging",
          hovered && "is-hovered",
          selected && "is-selected",
        )}
        style={{
          left: `${point.x * 100}%`,
          top: `${point.y * 100}%`,
          ["--plane-dot-color" as string]: color,
          ["--plane-dot-halo" as string]: `color-mix(in srgb, ${color} 22%, transparent)`,
        }}
        {...shared}
      >
        <span
          aria-hidden="true"
          className={cn("plane-dot", done && "is-done", dropped && "is-dropped")}
        />
      </button>

      {label && !phone && (
        <span
          data-plane-label={task.id}
          aria-hidden="true"
          className={labelCls}
          style={{ left: label.left, top: label.top, width: label.width }}
          {...shared}
        >
          <span className="plane-label-text">{task.title}</span>
        </span>
      )}

      {hovered && hoverCard && !phone && (
        <div
          className="plane-hover-card"
          style={{ left: hoverCard.left, top: hoverCard.top }}
          onClick={(event) => {
            event.stopPropagation();
            onClick(task);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseEnter={() => onHover(task)}
          onMouseLeave={() => onHover(null)}
          data-plane-hover-card={task.id}
        >
          <span
            aria-hidden="true"
            className="plane-hover-card-bar"
            style={{ backgroundColor: color }}
          />
          <p className="plane-hover-card-title">{task.title}</p>
          {meta && <p className="plane-hover-card-meta">{meta}</p>}
          <span className="sr-only">按 Enter 打开详情</span>
          <ArrowUpRight
            className="absolute top-2 right-2 size-3 text-ink-300"
            aria-hidden="true"
          />
        </div>
      )}
    </>
  );
}

export default PlaneTaskMarker;

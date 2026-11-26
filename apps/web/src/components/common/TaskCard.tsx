import { memo } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, Clock, Ellipsis, MapPin } from "lucide-react";
import type { Goal, Task } from "@detter/shared";
import { cn } from "@detter/ui";
import { formatClock, formatDayLabel } from "@/lib/format";

/**
 * 全站统一的任务卡。
 *
 * 这是「一个任务长什么样」的唯一答案：四象限、收件箱、日历、专注页都会复用它。
 * 因此它有两条纪律：
 * 1. 不取数据、不写数据、不知道 Dexie 的存在 —— 只吃 props、只吐回调；
 * 2. props 契约冻结（见任务书 §4），后续页面只能通过 `density` / 状态位改变它。
 *
 * 视觉严格按设计令牌：白底 + --r-lg + --shadow-1，左侧 3px 竖条是目标色。
 * 动效只碰 transform / opacity / box-shadow，完成态的勾选动画 180ms。
 */

export interface TaskCardProps {
  task: Task;
  goal?: Goal | null;
  density?: "comfortable" | "compact";
  dragging?: boolean;
  selected?: boolean;
  onOpen?: (task: Task) => void;
  onToggleDone?: (task: Task) => void;
  onContextMenu?: (task: Task, event: ReactMouseEvent) => void;
  onPointerDown?: (task: Task, event: ReactPointerEvent<HTMLElement>) => void;
}

type TimeTone = "normal" | "overdue";

interface TaskTimeInfo {
  label: string;
  tone: TimeTone;
}

/**
 * 时间 chip 的文案：今天 15:00 / 明天 · 全天 / 逾期 · 11月24日 18:00。
 * 逾期只由 dueAt 判定：一个「安排在今天上午」的事件过去了不算逾期。
 */
function resolveTaskTime(task: Task, now: number): TaskTimeInfo | null {
  const done = task.status === "done" || task.status === "dropped";
  const overdue = !done && task.dueAt !== null && task.dueAt < now;

  if (task.allDay && task.startAt !== null) {
    return {
      label: `${formatDayLabel(task.startAt, now)} · 全天`,
      tone: overdue ? "overdue" : "normal",
    };
  }
  if (task.startAt !== null) {
    const base = `${formatDayLabel(task.startAt, now)} ${formatClock(task.startAt)}`;
    return { label: overdue ? `逾期 · ${base}` : base, tone: overdue ? "overdue" : "normal" };
  }
  if (task.dueAt !== null) {
    return overdue
      ? { label: `逾期 · ${formatDayLabel(task.dueAt, now)} ${formatClock(task.dueAt)}`, tone: "overdue" }
      : { label: `截止 ${formatDayLabel(task.dueAt, now)} ${formatClock(task.dueAt)}`, tone: "normal" };
  }
  return null;
}

function TaskCardImpl({
  task,
  goal = null,
  density = "comfortable",
  dragging = false,
  selected = false,
  onOpen,
  onToggleDone,
  onContextMenu,
  onPointerDown,
}: TaskCardProps) {
  const reduceMotion = useReducedMotion();
  const done = task.status === "done" || task.status === "dropped";
  const compact = density === "compact";
  const now = Date.now();
  const time = resolveTaskTime(task, now);
  const tagLimit = compact ? 1 : 2;
  const extraTags = Math.max(0, task.tags.length - tagLimit);
  const shownTags = task.tags.slice(0, tagLimit);
  const barColor = done ? "var(--ink-300)" : (goal?.color ?? "transparent");
  const hasMeta = Boolean(time) || Boolean(task.location) || shownTags.length > 0;

  return (
    <article
      data-task-id={task.id}
      role="button"
      tabIndex={0}
      aria-label={`${task.title}${done ? "，已完成" : ""}`}
      aria-pressed={done}
      onClick={(event) => {
        event.stopPropagation();
        onOpen?.(task);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggleDone?.(task);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu?.(task, event);
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown?.(task, event);
      }}
      onKeyDown={(event) => {
        // 卡片自己是可聚焦的按钮语义：Enter 打开，空格完成（双击的键盘替代）
        if (event.key === "Enter") {
          event.preventDefault();
          onOpen?.(task);
        } else if (event.key === " ") {
          event.preventDefault();
          onToggleDone?.(task);
        }
      }}
      className={cn(
        "group/card relative flex w-full cursor-default touch-pan-y flex-col rounded-lg border border-border bg-surface-solid pr-3 pl-3 shadow-1",
        "transition-[box-shadow,transform,opacity,border-color] duration-[var(--dur-1)] ease-[var(--ease-out)]",
        compact ? "min-h-9 gap-0.5 py-1.5" : "min-h-11 gap-1 py-2.5",
        // hover 只抬 1px：这个页面一天要开十几次，动效不能抢注意力
        !dragging && !done && "hover:-translate-y-px hover:shadow-2",
        done && "opacity-60",
        selected && "ring-2 ring-accent/50 focus:ring-0",
        dragging && "rotate-[.4deg] scale-[1.03] cursor-grabbing opacity-95 shadow-3",
      )}
    >
      {/* 左侧竖条 = 目标色；完成态变灰 */}
      <span
        aria-hidden="true"
        className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full"
        style={{ backgroundColor: barColor }}
      />

      <div className="flex items-start gap-1.5">
        {done && (
          <motion.span
            initial={reduceMotion ? false : { scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-full bg-success-soft text-success-ink"
          >
            <Check className="size-2.5" strokeWidth={3} aria-hidden="true" />
          </motion.span>
        )}
        <p
          className={cn(
            "line-clamp-2 min-w-0 flex-1 pr-5 text-body font-strong text-ink-900",
            compact && "text-caption leading-[18px]",
            done && "text-ink-500 line-through",
          )}
        >
          {task.title}
        </p>
      </div>

      {hasMeta && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-micro text-ink-500">
          {time && (
            <span
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-px",
                time.tone === "overdue"
                  ? "bg-danger-soft font-strong text-danger-ink"
                  : "bg-surface-sunken text-ink-500",
              )}
            >
              <Clock className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{time.label}</span>
            </span>
          )}
          {task.location && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="size-3 shrink-0 text-ink-300" aria-hidden="true" />
              <span className="truncate">{task.location}</span>
            </span>
          )}
          {shownTags.map((tag) => (
            <span
              key={tag}
              className="max-w-24 truncate rounded-full bg-surface-sunken px-1.5 text-ink-500"
            >
              #{tag}
            </span>
          ))}
          {extraTags > 0 && <span className="text-ink-300">+{extraTags}</span>}
        </div>
      )}

      {/* hover 出现「⋯」；触摸屏没有 hover，所以窄屏常显 */}
      <button
        type="button"
        aria-label={`「${task.title}」更多操作`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onContextMenu?.(task, event);
        }}
        className={cn(
          "absolute top-1.5 right-1.5 inline-flex size-6 items-center justify-center rounded-md",
          "bg-surface-solid/95 text-ink-500 opacity-0 shadow-1 transition-opacity duration-[var(--dur-1)]",
          // 命中区 44×44（视觉仍是 24）：按钮贴在卡片右上角，伪元素只能往卡片内部借
          // —— 列表项是 content-visibility:auto（带 paint containment），借出卡片的部分会被裁掉。
          // 于是右借 6px 到卡片边缘、左借 14px、下借 14px、上借 6px，正好 44×44 且全在卡内。
          "after:absolute after:-top-1.5 after:-right-1.5 after:-bottom-3.5 after:-left-3.5 after:content-['']",
          // 桌面端「⋯」平时是透明的：命中区放大后不能顺手变成隐形陷阱，
          // 所以在「≥md 且真的有 hover 的设备」上，只有 hover 卡片（也就是它已经显形）时才接管指针。
          // 触屏（hover: none）与窄屏（它本来就常显）都不门控，否则那里会直接点不到。
          "md:[@media(hover:hover)]:pointer-events-none md:[@media(hover:hover)]:group-hover/card:pointer-events-auto",
          "group-hover/card:opacity-100 focus-visible:opacity-100 max-md:opacity-100",
        )}
      >
        <Ellipsis className="size-3.5" aria-hidden="true" />
      </button>
    </article>
  );
}

/** memo：219 张卡的时候，hover/拖拽高亮不应该连带重渲染整块板子。 */
export const TaskCard = memo(TaskCardImpl);

export default TaskCard;

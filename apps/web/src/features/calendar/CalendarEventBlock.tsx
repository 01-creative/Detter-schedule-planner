import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { startOfDay } from "@detter/shared";
import { Clock3, MapPin, Repeat } from "lucide-react";
import { cn } from "@detter/ui";
import type { CalendarItem } from "./calendarTypes";
import {
  dragBubbleLabel,
  pxToMinutes,
  resolveDrag,
  timeToOffsetPx,
  clockLabel,
  type DragMode,
} from "./calendarMath";

/**
 * 时间轴上的一个事件块（任务书 §3.1 / §4）。
 *
 * 为什么自己实现而不是复用 TaskCard：
 * T03 的 TaskCard 是「卡片流」里的普通卡片（有 hover 菜单、有完成态动画），
 * 而这里需要的是绝对定位、可拖拽、可拉长、能被裁剪成「跨天续块」的时间块。
 * 两者的交互语义完全不同，强行复用会让 TaskCard 长出一堆日历专属分支，
 * 因此按 07-FRONTEND-STRUCTURE §2 的「自己的特性里再实现一份」处理。
 *
 * 拖拽实现要点：
 * - 用 pointer events + setPointerCapture，松手前**不写库**，`pointerup` 一次性提交；
 * - 位移换算成分钟 → 吸附 15 分钟 → 交给 resolveDrag 算出新的起止；
 * - 横向跨列 = 跨天：columnAt 由父级（周视图）注入，只认列序号差；
 * - 3px 的位移阈值区分「点击打开详情」与「拖拽改期」。
 */

export interface CalendarEventBlockProps {
  item: CalendarItem;
  /** 本列对应的「日 0 点」 */
  dayStart: number;
  top: number;
  height: number;
  /** 0..1 的水平占比 */
  left: number;
  width: number;
  pxPerMinute: number;
  /** 日视图显示更多细节（地点、标签、重复） */
  detailed?: boolean;
  /** 只有包含真实结束时间的那一段才给拉伸把手 */
  showResize: boolean;
  continuesBefore?: boolean;
  continuesAfter?: boolean;
  /** 目标色条；没有目标时退回象限色 */
  goalColor?: string | null;
  /** 把 clientX 映射到列序号（周视图注入；日视图恒为 0） */
  columnAt?: (clientX: number) => number;
  onOpen: (item: CalendarItem) => void;
  onCommit: (next: { startAt: number; endAt: number }) => void;
}

interface DragSession {
  mode: DragMode;
  pointerId: number;
  startX: number;
  startY: number;
  originStart: number;
  originEnd: number;
  startColumn: number;
  moved: boolean;
}

export function CalendarEventBlock({
  item,
  dayStart,
  top,
  height,
  left,
  width,
  pxPerMinute,
  detailed = false,
  showResize,
  continuesBefore = false,
  continuesAfter = false,
  goalColor,
  columnAt,
  onOpen,
  onCommit,
}: CalendarEventBlockProps) {
  const sessionRef = useRef<DragSession | null>(null);
  const [preview, setPreview] = useState<{ startAt: number; endAt: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const done = item.status === "done";
  const accent = `var(--q${item.quadrant}-accent)`;
  const soft = `var(--q${item.quadrant}-soft)`;

  const resolveFromPointer = (session: DragSession, clientX: number, clientY: number) => {
    const deltaMinutes = pxToMinutes(clientY - session.startY, pxPerMinute);
    // 拉伸只改结束时间：横向换列不参与（否则拉一下底边会跳到别的日子）
    const endColumn = columnAt ? columnAt(clientX) : session.startColumn;
    const deltaDays = session.mode === "resize-end" ? 0 : endColumn - session.startColumn;
    return resolveDrag({
      mode: session.mode,
      startAt: session.originStart,
      endAt: session.originEnd,
      deltaDays,
      deltaMinutes,
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>, mode: DragMode) => {
    if (event.button !== 0) return;
    // 阻止冒泡到列背景的「点击空白新建」
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    sessionRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originStart: item.startAt,
      originEnd: item.endAt ?? item.startAt,
      startColumn: columnAt ? columnAt(event.clientX) : 0,
      moved: false,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (!session.moved) {
      if (Math.abs(event.clientY - session.startY) + Math.abs(event.clientX - session.startX) < 3) {
        return;
      }
      session.moved = true;
      setDragging(true);
    }
    setPreview(resolveFromPointer(session, event.clientX, event.clientY));
  };

  const finish = (event: ReactPointerEvent<HTMLElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    sessionRef.current = null;
    setDragging(false);
    setPreview(null);

    if (!session.moved) {
      onOpen(item);
      return;
    }
    const next = resolveFromPointer(session, event.clientX, event.clientY);
    if (next.startAt !== item.startAt || next.endAt !== (item.endAt ?? item.startAt)) {
      onCommit(next);
    }
  };

  const cancel = () => {
    sessionRef.current = null;
    setDragging(false);
    setPreview(null);
  };

  // 拖拽预览只在「同一天」时体现在位置上：跨天时块留在原列，
  // 由气泡显示目标日期（跨列换位置交给松手后的重新布局，避免半路跳动）。
  const sameDayPreview = preview ? startOfDay(preview.startAt) === dayStart : false;
  const previewTop = preview ? timeToOffsetPx(preview.startAt, dayStart, pxPerMinute) : top;
  const previewHeight = preview
    ? Math.max(16, timeToOffsetPx(preview.endAt, dayStart, pxPerMinute) - previewTop)
    : height;

  return (
    <div
      role="button"
      tabIndex={0}
      data-event-block="true"
      aria-label={`${item.title}，${clockLabel(item.startAt)} 到 ${
        item.endAt ? clockLabel(item.endAt) : "结束时间未定"
      }${item.recurring ? "，重复事件" : ""}，回车打开详情`}
      onPointerDown={(event) => handlePointerDown(event, "move")}
      onPointerMove={handlePointerMove}
      onPointerUp={finish}
      onPointerCancel={cancel}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onOpen(item);
        }
      }}
      className={cn(
        "absolute select-none rounded-md px-1.5 py-1 text-left",
        "border border-border shadow-1",
        "transition-[box-shadow,opacity] duration-[var(--dur-1)] ease-out",
        "hover:z-20 hover:shadow-2 focus-visible:z-20",
        dragging ? "z-40 overflow-visible shadow-3" : "overflow-hidden",
        done && "opacity-60",
      )}
      style={{
        top: sameDayPreview ? previewTop : top,
        height: sameDayPreview ? previewHeight : height,
        left: `calc(${left * 100}% + 2px)`,
        width: `calc(${width * 100}% - 4px)`,
        backgroundColor: soft,
        // 左侧竖条 = 目标色（无目标时用象限色），与 TaskCard 的语义保持一致
        borderLeft: `3px solid ${goalColor ?? accent}`,
        cursor: dragging ? "grabbing" : "grab",
        // 触摸设备上禁止浏览器把拖拽解释成滚动
        touchAction: "none",
        color: "var(--ink-900)",
      }}
    >
      {continuesBefore && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-0.5"
          style={{ backgroundColor: goalColor ?? accent }}
        />
      )}

      <div className={cn("flex items-center gap-1", done && "line-through decoration-1")}>
        <span className="truncate text-caption font-strong">{item.title}</span>
        {item.recurring && (
          <Repeat className="size-2.5 shrink-0 text-ink-300" aria-hidden="true" />
        )}
      </div>

      {height >= 30 && (
        <div className="tabular mt-0.5 flex items-center gap-1 truncate text-micro text-ink-500">
          <Clock3 className="size-2.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {clockLabel(item.startAt)}
            {item.endAt ? `–${clockLabel(item.endAt)}` : ""}
            {continuesAfter ? " →" : ""}
          </span>
        </div>
      )}

      {detailed && height >= 64 && (item.location || item.tags.length > 0) && (
        <div className="mt-1 flex flex-wrap items-center gap-1 text-micro text-ink-500">
          {item.location && (
            <span className="inline-flex max-w-full items-center gap-1 truncate">
              <MapPin className="size-2.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.location}</span>
            </span>
          )}
          {item.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-surface-solid/70 px-1.5 text-micro text-ink-500"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {preview && (
        <span
          className="tabular pointer-events-none absolute -top-7 left-0 z-50 whitespace-nowrap rounded-md border border-border-strong bg-surface-solid px-2 py-0.5 text-micro text-ink-900 shadow-2"
          role="status"
        >
          {dragBubbleLabel(preview.startAt, preview.endAt)}
        </span>
      )}

      {showResize && height >= 34 && (
        <span
          aria-hidden="true"
          data-resize-handle="true"
          onPointerDown={(event) => handlePointerDown(event, "resize-end")}
          onPointerMove={handlePointerMove}
          onPointerUp={finish}
          onPointerCancel={cancel}
          className="absolute inset-x-0 bottom-0 z-10 h-1.5 cursor-ns-resize touch-none"
          style={{ backgroundColor: goalColor ?? accent, opacity: 0.5 }}
        />
      )}
    </div>
  );
}

export default CalendarEventBlock;

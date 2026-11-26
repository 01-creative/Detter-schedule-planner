import { useEffect, useMemo, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { CalendarDays } from "lucide-react";
import { startOfDay } from "@detter/shared";
import { cn } from "@detter/ui";
import { formatWeekday } from "@/lib/format";
import { CalendarEventBlock } from "./CalendarEventBlock";
import { itemsOnDay, quadrantsOfDay } from "./calendarItems";
import type { CalendarItem } from "./calendarTypes";
import {
  PX_PER_HOUR,
  PX_PER_MINUTE,
  SNAP_MINUTES,
  dayHeightPx,
  layoutDay,
  offsetPxToTime,
  snapToStep,
  timeToOffsetPx,
} from "./calendarMath";

/**
 * 日 / 周视图共用的时间网格。
 *
 * 两者只有列数与信息密度不同，因此共用一套：
 * - 7 列 = 周视图；1 列 = 日视图（每列更宽，显示地点与标签）；
 * - 时间轴固定在左侧（sticky），表头与全天行固定在顶部（sticky）；
 * - 移动端每列最小 96px，整块网格横向滚动（任务书 §3.4）。
 *
 * 网格线用 `repeating-linear-gradient` 画，不生成 24 个 DOM 节点。
 */

/** 左侧时间轴宽度（布局常量，与表头、当前时间线共用，保证严丝合缝） */
const TIME_AXIS_PX = 56;
/** 默认滚到 06:00（任务书 §3.1：06:00–24:00 默认可见） */
const INITIAL_SCROLL_HOUR = 6;
/** 每 2 小时一个时间标签 */
const LABEL_STEP_HOURS = 2;

export interface TimelineGridProps {
  /** 各列对应的「日 0 点」，周一在前 */
  days: number[];
  items: CalendarItem[];
  now: number;
  /** 日视图：块内显示更多细节 */
  detailed?: boolean;
  /** goalId → 目标颜色，用于左边的色条 */
  goalColors?: Map<string, string>;
  onOpenItem: (item: CalendarItem) => void;
  /** 点击空白时段：以吸附后的开始时间新建 */
  onCreateAt: (startAt: number) => void;
  onCommitDrag: (item: CalendarItem, next: { startAt: number; endAt: number }) => void;
  /** 点击表头某一天 → 切到日视图 */
  onSelectDay?: (dayStart: number) => void;
}

export function TimelineGrid({
  days,
  items,
  now,
  detailed = false,
  goalColors,
  onOpenItem,
  onCreateAt,
  onCommitDrag,
  onSelectDay,
}: TimelineGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const scrolledRef = useRef(false);

  const dayHeight = dayHeightPx();
  const today = startOfDay(now);

  const perDay = useMemo(
    () =>
      days.map((dayStart) => {
        const dayItems = itemsOnDay(items, dayStart);
        const allDay = dayItems.filter((item) => item.allDay);
        const timed = dayItems.filter((item) => !item.allDay);
        return {
          dayStart,
          allDay,
          layout: layoutDay(timed, dayStart, { pxPerMinute: PX_PER_MINUTE }),
          quadrants: quadrantsOfDay(dayItems, dayStart),
        };
      }),
    [days, items],
  );

  /* 首次渲染滚到 06:00：日历打开时最该看到的是白天的安排。
     少滚 12px，好让 06:00 这个标签完整露出来（否则正好被上沿切一半）。 */
  useEffect(() => {
    if (scrolledRef.current) return;
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = INITIAL_SCROLL_HOUR * PX_PER_HOUR - 12;
    scrolledRef.current = true;
  }, []);

  /** clientX → 列序号。用真实列元素的 rect 判断，避免 flex 溢出时算错 */
  const columnAt = (clientX: number): number => {
    const container = columnsRef.current;
    if (!container) return 0;
    const nodes = container.querySelectorAll<HTMLElement>("[data-day-column]");
    for (let index = 0; index < nodes.length; index += 1) {
      const rect = nodes[index]!.getBoundingClientRect();
      if (clientX < rect.right || index === nodes.length - 1) return index;
    }
    return 0;
  };

  const handleColumnClick = (event: ReactMouseEvent<HTMLDivElement>, dayStart: number) => {
    if ((event.target as HTMLElement).closest("[data-event-block]")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = event.clientY - rect.top;
    const startAt = snapToStep(offsetPxToTime(offset, dayStart, PX_PER_MINUTE), SNAP_MINUTES);
    onCreateAt(startAt);
  };

  const hourLabels = useMemo(
    () => Array.from({ length: 24 / LABEL_STEP_HOURS }, (_, index) => index * LABEL_STEP_HOURS),
    [],
  );

  return (
    <section
      aria-label={days.length === 1 ? "日视图" : "周视图"}
      className={cn(
        "relative flex min-h-[360px] flex-col overflow-hidden rounded-xl border border-border bg-surface-solid shadow-1",
        // 让网格吃掉工具条以下的剩余高度（移动端工具条会折行，所以留得更多）
        "h-[calc(100dvh-22rem)] md:h-[calc(100dvh-12rem)]",
      )}
    >
      <div ref={scrollRef} data-calendar-scroller="true" className="min-h-0 flex-1 overflow-auto">
        {/* 表头 + 全天行一起 sticky：两者的高度都不必写成魔法数字 */}
        <div className="sticky top-0 z-20 bg-surface-solid">
          {/* 表头：横向随列滚动（移动端），纵向固定 */}
          <div className="flex border-b border-border">
            <div className="shrink-0 border-r border-border" style={{ width: TIME_AXIS_PX }} />
            {days.map((dayStart) => {
              const isToday = dayStart === today;
              const date = new Date(dayStart);
              return (
                <button
                  key={dayStart}
                  type="button"
                  onClick={() => onSelectDay?.(dayStart)}
                  aria-label={`${date.getMonth() + 1}月${date.getDate()}日 ${formatWeekday(dayStart)}`}
                  className={cn(
                    "flex min-w-24 flex-1 flex-col items-center gap-0.5 border-l border-border py-1.5",
                    "transition-colors duration-[var(--dur-1)] hover:bg-surface-sunken/60",
                    isToday && "bg-accent-soft/40",
                  )}
                >
                  <span className="text-micro text-ink-500">{formatWeekday(dayStart)}</span>
                  <span
                    className={cn(
                      "tabular grid size-6 place-items-center rounded-full text-caption",
                      isToday ? "bg-accent font-strong text-on-accent" : "text-ink-900",
                    )}
                  >
                    {date.getDate()}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 全天行：allDay 事件与只有截止时间的任务 */}
          <div className="flex min-h-8 border-b border-border">
            <div
              className="shrink-0 border-r border-border py-1 pr-1 text-right text-micro text-ink-300"
              style={{ width: TIME_AXIS_PX }}
            >
              全天
            </div>
            {perDay.map(({ dayStart, allDay }) => (
              <div
                key={dayStart}
                className={cn(
                  "min-w-24 flex-1 space-y-0.5 border-l border-border p-0.5",
                  dayStart === today && "bg-accent-soft/30",
                )}
              >
                {allDay.slice(0, 2).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onOpenItem(item)}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-1 truncate rounded-sm px-1 text-left text-micro",
                      item.status === "done" && "line-through opacity-60",
                    )}
                    style={{
                      backgroundColor: `var(--q${item.quadrant}-soft)`,
                      color: "var(--ink-900)",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: `var(--q${item.quadrant}-accent)` }}
                    />
                    <span className="truncate">
                      {item.dueOnly ? "截止 · " : ""}
                      {item.title}
                    </span>
                  </button>
                ))}
                {allDay.length > 2 && (
                  <span className="block px-1 text-micro text-ink-300">+{allDay.length - 2}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 24 小时网格 */}
        <div className="flex" style={{ height: dayHeight }}>
          <div
            className="relative sticky left-0 z-10 shrink-0 border-r border-border bg-surface-solid"
            style={{ width: TIME_AXIS_PX }}
          >
            {hourLabels.map((hour) => (
              <div
                key={hour}
                className="tabular absolute -translate-y-1/2 pr-1 text-right text-micro text-ink-300"
                style={{ width: TIME_AXIS_PX - 4, top: hour * PX_PER_HOUR }}
              >
                {hour === 0 ? "" : `${String(hour).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>

          <div ref={columnsRef} className="relative flex min-w-0 flex-1">
            {perDay.map(({ dayStart, layout }, dayIndex) => (
              <div
                key={dayStart}
                data-day-column={dayIndex}
                onClick={(event) => handleColumnClick(event, dayStart)}
                className={cn(
                  "relative min-w-24 flex-1 border-l border-border",
                  dayStart === today && "bg-accent-soft/20",
                  dayIndex === 0 && "border-l-0",
                )}
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent " +
                    `${PX_PER_HOUR}px)`,
                }}
              >
                {layout.placed
                  .filter((placed) => !placed.hidden)
                  .map((placed) => (
                    <CalendarEventBlock
                      key={placed.item.key}
                      item={placed.item}
                      dayStart={dayStart}
                      top={placed.top}
                      height={placed.height}
                      left={placed.left}
                      width={placed.width}
                      pxPerMinute={PX_PER_MINUTE}
                      detailed={detailed}
                      showResize={!placed.continuesAfter}
                      continuesBefore={placed.continuesBefore}
                      continuesAfter={placed.continuesAfter}
                      goalColor={placed.item.goalId ? goalColors?.get(placed.item.goalId) : null}
                      columnAt={columnAt}
                      onOpen={onOpenItem}
                      onCommit={(next) => onCommitDrag(placed.item, next)}
                    />
                  ))}

                {layout.overflow.map((mark) => (
                  <span
                    key={`overflow-${mark.start}`}
                    className="tabular pointer-events-none absolute right-0 z-20 rounded-sm bg-surface-solid px-1 text-micro text-ink-500 shadow-1"
                    style={{
                      top: mark.top,
                      width: `${(1 / Math.max(1, layout.columns)) * 100}%`,
                    }}
                  >
                    +{mark.count}
                  </span>
                ))}
              </div>
            ))}

            {days.includes(today) && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute right-0 z-30"
                style={{
                  left: 0,
                  top: timeToOffsetPx(now, today, PX_PER_MINUTE),
                }}
              >
                <div className="relative h-0.5 bg-danger">
                  <span className="absolute -top-[3px] -left-[3px] size-2 rounded-full bg-danger" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 空周/空日：整屏网格是「信息」，但没有「下一步」。
          这里叠一张不拦指针的空态卡，点任意空白时段仍然直接新建。
          用 items.length 判空而不是 days：一列有事件就说明这屏不是空的。 */}
      {items.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4">
          <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-surface-solid/90 px-5 py-4 text-center shadow-1 backdrop-blur-sm">
            <CalendarDays className="size-5 text-ink-300" aria-hidden="true" />
            <p className="text-caption font-strong text-ink-900">
              {days.length === 1 ? "这一天还空着" : "这一周还空着"}
            </p>
            <p className="text-micro text-ink-500">点任意空白时段新建；拖动事件即可改期</p>
          </div>
        </div>
      )}
    </section>
  );
}

export default TimelineGrid;

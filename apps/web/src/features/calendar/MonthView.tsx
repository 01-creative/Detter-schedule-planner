import { useMemo } from "react";
import { startOfDay } from "@detter/shared";
import { cn } from "@detter/ui";
import { formatWeekday } from "@/lib/format";
import { itemsOnDay } from "./calendarItems";
import type { CalendarItem } from "./calendarTypes";
import { clockLabel, monthGridStarts } from "./calendarMath";

/**
 * 月视图（任务书 §3.3）：固定 6×7 网格，每格最多 3 条（超出 +N），
 * 有任务的日期下方按象限颜色点小圆点；点击某天 → 切到日视图。
 *
 * 行数固定为 6 的原因：翻月时网格高度不跳动，视觉上更稳；
 * 也让「一次最多渲染 126 个块」这个性能上限有确定的值。
 */

const WEEKDAY_HEADERS = ["一", "二", "三", "四", "五", "六", "日"] as const;
const MAX_CELL_ITEMS = 3;

export interface MonthViewProps {
  anchor: number;
  items: CalendarItem[];
  now: number;
  onOpenItem: (item: CalendarItem) => void;
  onSelectDay: (dayStart: number) => void;
}

export function MonthView({ anchor, items, now, onOpenItem, onSelectDay }: MonthViewProps) {
  const days = useMemo(() => monthGridStarts(anchor), [anchor]);
  const month = new Date(anchor).getMonth();
  const today = startOfDay(now);

  return (
    <section
      aria-label="月视图"
      className="overflow-hidden rounded-xl border border-border bg-surface-solid shadow-1"
    >
      <div className="grid grid-cols-7 border-b border-border bg-surface-sunken/40">
        {WEEKDAY_HEADERS.map((label) => (
          <div
            key={label}
            className="px-2 py-1.5 text-center text-micro text-ink-500"
            aria-hidden="true"
          >
            周{label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((dayStart, index) => {
          const date = new Date(dayStart);
          const isToday = dayStart === today;
          const inMonth = date.getMonth() === month;
          const dayItems = itemsOnDay(items, dayStart);
          const quadrants = [...new Set(dayItems.map((item) => item.quadrant))].sort();
          const visible = dayItems.slice(0, MAX_CELL_ITEMS);

          return (
            <div
              key={dayStart}
              role="button"
              tabIndex={0}
              aria-label={`${date.getMonth() + 1}月${date.getDate()}日 ${formatWeekday(dayStart)}，${
                dayItems.length
              } 项安排，回车查看当天`}
              onClick={() => onSelectDay(dayStart)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectDay(dayStart);
                }
              }}
              className={cn(
                "min-h-[76px] cursor-pointer border-border p-1 md:min-h-[108px] md:p-1.5",
                "border-r border-b transition-colors duration-[var(--dur-1)] hover:bg-surface-sunken/50",
                (index + 1) % 7 === 0 && "border-r-0",
                index >= 35 && "border-b-0",
                !inMonth && "bg-surface-sunken/30",
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span
                  className={cn(
                    "tabular grid size-6 place-items-center rounded-full text-caption",
                    isToday
                      ? "bg-accent font-strong text-on-accent"
                      : inMonth
                        ? "text-ink-900"
                        : "text-ink-300",
                  )}
                >
                  {date.getDate()}
                </span>
                {quadrants.length > 0 && (
                  <span className="flex items-center gap-0.5" aria-hidden="true">
                    {quadrants.map((quadrant) => (
                      <span
                        key={quadrant}
                        className="size-1.5 rounded-full"
                        style={{ backgroundColor: `var(--q${quadrant}-accent)` }}
                      />
                    ))}
                  </span>
                )}
              </div>

              <div className="mt-1 space-y-0.5">
                {visible.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenItem(item);
                    }}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-1 truncate rounded-sm px-1 text-left text-micro",
                      item.status === "done" && "line-through opacity-60",
                    )}
                    style={{ backgroundColor: `var(--q${item.quadrant}-soft)` }}
                  >
                    {!item.allDay && (
                      <span className="tabular shrink-0 text-ink-500">{clockLabel(item.startAt)}</span>
                    )}
                    <span className="truncate">{item.title}</span>
                  </button>
                ))}
                {dayItems.length > MAX_CELL_ITEMS && (
                  <span className="block px-1 text-micro text-ink-300">
                    +{dayItems.length - MAX_CELL_ITEMS}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default MonthView;

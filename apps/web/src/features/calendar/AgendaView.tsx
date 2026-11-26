import { useMemo } from "react";
import { CalendarPlus, Check, MapPin, Repeat } from "lucide-react";
import { Button, EmptyState, cn } from "@detter/ui";
import { formatWeekday } from "@/lib/format";
import { groupItemsByDay } from "./calendarItems";
import type { CalendarItem } from "./calendarTypes";
import { clockLabel, durationLabel, monthDayLabel } from "./calendarMath";
import { describeRRule } from "./recurrence";

/**
 * 移动端议程视图（任务书 §3.4）：按天分组的任务流。
 *
 * 为什么移动端默认它：375 宽的周视图每列只有 96px，能看见的只有一片色块；
 * 「今天还有什么、明天几点」用列表回答比用网格回答快得多。
 */
export interface AgendaViewProps {
  from: number;
  to: number;
  items: CalendarItem[];
  now: number;
  onOpenItem: (item: CalendarItem) => void;
  onCreate: () => void;
  onToggleDone: (item: CalendarItem, done: boolean) => void;
}

function dayHeading(dayStart: number, now: number): { primary: string; secondary: string } {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dayStart - today.getTime()) / 86_400_000);
  const primary =
    diffDays === 0 ? "今天" : diffDays === 1 ? "明天" : monthDayLabel(dayStart);
  return { primary, secondary: formatWeekday(dayStart) };
}

export function AgendaView({
  from,
  to,
  items,
  now,
  onOpenItem,
  onCreate,
  onToggleDone,
}: AgendaViewProps) {
  const groups = useMemo(() => groupItemsByDay(items, from, to), [items, from, to]);
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  if (total === 0) {
    return (
      <EmptyState
        icon={<CalendarPlus className="size-5" aria-hidden="true" />}
        title="这 30 天还没有安排"
        description="点一下空白时间，或者先建一条再说。"
        action={
          <Button variant="primary" onClick={onCreate} leftIcon={<CalendarPlus className="size-4" aria-hidden="true" />}>
            新建日程
          </Button>
        }
        className="rounded-xl border border-border bg-surface-solid"
      />
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const heading = dayHeading(group.dayStart, now);
        return (
          <section
            key={group.dayStart}
            className="overflow-hidden rounded-xl border border-border bg-surface-solid shadow-1"
            aria-label={`${monthDayLabel(group.dayStart)} 的安排`}
          >
            <header className="flex items-baseline gap-2 border-b border-border bg-surface-sunken/40 px-3 py-2">
              <h3 className="text-h2 text-ink-900">{heading.primary}</h3>
              <span className="text-micro text-ink-500">{heading.secondary}</span>
              <span className="ml-auto text-micro text-ink-300">{group.items.length} 项</span>
            </header>

            <ul>
              {group.items.map((item) => {
                const done = item.status === "done";
                return (
                  <li
                    key={item.key}
                    className="flex items-start gap-3 border-b border-border px-3 py-2.5 last:border-b-0"
                  >
                    <div className="w-12 shrink-0 pt-0.5 text-right">
                      {item.allDay ? (
                        <span className="text-micro text-ink-500">全天</span>
                      ) : (
                        <>
                          <div className="tabular text-caption text-ink-900">
                            {clockLabel(item.startAt)}
                          </div>
                          {item.endAt && (
                            <div className="tabular text-micro text-ink-300">
                              {clockLabel(item.endAt)}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenItem(item)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: `var(--q${item.quadrant}-accent)` }}
                        />
                        <span
                          className={cn(
                            "truncate text-body text-ink-900",
                            done && "line-through opacity-60",
                          )}
                        >
                          {item.title}
                        </span>
                        {item.recurring && (
                          <span
                            className="inline-flex shrink-0 items-center gap-0.5 text-micro text-ink-300"
                            title={describeRRule(item.rrule)}
                          >
                            <Repeat className="size-3" aria-hidden="true" />
                          </span>
                        )}
                      </div>

                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-3.5 text-micro text-ink-500">
                        {item.dueOnly && <span>截止事项</span>}
                        {item.endAt && !item.allDay && (
                          <span>{durationLabel((item.endAt - item.startAt) / 60_000)}</span>
                        )}
                        {item.location && (
                          <span className="inline-flex items-center gap-0.5">
                            <MapPin className="size-2.5" aria-hidden="true" />
                            {item.location}
                          </span>
                        )}
                        {item.tags.slice(0, 2).map((tag) => (
                          <span key={tag}>#{tag}</span>
                        ))}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => onToggleDone(item, !done)}
                      aria-label={done ? `取消完成：${item.title}` : `标记完成：${item.title}`}
                      aria-pressed={done}
                      className={cn(
                        "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border transition-colors duration-[var(--dur-1)]",
                        done
                          ? "border-success bg-success-soft text-success-ink"
                          : "border-border-strong text-ink-300 hover:border-accent hover:text-accent",
                      )}
                    >
                      <Check className="size-3.5" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export default AgendaView;

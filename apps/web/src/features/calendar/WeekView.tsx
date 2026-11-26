import { useMemo } from "react";
import { weekDayStarts } from "./calendarMath";
import type { CalendarItem } from "./calendarTypes";
import { TimelineGrid } from "./TimelineGrid";

/**
 * 周视图（任务书 §3.1）：7 列 × 24 小时网格，每小时 56px，
 * 默认滚到 06:00；全天行、当前时间指示线、重叠分列都在 TimelineGrid 里。
 */
export interface WeekViewProps {
  anchor: number;
  items: CalendarItem[];
  now: number;
  goalColors?: Map<string, string>;
  onOpenItem: (item: CalendarItem) => void;
  onCreateAt: (startAt: number) => void;
  onCommitDrag: (item: CalendarItem, next: { startAt: number; endAt: number }) => void;
  onSelectDay?: (dayStart: number) => void;
}

export function WeekView({ anchor, ...rest }: WeekViewProps) {
  const days = useMemo(() => weekDayStarts(anchor), [anchor]);
  return <TimelineGrid days={days} {...rest} />;
}

export default WeekView;

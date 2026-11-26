import { useMemo } from "react";
import { startOfDay } from "@detter/shared";
import type { CalendarItem } from "./calendarTypes";
import { TimelineGrid } from "./TimelineGrid";

/**
 * 日视图（任务书 §3.2）：单列、更宽，块里额外显示地点与标签。
 * 与周视图共用 TimelineGrid，差别只有「几列」和「详细程度」。
 */
export interface DayViewProps {
  anchor: number;
  items: CalendarItem[];
  now: number;
  goalColors?: Map<string, string>;
  onOpenItem: (item: CalendarItem) => void;
  onCreateAt: (startAt: number) => void;
  onCommitDrag: (item: CalendarItem, next: { startAt: number; endAt: number }) => void;
}

export function DayView({ anchor, ...rest }: DayViewProps) {
  const days = useMemo(() => [startOfDay(anchor)], [anchor]);
  return <TimelineGrid days={days} detailed {...rest} />;
}

export default DayView;

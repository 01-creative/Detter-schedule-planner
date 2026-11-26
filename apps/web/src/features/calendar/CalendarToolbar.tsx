import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button, Tabs } from "@detter/ui";
import type { TabItem } from "@detter/ui";
import type { CalendarViewMode } from "./calendarMath";
import { viewTitle } from "./calendarMath";

/**
 * 日历工具条：‹ 今天 › + 区间标题 + 视图切换 + 新建（任务书 §3.1）。
 *
 * 移动端隐藏键盘提示与「新建」的文字，只留图标；
 * 视图切换项由父级按断点传入（桌面 日/周/月，移动 议程/周/月）。
 */

const MODE_LABELS: Record<CalendarViewMode, string> = {
  day: "日",
  week: "周",
  month: "月",
  agenda: "议程",
};

export interface CalendarToolbarProps {
  mode: CalendarViewMode;
  anchor: number;
  now: number;
  modes: readonly CalendarViewMode[];
  onModeChange: (mode: CalendarViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onCreate: () => void;
}

export function CalendarToolbar({
  mode,
  anchor,
  now,
  modes,
  onModeChange,
  onPrev,
  onNext,
  onToday,
  onCreate,
}: CalendarToolbarProps) {
  const items: TabItem[] = modes.map((value) => ({ value, label: MODE_LABELS[value] }));

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-3">
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          aria-label="上一周期"
          title="上一周期（←）"
          onClick={onPrev}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Button>
        <Button size="sm" variant="secondary" onClick={onToday} title="回到今天（T）">
          今天
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="下一周期"
          title="下一周期（→）"
          onClick={onNext}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <h2 className="tabular text-h1 text-ink-900">{viewTitle(mode, anchor, now)}</h2>

      <div className="ml-auto flex items-center gap-2">
        <Tabs
          items={items}
          value={mode}
          onValueChange={(value) => onModeChange(value as CalendarViewMode)}
          variant="pill"
          ariaLabel="日历视图切换"
        />
        <Button
          variant="primary"
          size="md"
          onClick={onCreate}
          leftIcon={<Plus className="size-4" aria-hidden="true" />}
        >
          <span className="hidden sm:inline">新建</span>
        </Button>
      </div>

      <p className="hidden w-full text-micro text-ink-300 lg:block">
        ← / → 切换周期 · T 回到今天 · 拖动事件改期，拉底边改时长
      </p>
    </div>
  );
}

export default CalendarToolbar;

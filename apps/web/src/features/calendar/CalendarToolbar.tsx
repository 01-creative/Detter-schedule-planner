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
    <div className="pb-3">
      {/* 标题区节奏与其它页对齐：眉题 12/18 → 4px → 标题 22/30。
          原来把「←/→ 切换周期 · T 回到今天 · 拖动事件改期…」做成标题下方的第三行，
          既多占 16px，又让日历的时间网格整体下移；这里把最有用的一句并进眉题。 */}
      <p className="text-caption text-ink-500">日历 · 拖动事件改期，拉底边改时长</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* 移动端标题独占一行、控件在下一行；sm+ 恢复「‹ 今天 › 标题 …… 视图/新建」。
            直接让 h1 参与同一行换行的话，375 下三段会各占一行，标题被推到 134px。 */}
        <h1 className="tabular order-1 w-full text-h1 text-ink-900 sm:order-2 sm:w-auto">
          {viewTitle(mode, anchor, now)}
        </h1>

        <div className="order-2 flex items-center gap-1 sm:order-1">
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

        <div className="order-3 ml-auto flex items-center gap-2">
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
      </div>
    </div>
  );
}

export default CalendarToolbar;

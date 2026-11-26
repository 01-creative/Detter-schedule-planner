import { Button, Menu, Tabs, cn } from "@detter/ui";
import type { MenuItem } from "@detter/ui";
import { ArrowUpDown, Ellipsis, PanelRightClose, PanelRightOpen, Target } from "lucide-react";
import type { BoardStats } from "./stats";
import type { SortMode, ViewMode } from "./types";

/**
 * 统计条：今日 N · 逾期 N · Q2 占比 N%，右边是视图/排序切换。
 *
 * 三个数字里最重要的是 Q2 占比：它衡量的是「有没有在做重要但不紧急的事」。
 * 视图切换放这里而不是藏进菜单，是因为它是这个页面最常用的开关之一。
 */
export interface BoardStatsBarProps {
  stats: BoardStats;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  sortMode: SortMode;
  onSortModeChange: (mode: SortMode) => void;
  onOpenGoalRail: () => void;
  onToggleGoalRail: () => void;
  goalRailCollapsed: boolean;
}

export function BoardStatsBar({
  stats,
  viewMode,
  onViewModeChange,
  sortMode,
  onSortModeChange,
  onOpenGoalRail,
  onToggleGoalRail,
  goalRailCollapsed,
}: BoardStatsBarProps) {
  const mobileItems: MenuItem[] = [
    {
      key: "view-list",
      label: "列表视图",
      active: viewMode === "list",
      onSelect: () => onViewModeChange("list"),
    },
    {
      key: "view-free",
      label: "自由视图",
      active: viewMode === "free",
      onSelect: () => onViewModeChange("free"),
    },
    {
      key: "sort-smart",
      label: "智能排序",
      active: sortMode === "smart",
      onSelect: () => onSortModeChange("smart"),
    },
    {
      key: "sort-manual",
      label: "手动排序",
      active: sortMode === "manual",
      onSelect: () => onSortModeChange("manual"),
    },
    {
      key: "goals",
      label: "打开目标栏",
      onSelect: onOpenGoalRail,
    },
  ];

  const sortItems: MenuItem[] = [
    { key: "smart", label: "智能排序", active: sortMode === "smart", onSelect: () => onSortModeChange("smart") },
    { key: "manual", label: "手动排序", active: sortMode === "manual", onSelect: () => onSortModeChange("manual") },
  ];

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex items-baseline gap-2">
        <h1 className="hidden text-h2 text-ink-900 sm:block">四象限</h1>
        <p className="hidden text-caption text-ink-300 lg:block">先做重要的事</p>
      </div>

      <dl className="flex items-center gap-3 text-caption" aria-label="今日概览">
        <div className="flex items-baseline gap-1">
          <dt className="text-ink-500">今日</dt>
          <dd className="tabular font-strong text-ink-900">{stats.today}</dd>
        </div>
        <span aria-hidden="true" className="text-ink-300">
          ·
        </span>
        <div className="flex items-baseline gap-1">
          <dt className={stats.overdue > 0 ? "text-danger-ink" : "text-ink-500"}>逾期</dt>
          <dd className={cn("tabular font-strong", stats.overdue > 0 ? "text-danger-ink" : "text-ink-900")}>
            {stats.overdue}
          </dd>
        </div>
        <span aria-hidden="true" className="text-ink-300">
          ·
        </span>
        <div className="flex items-baseline gap-1">
          <dt className="text-ink-500">Q2 占比</dt>
          <dd className="tabular font-strong text-ink-900">{stats.q2Share}%</dd>
        </div>
      </dl>

      <div className="ml-auto flex items-center gap-1.5">
        <Tabs
          ariaLabel="视图切换"
          variant="pill"
          className="hidden md:flex"
          value={viewMode}
          onValueChange={(value) => onViewModeChange(value as ViewMode)}
          items={[
            { value: "list", label: "列表" },
            { value: "free", label: "自由" },
          ]}
        />

        <div className="hidden md:block">
          <Menu
            align="end"
            label="排序方式"
            items={sortItems}
            trigger={
              <Button size="icon" variant="ghost" aria-label="排序方式">
                <ArrowUpDown className="size-4" aria-hidden="true" />
              </Button>
            }
          />
        </div>

        <Button
          size="icon"
          variant="ghost"
          className="hidden lg:inline-flex"
          aria-label={goalRailCollapsed ? "展开目标栏" : "收起目标栏"}
          aria-pressed={!goalRailCollapsed}
          onClick={onToggleGoalRail}
        >
          {goalRailCollapsed ? (
            <PanelRightOpen className="size-4" aria-hidden="true" />
          ) : (
            <PanelRightClose className="size-4" aria-hidden="true" />
          )}
        </Button>

        <Button
          size="icon"
          variant="ghost"
          className="lg:hidden"
          aria-label="打开目标栏"
          onClick={onOpenGoalRail}
        >
          <Target className="size-4" aria-hidden="true" />
        </Button>

        <div className="md:hidden">
          <Menu
            align="end"
            label="更多操作"
            items={mobileItems}
            trigger={
              <Button size="icon" variant="ghost" aria-label="更多操作">
                <Ellipsis className="size-4" aria-hidden="true" />
              </Button>
            }
          />
        </div>
      </div>
    </header>
  );
}

export default BoardStatsBar;

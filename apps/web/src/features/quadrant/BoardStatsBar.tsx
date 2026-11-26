import { Fragment } from "react";
import type { ReactNode } from "react";
import { Button, Menu, Tabs, cn } from "@detter/ui";
import type { MenuItem } from "@detter/ui";
import { ArrowUpDown, Ellipsis, PanelRightClose, PanelRightOpen, Target } from "lucide-react";
import { PageHeading } from "@/components/common/PageHeading";
import type { BoardStats } from "./stats";
import type { SortMode, ViewMode } from "./types";

/**
 * 统计条：今日 N · 逾期 N · Q2 占比 N%，右边是视图/排序切换。
 *
 * 三个数字里最重要的是 Q2 占比：它衡量的是「有没有在做重要但不紧急的事」。
 * 视图切换放这里而不是藏进菜单，是因为它是这个页面最常用的开关之一。
 *
 * 空数据纪律（T15）：
 * - 没有任务时不再输出「今日 0 · 逾期 0 · Q2 占比 0%」——三个 0 不提供信息，只占首屏；
 *   改成一句引导，等有第一条任务再回到数字。
 * - 有任务但今天没有到期项时，把「今日 0」换成「今日 没有到期的事」；
 *   逾期只在 >0 时出现（0 逾期不需要占一个位置）。
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

interface Metric {
  key: string;
  label: string;
  value: ReactNode;
  tone?: "danger";
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
  const hasTasks = stats.open > 0;
  const metrics: Metric[] = [];
  if (stats.overdue > 0) {
    metrics.push({ key: "overdue", label: "逾期", value: stats.overdue, tone: "danger" });
  }
  if (stats.today > 0) {
    metrics.push({ key: "today", label: "今日", value: stats.today });
  }
  if (metrics.length === 0) {
    metrics.push({ key: "clear", label: "今日", value: "没有到期的事" });
  }
  metrics.push({ key: "q2", label: "Q2 占比", value: `${stats.q2Share}%` });

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
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <PageHeading
        eyebrow={
          hasTasks ? (
            <div
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
              role="group"
              aria-label="今日概览"
            >
              {metrics.map((metric, index) => (
                <Fragment key={metric.key}>
                  {index > 0 && (
                    <span aria-hidden="true" className="text-ink-300">
                      ·
                    </span>
                  )}
                  <span className="inline-flex items-baseline gap-1">
                    <span className={metric.tone === "danger" ? "text-danger-ink" : "text-ink-500"}>
                      {metric.label}
                    </span>
                    <span
                      className={cn(
                        "font-strong",
                        metric.tone === "danger" ? "text-danger-ink" : "text-ink-900",
                        typeof metric.value === "number" && "tabular",
                      )}
                    >
                      {metric.value}
                    </span>
                  </span>
                </Fragment>
              ))}
            </div>
          ) : (
            <span>空白的一页 —— 从下面任意一格开始</span>
          )
        }
        title="四象限"
        titleAddon={
          <p className="hidden text-caption text-ink-300 lg:block">先做重要的事</p>
        }
      />

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

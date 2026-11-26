import { Fragment } from "react";
import type { ReactNode } from "react";
import { Button, cn } from "@detter/ui";
import { PanelRightClose, PanelRightOpen, Plus, Target } from "lucide-react";
import type { Quadrant } from "@detter/shared";
import { QUADRANT_ORDER } from "@detter/shared";
import { PageHeading } from "@/components/common/PageHeading";
import type { BoardStats } from "./stats";

/**
 * 平面标题条：今日 / 逾期 / Q2 占比 + 四象限计数 + 目标栏开关。
 *
 * 统计口径保持不变：Q2 占比衡量「有没有在做重要但不紧急的事」。
 * 四象限计数只为标题做一次总览——平面四个角还会各显示一次，
 * 但那里是「空间信息」，这里是「一眼可扫的横排数字」，两者不冲突。
 *
 * 视图切换（列表/自由）已经删除：首页只有一张连续平面，没有第二种看法。
 */
export interface BoardStatsBarProps {
  stats: BoardStats;
  onNewTask: () => void;
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
  onNewTask,
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
            <span>空白的一页 —— 双击平面任意位置开始</span>
          )
        }
        title="四象限"
        titleAddon={
          <p className="hidden text-caption text-ink-300 lg:block">
            横轴 紧急度 · 纵轴 重要度 · 越远越极端
          </p>
        }
      />

      <div className="ml-auto flex items-center gap-1.5">
        <ul
          aria-label="四象限未完成计数"
          className="mr-1 hidden items-center gap-2.5 xl:flex"
        >
          {QUADRANT_ORDER.map((quadrant: Quadrant) => (
            <li key={quadrant} className="flex items-center gap-1 text-micro text-ink-500">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full"
                style={{ backgroundColor: `var(--q${quadrant}-accent)` }}
              />
              <span className="sr-only">Q{quadrant} </span>
              <span className="text-ink-300">Q{quadrant}</span>
              <span className="tabular font-strong text-ink-700">{stats.quadrants[quadrant]}</span>
            </li>
          ))}
        </ul>

        <Button
          size="sm"
          variant="secondary"
          aria-label="新建任务"
          onClick={onNewTask}
          leftIcon={<Plus className="size-3.5" aria-hidden="true" />}
          className="hidden sm:inline-flex"
        >
          新建
        </Button>

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
      </div>
    </header>
  );
}

export default BoardStatsBar;

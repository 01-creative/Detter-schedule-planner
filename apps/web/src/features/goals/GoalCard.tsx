import type { PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, GripVertical, Layers } from "lucide-react";
import type { Goal, Task } from "@detter/shared";
import { Button, cn } from "@detter/ui";
import { GoalDetail } from "./GoalDetail";
import { GoalProgressRing } from "./GoalProgressRing";
import { goalIconOption } from "./goal-visuals";
import { goalSubtitle, type GoalTaskStats } from "./rules";

/**
 * 目标卡。
 *
 * 三件事同时成立：
 * - 点击展开详情（含关联任务与里程碑）；
 * - 拖动卡身可以拖到右边象限里建任务；
 * - 左侧把手只负责上下重排（两种拖动语义分开，避免「想重排却建了任务」）。
 */
export interface GoalCardProps {
  goal: Goal;
  tasks: Task[];
  stats: GoalTaskStats;
  expanded: boolean;
  reordering: boolean;
  showExpand: boolean;
  onToggleExpand: (goal: Goal) => void;
  onStartDrag: (goal: Goal, event: ReactPointerEvent<HTMLElement>) => void;
  onStartReorder: (goal: Goal, event: ReactPointerEvent<HTMLElement>) => void;
  onReorderKey: (goal: Goal, delta: -1 | 1) => void;
  onExpandTemplate: (goal: Goal) => void;
  onToggleTask: (task: Task) => void;
  onToggleMilestone: (goal: Goal, milestoneId: string) => void;
}

export function GoalCard({
  goal,
  tasks,
  stats,
  expanded,
  reordering,
  showExpand,
  onToggleExpand,
  onStartDrag,
  onStartReorder,
  onReorderKey,
  onExpandTemplate,
  onToggleTask,
  onToggleMilestone,
}: GoalCardProps) {
  const option = goalIconOption(goal.icon);
  const Icon = option.Icon;

  return (
    <li
      data-goal-id={goal.id}
      className={cn(
        "group/goal rounded-lg border border-border bg-surface-solid shadow-1",
        "transition-[box-shadow,opacity] duration-[var(--dur-1)] ease-out",
        (expanded || reordering) && "shadow-2",
        reordering && "opacity-60",
      )}
    >
      <div className="flex items-stretch gap-0.5 p-1.5">
        <button
          type="button"
          aria-label={`拖动调整「${goal.title}」顺序`}
          title="上下拖动重排（Alt + 方向键）"
          onPointerDown={(event) => onStartReorder(goal, event)}
          onKeyDown={(event) => {
            if (!event.altKey) return;
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            onReorderKey(goal, event.key === "ArrowUp" ? -1 : 1);
          }}
          className={cn(
            "inline-flex w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded text-ink-300",
            "opacity-0 transition-opacity duration-[var(--dur-1)] hover:text-ink-500",
            "group-hover/goal:opacity-100 focus-visible:opacity-100 max-md:opacity-100",
          )}
        >
          <GripVertical className="size-3.5" aria-hidden="true" />
        </button>

        <button
          type="button"
          aria-expanded={showExpand ? expanded : undefined}
          onClick={() => onToggleExpand(goal)}
          onPointerDown={(event) => onStartDrag(goal, event)}
          className="flex min-w-0 flex-1 cursor-grab items-start gap-2 rounded-md px-0.5 py-0.5 text-left active:cursor-grabbing"
        >
          <span
            aria-hidden="true"
            className="mt-1.5 size-2 shrink-0 rounded-full"
            style={{ backgroundColor: goal.color }}
          />
          <Icon className="mt-0.5 size-3.5 shrink-0" style={{ color: goal.color }} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-strong text-ink-900" title={goal.title}>
              {goal.title}
            </span>
            <span className="mt-0.5 block truncate text-micro text-ink-500">
              {goalSubtitle(goal)}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-center gap-0.5">
            <GoalProgressRing
              done={stats.done}
              total={stats.total}
              color={goal.color}
            />
            <span className="tabular text-[10px] leading-none text-ink-500">{stats.total} 项</span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "mt-1 size-3.5 shrink-0 text-ink-300 transition-transform duration-[var(--dur-2)]",
              expanded && "rotate-180",
            )}
          />
        </button>
      </div>

      {goal.kind === "template" && (
        <div className="flex items-center justify-between gap-2 border-t border-border/70 px-2.5 py-1.5">
          <p className="min-w-0 truncate text-micro text-ink-300">
            {goal.milestones.length > 0
              ? `${goal.milestones.length} 个步骤`
              : "拖到象限即可创建"}
          </p>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Layers className="size-3" aria-hidden="true" />}
            onClick={() => onExpandTemplate(goal)}
          >
            铺开
          </Button>
        </div>
      )}

      {expanded && (
        <GoalDetail
          goal={goal}
          tasks={tasks}
          stats={stats}
          onToggleTask={onToggleTask}
          onToggleMilestone={(milestoneId) => onToggleMilestone(goal, milestoneId)}
        />
      )}
    </li>
  );
}

export default GoalCard;

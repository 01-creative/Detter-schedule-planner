import { Check, Flag } from "lucide-react";
import type { Goal, Task } from "@detter/shared";
import { Progress, cn } from "@detter/ui";
import { formatDayLabel } from "@/lib/format";
import type { GoalTaskStats } from "./rules";

/**
 * 目标展开后的详情：完成率 + 该目标下的任务 + 里程碑勾选。
 * 这里是「目标」与「任务」两条线真正接上的地方——
 * 完成率不是手填的，是从关联任务里算出来的。
 */
export interface GoalDetailProps {
  goal: Goal;
  tasks: Task[];
  stats: GoalTaskStats;
  onToggleTask: (task: Task) => void;
  onToggleMilestone: (milestoneId: string) => void;
}

export function GoalDetail({ goal, tasks, stats, onToggleTask, onToggleMilestone }: GoalDetailProps) {
  const percent = stats.ratio === null ? null : Math.round(stats.ratio * 100);

  return (
    <div className="border-t border-border px-2.5 py-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-micro text-ink-500">完成率</span>
        <span className="tabular text-micro text-ink-700">
          {percent === null ? "—" : `${percent}%`}
        </span>
      </div>
      <Progress
        value={stats.done}
        max={stats.total || 1}
        tone="success"
        trailing={`${stats.done}/${stats.total}`}
        className="mt-1"
      />

      {tasks.length > 0 ? (
        <ul className="mt-2 max-h-44 space-y-0.5 overflow-y-auto pr-1">
          {tasks.map((task) => {
            const done = task.status === "done";
            return (
              <li
                key={task.id}
                className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-surface-sunken"
              >
                <button
                  type="button"
                  aria-label={done ? `取消完成「${task.title}」` : `完成「${task.title}」`}
                  aria-pressed={done}
                  onClick={() => onToggleTask(task)}
                  className={cn(
                    "inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                    done
                      ? "border-transparent bg-success text-on-accent"
                      : "border-border-strong text-transparent hover:border-accent",
                  )}
                >
                  <Check className="size-2" strokeWidth={3} aria-hidden="true" />
                </button>
                <span
                  aria-hidden="true"
                  className="size-1 shrink-0 rounded-full"
                  style={{ backgroundColor: `var(--q${task.quadrant}-accent)` }}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-micro",
                    done ? "text-ink-300 line-through" : "text-ink-700",
                  )}
                >
                  {task.title}
                </span>
                {task.dueAt !== null && (
                  <span className="shrink-0 text-[10px] text-ink-300">
                    {formatDayLabel(task.dueAt)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-micro text-ink-300">
          还没有关联任务。把目标拖到象限，就会生成一件具体的事。
        </p>
      )}

      {goal.milestones.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <p className="flex items-center gap-1 text-micro text-ink-500">
            <Flag className="size-3" aria-hidden="true" />
            里程碑
          </p>
          <ul className="mt-1 space-y-0.5">
            {goal.milestones.map((milestone) => (
              <li key={milestone.id} className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label={
                    milestone.done ? `取消完成里程碑「${milestone.title}」` : `完成里程碑「${milestone.title}」`
                  }
                  aria-pressed={milestone.done}
                  onClick={() => onToggleMilestone(milestone.id)}
                  className={cn(
                    "inline-flex size-3.5 shrink-0 items-center justify-center rounded border",
                    milestone.done
                      ? "border-transparent bg-success text-on-accent"
                      : "border-border-strong text-transparent hover:border-accent",
                  )}
                >
                  <Check className="size-2" strokeWidth={3} aria-hidden="true" />
                </button>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-micro",
                    milestone.done ? "text-ink-300 line-through" : "text-ink-700",
                  )}
                >
                  {milestone.title}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default GoalDetail;

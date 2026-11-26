import type { ReactElement } from "react";
import { Link2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import type { Goal, KeyResult, Okr, Task } from "@detter/shared";
import { Button, Menu, cn } from "@detter/ui";
import type { MenuItem } from "@detter/ui";
import { tallyTasks, tasksOfOkrId } from "@/features/review/metrics";
import type { AutoAdvanceConfig } from "./auto-advance";
import { KrRow } from "./KrRow";
import { objectiveProgress } from "./progress";

/**
 * Objective 卡片。
 *
 * 一张卡回答四件事：目标是什么、进度多少（= KR 均值）、每个 KR 走到哪、挂了哪些任务和目标。
 * KR 行负责拖拽与气泡，卡片只做汇总与菜单，避免「卡片自己算一套、复盘又算一套」。
 */
export interface OkrCardProps {
  okr: Okr;
  krs: readonly KeyResult[];
  goals: readonly Goal[];
  tasks: readonly Task[];
  autoMap: Record<string, AutoAdvanceConfig>;
  onAddKr: (okr: Okr) => void;
  onEditOkr: (okr: Okr) => void;
  onDeleteOkr: (okr: Okr) => void;
  onLinkOkr: (okr: Okr) => void;
  onEditKr: (okr: Okr, kr: KeyResult) => void;
  onLinkKr: (okr: Okr, kr: KeyResult) => void;
  onCommitKrValue: (kr: KeyResult, value: number) => void;
  onToggleAuto: (kr: KeyResult) => void;
  onDeleteKr: (okr: Okr, kr: KeyResult) => void;
}

export function OkrCard({
  okr,
  krs,
  goals,
  tasks,
  autoMap,
  onAddKr,
  onEditOkr,
  onDeleteOkr,
  onLinkOkr,
  onEditKr,
  onLinkKr,
  onCommitKrValue,
  onToggleAuto,
  onDeleteKr,
}: OkrCardProps) {
  const progress = objectiveProgress(krs, goals);
  const krIds = krs.map((kr) => kr.id);
  const okrTasks = tasksOfOkrId(tasks, okr.id, krIds);
  const taskTally = tallyTasks(okrTasks);
  const krSet = new Set(krIds);
  const linkedGoalCount = goals.filter(
    (goal) => goal.okrId === okr.id || (goal.krId !== null && krSet.has(goal.krId)),
  ).length;

  const menuItems: MenuItem[] = [
    {
      key: "edit",
      label: "编辑 Objective",
      icon: <Pencil className="size-3.5" aria-hidden="true" />,
      onSelect: () => onEditOkr(okr),
    },
    {
      key: "add-kr",
      label: "新建 KR",
      icon: <Plus className="size-3.5" aria-hidden="true" />,
      onSelect: () => onAddKr(okr),
    },
    {
      key: "link",
      label: "关联目标与任务",
      icon: <Link2 className="size-3.5" aria-hidden="true" />,
      onSelect: () => onLinkOkr(okr),
    },
    {
      key: "delete",
      label: "删除 Objective",
      icon: <Trash2 className="size-3.5" aria-hidden="true" />,
      danger: true,
      onSelect: () => onDeleteOkr(okr),
    },
  ];

  return (
    <article
      data-okr-id={okr.id}
      className="rounded-xl border border-border bg-surface p-4 shadow-1 transition-shadow duration-[var(--dur-2)] hover:shadow-2"
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-1.5 size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: okr.color }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="min-w-0 flex-1 text-h2 text-ink-900">{okr.title}</h2>
            <span
              className={cn(
                "tabular shrink-0 rounded-full px-2 py-0.5 text-micro",
                progress === null ? "bg-surface-sunken text-ink-300" : "bg-accent-soft text-accent",
              )}
            >
              {progress === null ? "还没有 KR" : `进度 ${progress.percent}%`}
            </span>
            <Menu
              align="end"
              label={`${okr.title} 的更多操作`}
              items={menuItems}
              trigger={
                (
                  <button
                    type="button"
                    aria-label={`${okr.title} 的更多操作`}
                    className="-mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-300 transition-colors duration-[var(--dur-1)] hover:bg-surface-sunken hover:text-ink-700"
                  >
                    <MoreHorizontal className="size-4" aria-hidden="true" />
                  </button>
                ) as ReactElement
              }
            />
          </div>
          {okr.description && (
            <p className="mt-0.5 line-clamp-2 text-caption text-ink-500">{okr.description}</p>
          )}
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
            <div
              className="h-full origin-left rounded-full transition-transform duration-[var(--dur-2)] ease-out"
              style={{
                transform: `scaleX(${(progress?.percent ?? 0) / 100})`,
                backgroundColor: okr.color,
              }}
            />
          </div>
        </div>
      </div>

      <div className="mt-2 border-t border-border pt-1">
        {krs.length === 0 ? (
          <p className="px-2 py-3 text-center text-micro text-ink-300">
            还没有 KR。先写一条可量化的关键结果，Objective 才有进度。
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
            {krs.map((kr) => (
              <KrRow
                key={kr.id}
                kr={kr}
                color={okr.color}
                goals={goals}
                tasks={tasks}
                auto={autoMap[kr.id]}
                onCommitValue={(value) => onCommitKrValue(kr, value)}
                onEdit={() => onEditKr(okr, kr)}
                onLink={() => onLinkKr(okr, kr)}
                onToggleAuto={() => onToggleAuto(kr)}
                onDelete={() => onDeleteKr(okr, kr)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
        <p className="min-w-0 flex-1 text-micro text-ink-300">
          关联任务 {taskTally.done}/{taskTally.total} 项 · 关联目标 {linkedGoalCount} 个
        </p>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={<Plus className="size-3.5" aria-hidden="true" />}
          onClick={() => onAddKr(okr)}
        >
          KR
        </Button>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<Link2 className="size-3.5" aria-hidden="true" />}
          onClick={() => onLinkOkr(okr)}
        >
          关联
        </Button>
      </div>
    </article>
  );
}

export default OkrCard;

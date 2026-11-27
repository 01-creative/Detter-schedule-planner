import { useCallback, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Layers, Plus } from "lucide-react";
import type { Goal, GoalKind, Quadrant, Task } from "@detter/shared";
import { QUADRANT_META } from "@detter/shared";
import { Button, Tabs, cn, useToast } from "@detter/ui";
import { useQuadrantDrag } from "@/features/quadrant/DragProvider";
import { setTaskDone } from "@/features/quadrant/task-actions";
import { useBoardGoals, useBoardTasks } from "@/features/quadrant/queries";
import { TemplateDialog } from "./TemplateDialog";
import { GoalCard } from "./GoalCard";
import { expandTemplate, saveGoalOrder, toggleGoalMilestone } from "./goal-actions";
import { useGoalDialogStore } from "./goal-dialog";
import {
  goalsOfKind,
  groupTasksByGoal,
  reorderGoals,
  summarizeGoalTasks,
} from "./rules";

/**
 * 右侧目标栏（320px，桌面常驻；平板/手机由 GoalRailShell 装进抽屉）。
 *
 * 数据全部来自 Dexie 的实时查询：任务完成 → 进度环立刻动；
 * 拖一个目标到象限 → 这一栏的马上升级成「1 项」。
 */
export interface GoalRailProps {
  onCollapse?: () => void;
  embedded?: boolean;
  className?: string;
}

const TAB_ITEMS = [
  { value: "once", label: "一次性" },
  { value: "recurring", label: "周期" },
  { value: "template", label: "模板" },
] as const;

const EMPTY_HINT: Record<GoalKind, string> = {
  once: "还没有一次性目标。写下一个有截止日的结果。",
  recurring: "还没有周期目标。把想长期坚持的事放进来。",
  template: "还没有模板。把重复发生的一套流程存成模板。",
};

export function GoalRail({ onCollapse, embedded = false, className }: GoalRailProps) {
  const goals = useBoardGoals();
  const { data: tasks } = useBoardTasks();
  const { startGoalDrag, isClickSuppressed } = useQuadrantDrag();
  const { toast } = useToast();
  const openDialog = useGoalDialogStore((state) => state.openDialog);

  const [tab, setTab] = useState<GoalKind>("once");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reorderId, setReorderId] = useState<string | null>(null);
  const [templateGoal, setTemplateGoal] = useState<Goal | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const tasksByGoal = useMemo(() => groupTasksByGoal(tasks), [tasks]);
  const unlinkedCount = useMemo(() => tasks.filter((task) => !task.goalId).length, [tasks]);
  const visible = useMemo(() => goalsOfKind(goals, tab), [goals, tab]);
  const tabCounts = useMemo(
    () => ({
      once: goals.filter((goal) => goal.kind === "once").length,
      recurring: goals.filter((goal) => goal.kind === "recurring").length,
      template: goals.filter((goal) => goal.kind === "template").length,
    }),
    [goals],
  );

  const toggleExpand = useCallback(
    (goal: Goal) => {
      if (isClickSuppressed()) return;
      setExpandedId((current) => (current === goal.id ? null : goal.id));
    },
    [isClickSuppressed],
  );

  /* 上下拖动重排：只量一次卡片中线，松手时提交一次 sortIndex 序列 */
  const startReorder = useCallback(
    (goal: Goal, event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const list = goalsOfKind(goals, tab);
      const from = list.findIndex((item) => item.id === goal.id);
      if (from < 0) return;
      setReorderId(goal.id);

      const cleanup = () => {
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        setReorderId(null);
      };
      const onCancel = () => cleanup();
      const onUp = (upEvent: PointerEvent) => {
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        setReorderId(null);

        const cards = Array.from(
          listRef.current?.querySelectorAll<HTMLElement>("[data-goal-id]") ?? [],
        );
        let insertion = cards.length;
        for (let index = 0; index < cards.length; index += 1) {
          const node = cards[index];
          if (!node) continue;
          const rect = node.getBoundingClientRect();
          if (upEvent.clientY < rect.top + rect.height / 2) {
            insertion = index;
            break;
          }
        }
        const to = Math.max(0, Math.min(list.length - 1, insertion > from ? insertion - 1 : insertion));
        if (to === from) return;
        void saveGoalOrder(reorderGoals(list, from, to));
      };

      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [goals, tab],
  );

  const reorderByKey = useCallback(
    (goal: Goal, delta: -1 | 1) => {
      const list = goalsOfKind(goals, tab);
      const from = list.findIndex((item) => item.id === goal.id);
      if (from < 0) return;
      const to = Math.max(0, Math.min(list.length - 1, from + delta));
      if (to === from) return;
      void saveGoalOrder(reorderGoals(list, from, to));
    },
    [goals, tab],
  );

  const handleTemplateConfirm = useCallback(
    async (goal: Goal, titles: string[], quadrant: Quadrant) => {
      const created = await expandTemplate(goal, titles, quadrant);
      setTemplateGoal(null);
      toast({
        title: `已铺开 ${created.length} 条任务`,
        description: `放进 Q${quadrant} · ${QUADRANT_META[quadrant].name}`,
        tone: "success",
      });
    },
    [toast],
  );

  const handleToggleTask = useCallback((task: Task) => {
    void setTaskDone(task, task.status !== "done");
  }, []);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        embedded
          ? "gap-2"
          : "h-full rounded-xl border border-border bg-surface p-3 shadow-1",
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-2">
        <h2 className="text-h2 text-ink-900">目标</h2>
        <span className="tabular rounded-full bg-surface-sunken px-1.5 text-micro text-ink-500">
          {goals.length}
        </span>
        <p className="ml-1 hidden min-w-0 flex-1 truncate text-micro text-ink-300 xl:block">
          拖到象限即建任务
        </p>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="收起目标栏"
            className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-ink-300 transition-colors duration-[var(--dur-1)] hover:bg-surface-sunken hover:text-ink-700"
          >
            <Layers className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      <Tabs
        ariaLabel="目标分类"
        className="shrink-0"
        value={tab}
        onValueChange={(value) => setTab(value as GoalKind)}
        items={TAB_ITEMS.map((item) => ({
          value: item.value,
          label: item.label,
          count: tabCounts[item.value],
        }))}
      />

      <div
        className={cn(
          "mt-1 min-h-0 pr-0.5",
          embedded ? "max-h-[54dvh] flex-none overflow-y-auto" : "flex-1 overflow-y-auto",
        )}
      >
        <ul ref={listRef} className="space-y-1.5">
          {visible.map((goal) => {
            const goalTasks = tasksByGoal.get(goal.id) ?? [];
            return (
              <GoalCard
                key={goal.id}
                goal={goal}
                tasks={goalTasks}
                stats={summarizeGoalTasks(goalTasks)}
                expanded={expandedId === goal.id}
                reordering={reorderId === goal.id}
                showExpand
                onToggleExpand={toggleExpand}
                onStartDrag={(item, event) => startGoalDrag(item, event)}
                onStartReorder={startReorder}
                onReorderKey={reorderByKey}
                onExpandTemplate={(item) => setTemplateGoal(item)}
                onToggleTask={handleToggleTask}
                onToggleMilestone={(item, milestoneId) => {
                  void toggleGoalMilestone(item, milestoneId);
                }}
              />
            );
          })}
        </ul>

        {visible.length === 0 && (
          <div className="mt-1 rounded-lg border border-dashed border-border-strong px-3 py-5 text-center">
            <p className="text-micro text-ink-500">{EMPTY_HINT[tab]}</p>
          </div>
        )}

        {/*
         * 「未关联」这一桶是为了让平面上的点能对上账：
         * 上面每张卡只显示挂了目标的点，剩下的灰点如果没有任何地方交代，
         * 用户就会觉得「我明明有一屏任务，右边怎么什么都没有」。
         */}
        {unlinkedCount > 0 && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-border-strong px-2.5 py-1.5">
            <span className="size-1.5 shrink-0 rounded-full bg-ink-300" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-caption text-ink-500">未关联目标</span>
            <span className="tabular shrink-0 text-micro text-ink-300">{unlinkedCount} 项</span>
          </div>
        )}
        {unlinkedCount > 0 && (
          <p className="mt-1 px-1 text-micro text-ink-300">
            这些点还没挂目标：在任务详情里选一个，或把目标拖到平面上。
          </p>
        )}
      </div>

      <div className="mt-2 shrink-0 border-t border-border pt-2">
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          leftIcon={<Plus className="size-3.5" aria-hidden="true" />}
          onClick={() => openDialog()}
        >
          新建目标
        </Button>
      </div>

      <TemplateDialog
        goal={templateGoal}
        onClose={() => setTemplateGoal(null)}
        onConfirm={handleTemplateConfirm}
      />
    </div>
  );
}

export default GoalRail;

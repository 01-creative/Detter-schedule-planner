import { useEffect, useMemo, useRef, useState } from "react";
import { Link2, Search } from "lucide-react";
import { QUADRANT_META } from "@detter/shared";
import type { Goal, KeyResult, Okr, Task } from "@detter/shared";
import { Badge, Button, Dialog, Input, Tabs, useToast } from "@detter/ui";
import {
  attachGoal,
  attachTask,
  detachGoal,
  detachTask,
  setKrLinkedGoalIds,
  setKrLinkedTaskIds,
} from "./okr-actions";

/**
 * 关联选择器。
 *
 * 在 Objective 层关联：只写 goal.okrId / task.okrId（不指定 KR）；
 * 在 KR 层关联：同时写 krId，并把 id 记进 KR 的 linkedGoalIds / linkedTaskIds。
 * 后者是冗余字段，但同步给其他端时不必反查任务表就能画进度，值得。
 *
 * 取消勾选会摘掉对象身上的 okrId/krId：双向可见，不能只删一边。
 */
export interface LinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  okr: Okr | null;
  /** null = 在 Objective 层关联 */
  kr: KeyResult | null;
  goals: readonly Goal[];
  tasks: readonly Task[];
}

type LinkTab = "goal" | "task";

function initialGoalIds(okr: Okr, kr: KeyResult | null, goals: readonly Goal[]): Set<string> {
  const ids = new Set<string>();
  for (const goal of goals) {
    if (kr) {
      if (goal.okrId === okr.id && goal.krId === kr.id) ids.add(goal.id);
      if (kr.linkedGoalIds.includes(goal.id)) ids.add(goal.id);
    } else if (goal.okrId === okr.id) {
      ids.add(goal.id);
    }
  }
  return ids;
}

function initialTaskIds(okr: Okr, kr: KeyResult | null, tasks: readonly Task[]): Set<string> {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (kr) {
      if (task.okrId === okr.id && task.krId === kr.id) ids.add(task.id);
      if (kr.linkedTaskIds.includes(task.id)) ids.add(task.id);
    } else if (task.okrId === okr.id) {
      ids.add(task.id);
    }
  }
  return ids;
}

export function LinkDialog({ open, onOpenChange, okr, kr, goals, tasks }: LinkDialogProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<LinkTab>("goal");
  const [query, setQuery] = useState("");
  const [goalIds, setGoalIds] = useState<Set<string>>(new Set());
  const [taskIds, setTaskIds] = useState<Set<string>>(new Set());
  const [initial, setInitial] = useState<{ goals: Set<string>; tasks: Set<string> }>({
    goals: new Set(),
    tasks: new Set(),
  });
  const [saving, setSaving] = useState(false);

  // 只在「打开」时初始化勾选：实时查询在对话框打开期间更新（例如自动推进写库）
  // 不应该把用户已经改了一半的勾选重置掉。
  const latest = useRef({ okr, kr, goals, tasks });
  useEffect(() => {
    latest.current = { okr, kr, goals, tasks };
  }, [okr, kr, goals, tasks]);

  useEffect(() => {
    const current = latest.current;
    if (!open || !current.okr) return;
    const nextGoals = initialGoalIds(current.okr, current.kr, current.goals);
    const nextTasks = initialTaskIds(current.okr, current.kr, current.tasks);
    setGoalIds(nextGoals);
    setTaskIds(nextTasks);
    setInitial({ goals: new Set(nextGoals), tasks: new Set(nextTasks) });
    setTab("goal");
    setQuery("");
    setSaving(false);
  }, [open]);

  const filteredGoals = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const list = [...goals].sort((a, b) => Number(b.okrId === okr?.id) - Number(a.okrId === okr?.id));
    return keyword
      ? list.filter((goal) => goal.title.toLowerCase().includes(keyword))
      : list;
  }, [goals, query, okr?.id]);

  const filteredTasks = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const list = [...tasks].sort((a, b) => b.updatedAt - a.updatedAt);
    return keyword
      ? list.filter(
          (task) =>
            task.title.toLowerCase().includes(keyword) ||
            task.tags.some((tag) => tag.toLowerCase().includes(keyword)),
        )
      : list;
  }, [tasks, query]);

  const toggle = (setter: typeof setGoalIds, id: string) => {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    if (!okr || saving) return;
    setSaving(true);
    try {
      // 目标
      for (const goal of goals) {
        const was = initial.goals.has(goal.id);
        const now = goalIds.has(goal.id);
        if (now && !was) await attachGoal(goal, okr.id, kr?.id ?? null);
        else if (!now && was) await detachGoal(goal);
      }
      // 任务
      for (const task of tasks) {
        const was = initial.tasks.has(task.id);
        const now = taskIds.has(task.id);
        if (now && !was) await attachTask(task, okr.id, kr?.id ?? null);
        else if (!now && was) await detachTask(task);
      }
      // KR 上的冗余索引
      if (kr) {
        await setKrLinkedGoalIds(kr, [...goalIds]);
        await setKrLinkedTaskIds(kr, [...taskIds]);
      }
      toast({
        title: "关联已更新",
        description: `${kr ? kr.title : okr.title} · 目标 ${goalIds.size} 个 · 任务 ${taskIds.size} 项`,
        tone: "success",
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "关联失败",
        description: error instanceof Error ? error.message : "稍后再试",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={kr ? "关联到 KR" : "关联到 Objective"}
      description={
        okr
          ? `${okr.title}${kr ? ` · ${kr.title}` : ""} · 取消勾选会同时摘掉对象上的 OKR 标签`
          : "先选一个 Objective"
      }
      size="lg"
      footer={
        <>
          <p className="mr-auto text-micro text-ink-300">
            已选 目标 {goalIds.size} 个 · 任务 {taskIds.size} 项
          </p>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" loading={saving} disabled={!okr} onClick={() => void save()}>
            保存关联
          </Button>
        </>
      }
    >
      <div className="space-y-2.5">
        <Tabs
          items={[
            { value: "goal", label: "目标", count: goalIds.size },
            { value: "task", label: "任务", count: taskIds.size },
          ]}
          value={tab}
          onValueChange={(value) => setTab(value as LinkTab)}
          ariaLabel="关联对象类型"
          variant="pill"
        />

        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-300"
            aria-hidden="true"
          />
          <Input
            value={query}
            aria-label="搜索可关联的目标或任务"
            placeholder={tab === "goal" ? "搜索目标…" : "搜索任务标题或标签…"}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-8"
          />
        </div>

        <div className="max-h-[46dvh] overflow-y-auto rounded-lg border border-border">
          {tab === "goal" ? (
            filteredGoals.length === 0 ? (
              <p className="px-3 py-6 text-center text-caption text-ink-300">
                {goals.length === 0 ? "还没有目标，先去目标栏建一个。" : "没有匹配的目标。"}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {filteredGoals.map((goal) => {
                  const checked = goalIds.has(goal.id);
                  return (
                    <li key={goal.id}>
                      <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-surface-sunken/60">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(setGoalIds, goal.id)}
                          className="size-4 shrink-0 accent-[var(--accent)]"
                        />
                        <span
                          aria-hidden="true"
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: goal.color }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-caption text-ink-900">{goal.title}</span>
                          <span className="block text-micro text-ink-300">
                            {goal.milestones.length > 0
                              ? `${goal.milestones.filter((milestone) => milestone.done).length}/${goal.milestones.length} 里程碑`
                              : goal.kind === "recurring"
                                ? "周期目标"
                                : "一次性目标"}
                          </span>
                        </span>
                        {goal.okrId && goal.okrId !== okr?.id && (
                          <Badge tone="neutral">已关联其他 OKR</Badge>
                        )}
                        {checked && <Badge tone="accent">已选</Badge>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )
          ) : filteredTasks.length === 0 ? (
            <p className="px-3 py-6 text-center text-caption text-ink-300">
              {tasks.length === 0 ? "还没有任务，先去四象限记一条。" : "没有匹配的任务。"}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {filteredTasks.map((task) => {
                const checked = taskIds.has(task.id);
                return (
                  <li key={task.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-surface-sunken/60">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(setTaskIds, task.id)}
                        className="size-4 shrink-0 accent-[var(--accent)]"
                      />
                      <span
                        aria-label={`Q${task.quadrant}`}
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: `var(--q${task.quadrant}-accent)` }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-caption text-ink-900">{task.title}</span>
                        <span className="block text-micro text-ink-300">
                          Q{task.quadrant} {QUADRANT_META[task.quadrant].name}
                          {task.status === "done" ? " · 已完成" : ""}
                          {task.kind === "event" ? " · 日程" : ""}
                        </span>
                      </span>
                      {checked && <Badge tone="accent">已选</Badge>}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="flex items-center gap-1.5 text-micro text-ink-300">
          <Link2 className="size-3.5" aria-hidden="true" />
          挂上后任务与目标会带上 OKR 标记，复盘里的「关联任务」也按这个数。
        </p>
      </div>
    </Dialog>
  );
}

export default LinkDialog;

import { shortId, uuidv7 } from "@detter/shared";
import type { Goal, GoalInput, GoalKind, Quadrant, Task } from "@detter/shared";
import { getEntity, deleteEntity, saveEntity } from "@/db/repo";
import { db } from "@/db";
import {
  buildGoalTaskInput,
  buildTemplateTaskInputs,
  type GoalDrop,
} from "./rules";

/**
 * 目标栏的写操作。
 *
 * 与任务一样，全部走 `@/db/repo`：它会补齐 schema 默认值并在同一个事务里写 outbox。
 * 这里额外处理「使用次数」这类聚合字段 —— 必须基于库里最新的那条目标，
 * 否则用旧快照回写会把别的设备刚改的标题覆盖掉。
 */

function toRow(value: object): Record<string, unknown> {
  return { ...value } as unknown as Record<string, unknown>;
}

async function writeGoal(goal: Goal | GoalInput): Promise<Goal> {
  const row = await saveEntity("goal", toRow(goal));
  return row as unknown as Goal;
}

export interface CreateGoalPayload {
  title: string;
  description?: string;
  kind: GoalKind;
  color: string;
  icon: string;
  rrule?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  /** 里程碑标题，每行一条；模板会按它们铺开任务 */
  milestoneTitles?: string[];
  okrId?: string | null;
  krId?: string | null;
  sortIndex?: number;
}

export function buildGoalInput(payload: CreateGoalPayload, now: number = Date.now()): GoalInput {
  return {
    id: uuidv7(now),
    title: payload.title,
    description: payload.description ?? "",
    kind: payload.kind,
    status: "active",
    color: payload.color,
    icon: payload.icon,
    rrule: payload.rrule ?? null,
    startDate: payload.startDate ?? null,
    endDate: payload.endDate ?? null,
    milestones: (payload.milestoneTitles ?? []).map((title) => ({
      id: shortId(8),
      title,
      done: false,
    })),
    okrId: payload.okrId ?? null,
    krId: payload.krId ?? null,
    usageCount: 0,
    lastUsedAt: null,
    sortIndex: payload.sortIndex ?? 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function createGoal(payload: CreateGoalPayload): Promise<Goal> {
  return writeGoal(buildGoalInput(payload));
}

export function patchGoal(goal: Goal, patch: Partial<Goal>): Promise<Goal> {
  return writeGoal({ ...goal, ...patch });
}

/** 目标被「用掉一次」：拖到象限、铺开模板都算。 */
export async function bumpGoalUsage(goalId: string): Promise<void> {
  const row = await getEntity("goal", goalId);
  if (!row) return;
  const goal = row as unknown as Goal;
  await writeGoal({ ...goal, usageCount: goal.usageCount + 1, lastUsedAt: Date.now() });
}

/** 目标 → 一条任务（拖到象限）。 */
export async function createTaskFromGoal(goal: Goal, drop: GoalDrop): Promise<Task> {
  const row = await saveEntity("task", toRow(buildGoalTaskInput(goal, drop)));
  await bumpGoalUsage(goal.id);
  return row as unknown as Task;
}

/** 模板 → 多条任务（「铺开」）。 */
export async function expandTemplate(
  goal: Goal,
  titles: readonly string[],
  quadrant: Quadrant,
): Promise<Task[]> {
  const inputs = buildTemplateTaskInputs(goal, titles, quadrant);
  const created: Task[] = [];
  for (const input of inputs) {
    const row = await saveEntity("task", toRow(input));
    created.push(row as unknown as Task);
  }
  await bumpGoalUsage(goal.id);
  return created;
}

/** 重排落库：sortIndex 直接写成新下标，简单、可读、够用（目标数量很少）。 */
export async function saveGoalOrder(ordered: readonly Goal[]): Promise<void> {
  for (let index = 0; index < ordered.length; index += 1) {
    const goal = ordered[index];
    if (!goal || goal.sortIndex === index) continue;
    await writeGoal({ ...goal, sortIndex: index });
  }
}

export function toggleGoalMilestone(goal: Goal, milestoneId: string): Promise<Goal> {
  return patchGoal(goal, {
    milestones: goal.milestones.map((milestone) =>
      milestone.id === milestoneId ? { ...milestone, done: !milestone.done } : milestone,
    ),
  });
}

/**
 * 删除目标。
 *
 * 语义选择：**只删目标，不删它下面的任务**。
 * 任务往往已经排进日历、绑了提醒，因为目标作废就把它们一起清掉太危险；
 * 保留任务但解除关联（goalId 置空），它们会回到「未关联目标」那一桶，随时能再挂到别处。
 */
export async function deleteGoalKeepTasks(goal: Goal): Promise<number> {
  const tasks = await db.tasks.where("goalId").equals(goal.id).toArray();
  const alive = tasks.filter((task) => !task.deletedAt);
  for (const task of alive) {
    await saveEntity("task", { ...task, goalId: null });
  }
  await deleteEntity("goal", goal.id);
  return alive.length;
}

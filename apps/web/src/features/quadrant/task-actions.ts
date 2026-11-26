import { uuidv7 } from "@detter/shared";
import type { Quadrant, Task, TaskInput, TaskSource } from "@detter/shared";
import { deleteEntity, saveEntity } from "@/db/repo";

/**
 * 四象限里所有任务写操作的唯一入口。
 *
 * 铁律：组件里不出现 `db.tasks.put(...)`。这里统一走 `@/db/repo`，
 * 由它补齐 schema 默认值、维护 updatedAt/rev，并在同一个事务里追加 outbox。
 */

function toRow(task: Task | TaskInput): Record<string, unknown> {
  return { ...task } as unknown as Record<string, unknown>;
}

async function writeTask(task: Task | TaskInput): Promise<Task> {
  const row = await saveEntity("task", toRow(task));
  return row as unknown as Task;
}

/** 新建任务至少要自己带 id 与时间戳：离线时没人能替我们发号。 */
export interface NewTaskInput {
  title: string;
  quadrant: Quadrant;
  posX?: number;
  posY?: number;
  goalId?: string | null;
  source?: TaskSource;
  notes?: string;
  dueAt?: number | null;
  startAt?: number | null;
  tags?: string[];
  sortIndex?: number;
}

export function buildTaskInput(input: NewTaskInput, now: number = Date.now()): TaskInput {
  return {
    id: uuidv7(now),
    title: input.title,
    notes: input.notes ?? "",
    status: "todo",
    quadrant: input.quadrant,
    manualQuadrant: true,
    posX: input.posX ?? 0.5,
    posY: input.posY ?? 0.2,
    goalId: input.goalId ?? null,
    source: input.source ?? "manual",
    startAt: input.startAt ?? null,
    dueAt: input.dueAt ?? null,
    tags: input.tags ?? [],
    sortIndex: input.sortIndex ?? 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function createTask(input: NewTaskInput): Promise<Task> {
  return writeTask(buildTaskInput(input));
}

export function patchTask(task: Task, patch: Partial<Task>): Promise<Task> {
  return writeTask({ ...task, ...patch });
}

export function setTaskDone(task: Task, done: boolean): Promise<Task> {
  return patchTask(task, {
    status: done ? "done" : "todo",
    completedAt: done ? Date.now() : null,
  });
}

export function toggleTaskDone(task: Task): Promise<Task> {
  return setTaskDone(task, !(task.status === "done"));
}

export function moveTask(
  task: Task,
  quadrant: Quadrant,
  patch: Partial<Task> = {},
): Promise<Task> {
  return patchTask(task, { ...patch, quadrant, manualQuadrant: true });
}

export function setTaskPosition(task: Task, posX: number, posY: number): Promise<Task> {
  return patchTask(task, {
    posX: Math.min(1, Math.max(0, posX)),
    posY: Math.min(1, Math.max(0, posY)),
  });
}

export function setTaskGoal(task: Task, goalId: string | null): Promise<Task> {
  return patchTask(task, { goalId });
}

/** 软删除：仓储写墓碑，UI 立刻移除；撤销时用同一份快照按原 id 写回。 */
export function removeTask(task: Task): Promise<boolean> {
  return deleteEntity("task", task.id);
}

export function restoreTask(task: Task): Promise<Task> {
  return writeTask({ ...task, deletedAt: null });
}

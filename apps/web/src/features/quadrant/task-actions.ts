import { uuidv7 } from "@detter/shared";
import type { Quadrant, Task, TaskInput, TaskSource } from "@detter/shared";
import { deleteEntity, saveEntity } from "@/db/repo";
import {
  DEFAULT_PLANE_POSITION,
  quadrantFromPosition,
  relocateToQuadrant,
  resolveTaskPoint,
} from "./geometry";

/**
 * 四象限里所有任务写操作的唯一入口。
 *
 * 铁律：组件里不出现 `db.tasks.put(...)`。这里统一走 `@/db/repo`，
 * 由它补齐 schema 默认值、维护 updatedAt/rev，并在同一个事务里追加 outbox。
 *
 * 坐标语义：posX/posY 是全平面坐标（x = 紧急度，y = 纵向屏幕位置）。
 * `quadrant` 仍然写库，但**保存时由坐标推导**——任何写入坐标的路径都经过 patchTask，
 * 因此不会出现「坐标在 Q1、quadrant 还写着 Q2」的漂移。
 */

function toRow(task: Task | TaskInput): Record<string, unknown> {
  return { ...task } as unknown as Record<string, unknown>;
}

async function writeTask(task: Task | TaskInput): Promise<Task> {
  const row = await saveEntity("task", toRow(task));
  return row as unknown as Task;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

/** 新建任务至少要自己带 id 与时间戳：离线时没人能替我们发号。 */
export interface NewTaskInput {
  title: string;
  /** 全平面坐标；不传则落在 Q2 近中心处 */
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
  const posX = clamp01(input.posX ?? DEFAULT_PLANE_POSITION.x);
  const posY = clamp01(input.posY ?? DEFAULT_PLANE_POSITION.y);
  return {
    id: uuidv7(now),
    title: input.title,
    notes: input.notes ?? "",
    status: "todo",
    // 象限不是用户输入，而是坐标的函数
    quadrant: quadrantFromPosition(posX, posY),
    manualQuadrant: true,
    posX,
    posY,
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

/**
 * 所有 patch 的统一出口：只要动了任一坐标，就顺手把 quadrant 推导成新值。
 * 这样详情面板改象限、拖拽落点、精确坐标三个入口共用同一条不变量。
 */
export function patchTask(task: Task, patch: Partial<Task>): Promise<Task> {
  const next = { ...task, ...patch };
  if (patch.posX !== undefined || patch.posY !== undefined) {
    next.posX = clamp01(next.posX);
    next.posY = clamp01(next.posY);
    next.quadrant = quadrantFromPosition(next.posX, next.posY);
  }
  return writeTask(next);
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

/** 把任务放进指定象限，保留它在原象限里的相对位置。 */
export function moveTask(
  task: Task,
  quadrant: Quadrant,
  patch: Partial<Task> = {},
): Promise<Task> {
  if (patch.posX !== undefined || patch.posY !== undefined) {
    return patchTask(task, { ...patch, manualQuadrant: true });
  }
  const point = resolveTaskPoint(task);
  const next = relocateToQuadrant(point.x, point.y, quadrant);
  return patchTask(task, { ...patch, posX: next.x, posY: next.y, manualQuadrant: true });
}

/** 拖拽落点：坐标即事实，象限由 patchTask 推导。 */
export function placeTask(task: Task, posX: number, posY: number): Promise<Task> {
  return patchTask(task, {
    posX: clamp01(posX),
    posY: clamp01(posY),
    manualQuadrant: true,
  });
}

export function setTaskPosition(task: Task, posX: number, posY: number): Promise<Task> {
  return placeTask(task, posX, posY);
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

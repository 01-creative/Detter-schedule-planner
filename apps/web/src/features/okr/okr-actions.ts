import { uuidv7 } from "@detter/shared";
import type {
  Goal,
  KeyResult,
  KeyResultInput,
  KrMetricType,
  Okr,
  OkrInput,
  Task,
} from "@detter/shared";
import { deleteEntity, saveEntity } from "@/db/repo";
import type { OkrRange } from "./periods";

/**
 * OKR 写操作唯一入口。
 *
 * 与任务、目标一样全部走 `@/db/repo`：它补齐 schema 默认值、维护
 * updatedAt/rev，并在同一事务里追加 outbox。
 * 复杂动作（删除 Objective / 跨周期复制）也在这一层串起来，
 * 组件里只调一个函数，不出现 N 次 await saveEntity 的胶水代码。
 */

function toRow(value: object): Record<string, unknown> {
  return { ...value } as unknown as Record<string, unknown>;
}

export interface DraftKeyResult {
  title: string;
  metricType: KrMetricType;
  startValue: number;
  targetValue: number;
  currentValue: number;
  unit: string;
}

export interface NewOkrInput {
  title: string;
  description?: string;
  range: OkrRange;
  color: string;
  sortIndex: number;
}

function safeNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

export function buildOkrInput(input: NewOkrInput, now: number = Date.now()): OkrInput {
  return {
    id: uuidv7(now),
    title: input.title.trim(),
    description: input.description?.trim() ?? "",
    period: input.range.type,
    periodStart: input.range.startKey,
    periodEnd: input.range.endKey,
    status: "active",
    color: input.color,
    sortIndex: input.sortIndex,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildKeyResultInput(
  okrId: string,
  draft: DraftKeyResult,
  sortIndex: number,
  now: number = Date.now(),
): KeyResultInput {
  return {
    id: uuidv7(now + sortIndex),
    okrId,
    title: draft.title.trim(),
    metricType: draft.metricType,
    startValue: safeNumber(draft.startValue),
    targetValue: safeNumber(draft.targetValue),
    currentValue: safeNumber(draft.currentValue),
    unit: draft.unit.trim(),
    linkedGoalIds: [],
    linkedTaskIds: [],
    sortIndex,
    createdAt: now + sortIndex,
    updatedAt: now + sortIndex,
  };
}

/** 新建 Objective 时可一并带上 KR（对话框里直接填几条）。 */
export async function createOkr(
  input: NewOkrInput,
  drafts: readonly DraftKeyResult[],
): Promise<{ okr: Okr; krs: KeyResult[] }> {
  const now = Date.now();
  const okrInput = buildOkrInput(input, now);
  const okrRow = (await saveEntity("okr", toRow(okrInput))) as unknown as Okr;

  const krs: KeyResult[] = [];
  let index = 0;
  for (const draft of drafts) {
    if (!draft.title.trim()) continue;
    const row = await saveEntity(
      "kr",
      toRow(buildKeyResultInput(okrRow.id, draft, index, now + index)),
    );
    krs.push(row as unknown as KeyResult);
    index += 1;
  }
  return { okr: okrRow, krs };
}

export function patchOkr(okr: Okr, patch: Partial<Okr>): Promise<Okr> {
  return saveEntity("okr", toRow({ ...okr, ...patch })) as unknown as Promise<Okr>;
}

export function patchKeyResult(kr: KeyResult, patch: Partial<KeyResult>): Promise<KeyResult> {
  return saveEntity("kr", toRow({ ...kr, ...patch })) as unknown as Promise<KeyResult>;
}

/** 拖动 / 键盘更新 KR 当前值。只写 currentValue，其余字段原样带回。 */
export function updateKeyResultValue(kr: KeyResult, value: number): Promise<KeyResult> {
  return patchKeyResult(kr, { currentValue: safeNumber(value) });
}

export function createKeyResult(
  okrId: string,
  draft: DraftKeyResult,
  sortIndex: number,
): Promise<KeyResult> {
  return saveEntity(
    "kr",
    toRow(buildKeyResultInput(okrId, draft, sortIndex)),
  ) as unknown as Promise<KeyResult>;
}

async function clearTaskLinks(tasks: readonly Task[], predicate: (task: Task) => boolean): Promise<void> {
  for (const task of tasks) {
    if (!predicate(task)) continue;
    await saveEntity("task", toRow({ ...task, okrId: null, krId: null }));
  }
}

async function clearGoalLinks(goals: readonly Goal[], predicate: (goal: Goal) => boolean): Promise<void> {
  for (const goal of goals) {
    if (!predicate(goal)) continue;
    await saveEntity("goal", toRow({ ...goal, okrId: null, krId: null }));
  }
}

/** 删除 Objective：先摘掉任务/目标的反向指针，再软删 KR 与自身。 */
export async function deleteOkr(
  okr: Okr,
  krs: readonly KeyResult[],
  tasks: readonly Task[],
  goals: readonly Goal[],
): Promise<void> {
  const krIds = new Set(krs.filter((kr) => kr.okrId === okr.id).map((kr) => kr.id));
  await clearTaskLinks(tasks, (task) => task.okrId === okr.id || (task.krId !== null && krIds.has(task.krId)));
  await clearGoalLinks(goals, (goal) => goal.okrId === okr.id || (goal.krId !== null && krIds.has(goal.krId)));
  for (const krId of krIds) {
    await deleteEntity("kr", krId);
  }
  await deleteEntity("okr", okr.id);
}

/** 删除单条 KR：同理，先把任务 / 目标从它身上摘下来。 */
export async function deleteKeyResult(
  kr: KeyResult,
  tasks: readonly Task[],
  goals: readonly Goal[],
): Promise<void> {
  const explicitTaskIds = new Set(kr.linkedTaskIds);
  await clearTaskLinks(
    tasks,
    (task) => task.krId === kr.id || explicitTaskIds.has(task.id),
  );
  const explicitGoalIds = new Set(kr.linkedGoalIds);
  await clearGoalLinks(
    goals,
    (goal) => goal.krId === kr.id || explicitGoalIds.has(goal.id),
  );
  await deleteEntity("kr", kr.id);
}

/* -------------------------------------------------------------------------- */
/*                                  关联                                       */
/* -------------------------------------------------------------------------- */

export function attachGoal(goal: Goal, okrId: string, krId: string | null): Promise<Goal> {
  return saveEntity("goal", toRow({ ...goal, okrId, krId })) as unknown as Promise<Goal>;
}

export function detachGoal(goal: Goal): Promise<Goal> {
  return saveEntity("goal", toRow({ ...goal, okrId: null, krId: null })) as unknown as Promise<Goal>;
}

export function attachTask(task: Task, okrId: string, krId: string | null): Promise<Task> {
  return saveEntity("task", toRow({ ...task, okrId, krId })) as unknown as Promise<Task>;
}

export function detachTask(task: Task): Promise<Task> {
  return saveEntity("task", toRow({ ...task, okrId: null, krId: null })) as unknown as Promise<Task>;
}

export function setKrLinkedGoalIds(kr: KeyResult, ids: readonly string[]): Promise<KeyResult> {
  return patchKeyResult(kr, { linkedGoalIds: [...new Set(ids)] });
}

export function setKrLinkedTaskIds(kr: KeyResult, ids: readonly string[]): Promise<KeyResult> {
  return patchKeyResult(kr, { linkedTaskIds: [...new Set(ids)] });
}

/* -------------------------------------------------------------------------- */
/*                                跨周期复制                                    */
/* -------------------------------------------------------------------------- */

function resetCurrentValue(kr: KeyResult): number {
  if (kr.metricType === "percent" || kr.metricType === "number") return kr.startValue;
  return 0;
}

export interface CopyResult {
  okrs: Okr[];
  krs: KeyResult[];
}

/**
 * 把某一期的 Objective 复制到目标周期。
 *
 * 只复制「结构」：标题、描述、颜色、KR 的度量方式与目标值。
 * currentValue 一律归零/reset —— 新周期从起点开始，不继承上期完成度；
 * 关联的任务与目标也不复制，避免同一件事同时挂在两期上。
 */
export async function copyOkrsToRange(
  sourceOkrs: readonly Okr[],
  sourceKrs: readonly KeyResult[],
  targetRange: OkrRange,
  now: number = Date.now(),
): Promise<CopyResult> {
  const createdOkrs: Okr[] = [];
  const createdKrs: KeyResult[] = [];
  let index = 0;

  for (const source of sourceOkrs) {
    const okrInput = buildOkrInput(
      {
        title: source.title,
        description: source.description,
        range: targetRange,
        color: source.color,
        sortIndex: index,
      },
      now + index * 10,
    );
    const okrRow = (await saveEntity("okr", toRow(okrInput))) as unknown as Okr;
    createdOkrs.push(okrRow);

    const sourceList = sourceKrs
      .filter((kr) => kr.okrId === source.id)
      .sort((a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt);

    let krIndex = 0;
    for (const sourceKr of sourceList) {
      const row = await saveEntity(
        "kr",
        toRow({
          id: uuidv7(now + index * 10 + krIndex + 1),
          okrId: okrRow.id,
          title: sourceKr.title,
          metricType: sourceKr.metricType,
          startValue: sourceKr.startValue,
          targetValue: sourceKr.targetValue,
          currentValue: resetCurrentValue(sourceKr),
          unit: sourceKr.unit,
          linkedGoalIds: [],
          linkedTaskIds: [],
          sortIndex: krIndex,
          createdAt: now + index * 10 + krIndex + 1,
          updatedAt: now + index * 10 + krIndex + 1,
        }),
      );
      createdKrs.push(row as unknown as KeyResult);
      krIndex += 1;
    }
    index += 1;
  }

  return { okrs: createdOkrs, krs: createdKrs };
}

import {
  parseQuickCapture,
  type Goal,
  type InboxItem,
  type ParsedDraft,
  type Quadrant,
  type Task,
} from "@detter/shared";
import { deleteEntity, saveEntity } from "@/db/repo";
import { createTaskFromInbox, type TaskPatch } from "./task-factory";

/**
 * 收件箱的写操作集合。
 *
 * 这里只有「动作」，没有 UI 状态：撤销栈、选中态、弹窗都由组件持有。
 * 这样每个动作都能被单独调用（批量整理只是 for 循环），也方便单测。
 *
 * 所有写入都走 @/db/repo，因此离线时同样是写本地 + 进 outbox，不需要特殊分支。
 */

/** 解析结果优先用捕获时存下的；老数据没有 parsed 就现场解析一次。 */
export function draftOf(item: InboxItem, goals: readonly Goal[] = []): ParsedDraft {
  if (item.parsed) return item.parsed;
  return parseQuickCapture(item.rawText, {
    goals: goals.map((goal) => ({ id: goal.id, title: goal.title })),
  });
}

/** 一键整理：按解析结果建任务，并把这条标记为已分诊。 */
export async function triageItem(
  item: InboxItem,
  quadrant?: Quadrant,
  patch?: TaskPatch,
): Promise<Task> {
  return createTaskFromInbox({ item, quadrant, patch });
}

/** 归档：不建任务，留在库里可查，因此可以随时恢复。 */
export async function archiveItem(item: InboxItem): Promise<void> {
  await saveEntity("inbox", { ...item, status: "archived", taskId: null });
}

/** 软删除：写墓碑而不是物理删除，别的设备才会收到「这条没了」。 */
export async function removeItem(item: InboxItem): Promise<void> {
  await deleteEntity("inbox", item.id);
}

/** 恢复：归档 / 删除 / 已分诊 都能回到待整理。 */
export async function restoreItem(item: InboxItem, patch: Partial<InboxItem> = {}): Promise<void> {
  await saveEntity("inbox", {
    ...item,
    status: "pending",
    taskId: null,
    deletedAt: null,
    ...patch,
  });
}

/** 撤销「转任务」：把刚建的任务软删掉（它可能已经进了四象限）。 */
export async function revertTask(taskId: string): Promise<void> {
  await deleteEntity("task", taskId);
}

/** 内联编辑原文：保存时重新解析，chips 立刻更新。 */
export async function reparseItem(
  item: InboxItem,
  rawText: string,
  goals: readonly Goal[] = [],
): Promise<InboxItem> {
  const parsed = parseQuickCapture(rawText, {
    goals: goals.map((goal) => ({ id: goal.id, title: goal.title })),
  });
  const row = await saveEntity("inbox", { ...item, rawText, parsed });
  return row as unknown as InboxItem;
}

export interface BulkResult {
  done: number;
  failed: number;
}

/**
 * 批量整理。逐条串行：Dexie 的写事务会排队，串行比并发更容易看出「卡在哪一条」，
 * 而且失败时能准确报告已成功的条数，不会出现「一半成功一半失败还说不清」。
 */
export async function triageMany(items: readonly InboxItem[]): Promise<BulkResult> {
  let done = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await triageItem(item);
      done += 1;
    } catch {
      failed += 1;
    }
  }
  return { done, failed };
}

export async function archiveMany(items: readonly InboxItem[]): Promise<BulkResult> {
  let done = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await archiveItem(item);
      done += 1;
    } catch {
      failed += 1;
    }
  }
  return { done, failed };
}

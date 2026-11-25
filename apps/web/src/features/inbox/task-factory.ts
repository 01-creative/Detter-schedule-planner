import type { InboxItem, ParsedDraft, Quadrant, Task } from "@detter/shared";
import { markInboxTriaged, saveEntity } from "@/db/repo";

/**
 * 「一条记录」→「一条任务」。
 *
 * 这是收件箱分诊的唯一出口，捕获面板的「保存为 Q1」也走它 —— 两处必须产出完全
 * 一样的任务字段，否则同一句话从不同入口进来会得到不同结果，用户会困惑。
 *
 * 注意所有写入都经过 @/db/repo（自动维护 rev / deviceId / outbox），这里不碰 db。
 */

export interface TaskPatch {
  title?: string;
  notes?: string;
  quadrant?: Quadrant;
  /** 用户显式改了象限：锁定象限，之后不再由重要/紧急推导 */
  manualQuadrant?: boolean;
  startAt?: number | null;
  endAt?: number | null;
  allDay?: boolean;
  dueAt?: number | null;
  durationMin?: number | null;
  location?: string;
  tags?: string[];
  goalId?: string | null;
  rrule?: string | null;
}

/** 解析结果 + 用户修正 → repo.saveEntity("task") 的 payload。纯函数，便于单测。 */
export function buildTaskPayload(
  parsed: ParsedDraft | null,
  rawText: string,
  patch: TaskPatch = {},
): Record<string, unknown> {
  const title = (patch.title ?? parsed?.title ?? rawText).trim() || rawText.trim() || "未命名的记录";
  const raw = rawText.trim();

  return {
    title,
    // 原文和标题不一致时把原文留在备注里：分诊之后仍然找得到「我原来是怎么写的」
    notes: patch.notes ?? (raw && raw !== title ? raw : ""),
    kind: "task",
    status: "todo",
    quadrant: patch.quadrant ?? parsed?.quadrantGuess ?? 2,
    manualQuadrant: patch.manualQuadrant ?? false,
    startAt: patch.startAt !== undefined ? patch.startAt : (parsed?.startAt ?? null),
    endAt: patch.endAt !== undefined ? patch.endAt : (parsed?.endAt ?? null),
    allDay: patch.allDay ?? parsed?.allDay ?? false,
    dueAt: patch.dueAt !== undefined ? patch.dueAt : (parsed?.dueAt ?? null),
    location: patch.location ?? parsed?.location ?? "",
    tags: patch.tags ?? parsed?.tags ?? [],
    estimateMin:
      patch.durationMin !== undefined ? patch.durationMin : (parsed?.durationMin ?? null),
    goalId: patch.goalId !== undefined ? patch.goalId : (parsed?.goalId ?? null),
    rrule: patch.rrule !== undefined ? patch.rrule : (parsed?.rrule ?? null),
    source: "capture" as const,
  };
}

export interface CreateTaskInput {
  item: InboxItem;
  /** 不传时用解析出的象限建议 */
  quadrant?: Quadrant;
  patch?: TaskPatch;
}

/**
 * 建任务并把收件箱条目标记为已分诊。
 * 顺序必须是「先建任务、再标记」：反过来的话标记成功而建任务失败，这条记录就消失在待整理列表里了。
 */
export async function createTaskFromInbox({ item, quadrant, patch = {} }: CreateTaskInput): Promise<Task> {
  const payload = buildTaskPayload(item.parsed, item.rawText, {
    quadrant: quadrant ?? item.parsed?.quadrantGuess ?? 2,
    ...patch,
  });
  const row = await saveEntity("task", payload);
  const task = row as unknown as Task;
  await markInboxTriaged(item.id, task.id);
  return task;
}

import type { CaptureSource, InboxItem, ParsedDraft, Quadrant, Task } from "@detter/shared";
import { captureInbox } from "@/db/repo";
import { createTaskFromInbox } from "@/features/inbox/task-factory";

/**
 * 一次捕获的完整落库动作。
 *
 * 关键顺序（任务书 §3.3）：**先写收件箱，再做任何其它事**。
 * 收件箱那条是「不丢」的底线；即使后面建任务失败，原文也已经在盒子里，
 * 用户下次打开收件箱还能看到它，而不是收到一个「保存失败」然后什么都找不到。
 */

export interface SaveCaptureInput {
  rawText: string;
  parsed: ParsedDraft;
  source?: CaptureSource;
  /** 非空表示「同时按解析结果建任务」——目前用于 ⌘⇧Enter 保存为 Q1 */
  commitQuadrant?: Quadrant | null;
}

export interface SaveCaptureResult {
  item: InboxItem;
  task: Task | null;
}

export async function saveCapture({
  rawText,
  parsed,
  source = "hotkey",
  commitQuadrant = null,
}: SaveCaptureInput): Promise<SaveCaptureResult> {
  const item = await captureInbox({ rawText, parsed, source });

  if (!commitQuadrant) return { item, task: null };

  try {
    const task = await createTaskFromInbox({ item, quadrant: commitQuadrant });
    return { item, task };
  } catch {
    // 建任务失败不该让这次捕获看起来失败了：原文已经在盒子里，状态仍是 pending
    return { item, task: null };
  }
}

/** 批量捕获（多行粘贴）：逐条写，任何一条失败就停在那儿，不静默吞掉。 */
export async function saveCaptureBatch(
  drafts: Array<{ rawText: string; parsed: ParsedDraft }>,
  source: CaptureSource = "manual",
): Promise<{ saved: number; failedAt: number | null }> {
  let saved = 0;
  for (const draft of drafts) {
    try {
      await saveCapture({ rawText: draft.rawText, parsed: draft.parsed, source });
      saved += 1;
    } catch {
      return { saved, failedAt: saved };
    }
  }
  return { saved, failedAt: null };
}

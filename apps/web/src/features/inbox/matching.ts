import { DAY, type Goal, type Task } from "@detter/shared";

/**
 * 收件箱的「不用大模型也能做」的三条智能提示。
 *
 * 都是纯函数，输入是已有任务/目标 + 这条记录的解析结果，输出只需要一句人话。
 * 刻意不做模糊匹配库：单人数据量下，标题级别的编辑距离足够准，
 * 也不会因为一次误判就把两条不同的任务合并掉。
 */

/** 相似度阈值：>0.85 才提示「可能重复」（任务书 §4.3）。 */
export const DUPLICATE_THRESHOLD = 0.85;
/** 只看最近 7 天内建的任务。 */
export const DUPLICATE_WINDOW_MS = 7 * DAY;
/** 没有结束时间的任务按 30 分钟的块参与冲突判定。 */
export const DEFAULT_BLOCK_MS = 30 * 60_000;

const PUNCTUATION = /[\s\u3000，,。.、;；:：!！?？'"“”‘’()（）[\]【】<>《》\-—_~·#@]/g;

/** 归一到「只比字」：去掉空白、标点、# @ 这类解析器自己的标记。 */
export function normalizeTitle(input: string): string {
  return (input ?? "").toLowerCase().replace(PUNCTUATION, "");
}

/** 经典编辑距离（两行滚动，中文按字符算）。 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const deletion = previous[j]! + 1;
      const insertion = current[j - 1]! + 1;
      const substitution = previous[j - 1]! + cost;
      current[j] = Math.min(deletion, insertion, substitution);
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[b.length]!;
}

/** 归一化后的相似度 0..1。 */
export function titleSimilarity(a: string, b: string): number {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length);
}

export interface SimilarTask {
  task: Task;
  score: number;
}

/**
 * 找最近 7 天内最像的一条任务。
 * 已删除的不算；已完成/已放弃的也算（「这事我做过了」正是最需要提醒的重复）。
 */
export function findDuplicate(
  title: string,
  tasks: readonly Task[],
  now: number = Date.now(),
): SimilarTask | null {
  if (!normalizeTitle(title)) return null;

  let best: SimilarTask | null = null;
  for (const task of tasks) {
    if (task.deletedAt) continue;
    if (now - task.createdAt > DUPLICATE_WINDOW_MS) continue;
    const score = titleSimilarity(title, task.title);
    if (score < DUPLICATE_THRESHOLD) continue;
    if (!best || score > best.score) best = { task, score };
  }
  return best;
}

export interface ConflictHit {
  task: Task;
}

/** 与已有时间块重叠的第一条任务。全天任务按整天算。 */
export function findConflict(
  startAt: number | null,
  endAt: number | null,
  tasks: readonly Task[],
  allDay = false,
): ConflictHit | null {
  if (startAt === null) return null;

  const start = startAt;
  const end = endAt ?? start + (allDay ? DAY : DEFAULT_BLOCK_MS);

  for (const task of tasks) {
    if (task.deletedAt) continue;
    if (task.startAt === null) continue;
    if (task.status === "dropped") continue;

    const otherStart = task.startAt;
    const otherEnd =
      task.endAt ?? otherStart + (task.allDay ? DAY : DEFAULT_BLOCK_MS);
    if (start < otherEnd && otherStart < end) return { task };
  }
  return null;
}

/**
 * 无 `@` 时的目标建议：文本里出现了某个目标标题就挂上。
 * 多个命中时取最长的那个（「高数」和「高数不挂科」同时命中，应该挂更具体的）。
 */
export function suggestGoal(text: string, goals: readonly Goal[]): Goal | null {
  const haystack = normalizeTitle(text);
  if (!haystack) return null;

  let best: Goal | null = null;
  for (const goal of goals) {
    if (goal.deletedAt || goal.status !== "active") continue;
    const needle = normalizeTitle(goal.title);
    if (needle.length < 2) continue;
    if (!haystack.includes(needle)) continue;
    if (!best || needle.length > normalizeTitle(best.title).length) best = goal;
  }
  return best;
}

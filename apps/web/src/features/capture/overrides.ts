import { startOfDay, type ParsedDraft, type Quadrant } from "@detter/shared";

/**
 * 捕获面板的「微调」与输入辅助。
 *
 * 为什么单独抽成纯函数：解析器（packages/shared/nlp.ts）只负责猜，用户在 chips 上
 * 点出来的修正是另一层数据。两层分开后，保存时永远是「解析结果 + 修正」的合成结果，
 * 不会出现「改了时间但标签被覆盖」这类顺序问题，也方便单测。
 */

const MINUTE_MS = 60_000;

/** 一次微调里用户可能改动的字段。全部可选：字段不存在表示沿用解析结果。 */
export interface CaptureTweaks {
  /** null = 明确清掉时间 */
  startAt?: number | null;
  allDay?: boolean;
  durationMin?: number | null;
  location?: string;
  tags?: string[];
  goalId?: string | null;
  goalTitle?: string | null;
  quadrant?: Quadrant | null;
  rrule?: string | null;
}

/** chips 上被点开的那一类修正。 */
export type TweakTarget =
  | "time"
  | "duration"
  | "location"
  | "tags"
  | "goal"
  | "quadrant"
  | "recurrence";

export function hasTweaks(tweaks: CaptureTweaks): boolean {
  return Object.keys(tweaks).some((key) => tweaks[key as keyof CaptureTweaks] !== undefined);
}

/** 标签统一去掉 #、去空白、去重，防止 `#作业` 和 `作业` 变成两个标签。 */
export function normalizeTags(input: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of input) {
    const tag = raw.replace(/^#+/, "").trim();
    if (!tag) continue;
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

/**
 * 把解析结果与用户修正合成最终草稿。
 *
 * 时间这里有一个必须一起处理的连带关系：改了 startAt 之后 endAt/dueAt 会变成
 * 「指向旧时间点」的脏数据，所以三者在同一分支里一起重算。
 */
export function applyTweaks(draft: ParsedDraft, tweaks: CaptureTweaks): ParsedDraft {
  const next: ParsedDraft = { ...draft, tags: [...draft.tags], matches: [...draft.matches] };

  if (tweaks.startAt !== undefined) {
    const duration = tweaks.durationMin !== undefined ? tweaks.durationMin : draft.durationMin;
    const wantAllDay = tweaks.allDay ?? draft.allDay;
    const start = tweaks.startAt;

    next.startAt = start === null ? null : wantAllDay ? startOfDay(start) : start;
    next.allDay = start !== null && wantAllDay;
    next.endAt =
      next.startAt !== null && !next.allDay && duration
        ? next.startAt + duration * MINUTE_MS
        : null;
    next.dueAt =
      next.startAt !== null && draft.dueAt !== null ? (next.endAt ?? next.startAt) : null;
  } else {
    if (tweaks.allDay !== undefined) {
      next.allDay = tweaks.allDay && next.startAt !== null;
      if (next.allDay && next.startAt !== null) next.startAt = startOfDay(next.startAt);
      if (next.allDay) next.endAt = null;
    }
    if (tweaks.durationMin !== undefined) {
      next.durationMin = tweaks.durationMin;
      next.endAt =
        next.startAt !== null && next.durationMin ? next.startAt + next.durationMin * MINUTE_MS : null;
    }
  }

  if (tweaks.location !== undefined) next.location = tweaks.location.trim();
  if (tweaks.tags !== undefined) next.tags = normalizeTags(tweaks.tags);
  if (tweaks.goalId !== undefined || tweaks.goalTitle !== undefined) {
    next.goalId = tweaks.goalId ?? null;
    next.goalTitle = tweaks.goalTitle ?? null;
  }
  if (tweaks.quadrant !== undefined) next.quadrantGuess = tweaks.quadrant;
  if (tweaks.rrule !== undefined) next.rrule = tweaks.rrule;

  return next;
}

/** 把快捷 chip 插到文本末尾；已有内容时补一个空格，不吞掉用户正在打的字。 */
export function insertToken(text: string, token: string): string {
  if (!token) return text;
  const base = text.replace(/\s+$/, "");
  return base ? `${base} ${token} ` : `${token} `;
}

/**
 * 多行粘贴拆分：每行独立成一条。
 * 空行直接丢掉 —— 从网页/微信复制来的文本经常夹着空行，留着会变成空记录。
 */
export function splitCaptureLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * 移动端快捷 chip。
 *
 * 注意「本周」插入的是「本周日」：shared 的解析器只认 `周X` 具体某天，
 * 一个裸的「本周」会原样留在标题里。这里用一个能被解析的等效说法，
 * 保证「点一下就真的排进本周」而不是制造一句不能被识别的废话。
 */
export const QUICK_TOKENS: ReadonlyArray<{ label: string; token: string }> = [
  { label: "今天", token: "今天" },
  { label: "明天", token: "明天" },
  { label: "本周", token: "本周日" },
  { label: "Q1", token: "!1" },
  { label: "Q2", token: "!2" },
];

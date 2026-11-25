import type { ParsedDraft, Quadrant } from "./entities";
import { addDays, endOfDay, startOfDay } from "./time";

/**
 * 快速捕获的自然语言解析器（纯函数、零依赖、可单测）。
 *
 * 设计目标：让「记一下」这件事的成本趋近于零。
 *   - 输入一句话就够："明天下午3点 交高数作业 #作业 在教三 40分钟"
 *   - 解析器只给建议，绝不擅自落库；用户在收件箱里一键确认 / 微调。
 *   - 中文口语优先：明天 / 下周三 / 9点半 / 两小时后 / 每周一 / 在图书馆。
 *
 * 解析顺序即优先级：先吃掉结构化标记（!象限 #标签 @目标 每X），
 * 再吃日期 → 时段 → 时刻 → 时长 → 地点，最后剩下的才是标题。
 */

export interface ParseGoalRef {
  id: string;
  title: string;
}

export interface ParseContext {
  now?: number;
  goals?: ParseGoalRef[];
  defaultQuadrant?: Quadrant;
}

/* -------------------------------------------------------------------------- */
/*                                  数字解析                                   */
/* -------------------------------------------------------------------------- */

const CJK_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

/** "三" / "十二" / "二十三" / "12" → 整数；失败返回 null。 */
export function parseCjkNumber(input: string): number | null {
  if (!input) return null;
  if (/^\d+$/.test(input)) return Number(input);
  if (!/^[零〇一二两三四五六七八九十]+$/.test(input)) return null;

  let section = 0;
  for (const ch of input) {
    if (ch === "十") {
      section = section === 0 ? 10 : section * 10;
    } else {
      const d = CJK_DIGITS[ch]!;
      section = section === 0 ? d : section + d;
    }
  }
  return section > 0 ? section : null;
}

const WEEKDAY_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
};

const BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

/* -------------------------------------------------------------------------- */
/*                                掩码式扫描器                                  */
/* -------------------------------------------------------------------------- */

interface Found {
  start: number;
  end: number;
  text: string;
}

/**
 * 在原文上做「认领」：被认领的字符不参与标题，剩余部分即标题。
 * 这样既保留了精确的原文偏移（供高亮），又不需要做字符串拼接替换。
 */
class TextScanner {
  readonly text: string;
  private readonly taken: boolean[];

  constructor(text: string) {
    this.text = text;
    this.taken = new Array<boolean>(text.length).fill(false);
  }

  isFree(start: number, end: number): boolean {
    for (let i = start; i < end; i++) if (this.taken[i]) return false;
    return true;
  }

  claim(start: number, end: number): void {
    for (let i = start; i < end; i++) this.taken[i] = true;
  }

  /** 剩余未被认领的文本（标题主体） */
  remainder(): string {
    let out = "";
    for (let i = 0; i < this.text.length; i++) {
      if (!this.taken[i]) out += this.text[i];
    }
    return out
      .replace(/[ \t\u3000]+/g, " ")
      .replace(/^[\s,，。;；:：\-–—、]+/, "")
      .replace(/[\s,，。;；:：\-–—、]+$/, "")
      .trim();
  }
}

/* -------------------------------------------------------------------------- */
/*                                  日期解析                                   */
/* -------------------------------------------------------------------------- */

/**
 * 把「今天 / 明天 / 下周三 / 9月1日 / 2026-09-01」解析成当天 00:00 的时间戳。
 * 周几规则：不带前缀 = 最近的那个周X（含今天）；本周X = 本周内（已过则下周）；下周X = 下一个周X。
 */
export function resolveDateToken(token: string, now: number): number | null {
  const base = startOfDay(now);

  if (/^(今天|今日)$/.test(token)) return base;
  if (/^(明天|明日|明儿)$/.test(token)) return addDays(base, 1);
  if (/^(后天)$/.test(token)) return addDays(base, 2);
  if (/^(大后天)$/.test(token)) return addDays(base, 3);
  if (/^(昨天)$/.test(token)) return addDays(base, -1);

  const wk = /^(下下|下|这|本)?(?:周|星期|礼拜)([一二三四五六日天1-7])$/.exec(token);
  if (wk) {
    const target = WEEKDAY_MAP[wk[2]!]!;
    const prefix = wk[1] ?? "";
    const cur = new Date(now);
    const curIso = cur.getDay() === 0 ? 7 : cur.getDay();

    if (prefix === "下下") {
      return addDays(base, ((target - curIso + 7) % 7 || 7) + 7);
    }
    if (prefix === "下") {
      return addDays(base, (target - curIso + 7) % 7 || 7);
    }
    // 本周 / 这周 / 无前缀
    return addDays(base, (target - curIso + 7) % 7);
  }

  // 12月31日 / 12-31 / 12/31（不带年份）
  const md = /^(\d{1,2})(?:月|-|\/)(\d{1,2})[日号]?$/.exec(token);
  if (md) {
    const year = new Date(now).getFullYear();
    const month = Number(md[1]) - 1;
    const day = Number(md[2]);
    const candidate = new Date(year, month, day).getTime();
    // 捕获是「往前看」的行为：已经过去的日期，默认说的是明年
    return candidate < base ? new Date(year + 1, month, day).getTime() : candidate;
  }

  // 2026-12-31 / 2026年12月31日
  const ymd = /^(\d{4})(?:年|-|\/)(\d{1,2})(?:月|-|\/)(\d{1,2})[日号]?$/.exec(token);
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])).getTime();

  return null;
}

/* -------------------------------------------------------------------------- */
/*                                  时刻解析                                   */
/* -------------------------------------------------------------------------- */

const MINUTE_OF_DAY = 60_000;

/** 无「上午/下午」时，1~6 点按下午理解（中文口语习惯："3点开会" ≈ 15:00）。 */
function applyPeriod(hour: number, period: string | null): number {
  if (!period) return hour >= 1 && hour <= 6 ? hour + 12 : hour;
  if (/凌晨/.test(period)) return hour % 12;
  if (/早|晨|上午/.test(period)) return hour;
  if (/中午/.test(period)) return hour;
  if (/下午|傍晚|晚|夜/.test(period)) return hour < 12 ? hour + 12 : hour;
  return hour;
}

interface TimeExtraction {
  hour: number | null;
  minute: number;
  endHour: number | null;
  endMinute: number;
  /** 绝对时间（相对时间如「两小时后」直接给出结果） */
  absolute: number | null;
  found: Found | null;
}

function emptyTime(): TimeExtraction {
  return { hour: null, minute: 0, endHour: null, endMinute: 0, absolute: null, found: null };
}

/** 解析 "9" / "半" / "30分" 中的分钟部分。 */
function parseMinuteToken(raw: string | undefined): number {
  if (!raw) return 0;
  const t = raw.trim();
  if (t === "半") return 30;
  const n = Number(t.replace(/分/g, "").trim());
  return Number.isFinite(n) ? Math.min(59, n) : 0;
}

function extractTime(sc: TextScanner, now: number): TimeExtraction {
  const out = emptyTime();

  /* 1) 相对时间：两小时后 / 30分钟后 / 3天后 */
  const relRe = /(\d{1,3}|[零〇一二两三四五六七八九十]{1,3})\s*个?\s*(分钟|小时|钟头|天|周|星期)(?:之)?后/;
  const rel = relRe.exec(sc.text);
  if (rel && sc.isFree(rel.index, rel.index + rel[0].length)) {
    const n = parseCjkNumber(rel[1]!) ?? 0;
    const unit = rel[2]!;
    const minutes = /分钟/.test(unit)
      ? n
      : /天/.test(unit)
        ? n * 1440
        : /周|星期/.test(unit)
          ? n * 7 * 1440
          : n * 60;
    const target = new Date(now + minutes * MINUTE_OF_DAY);
    out.absolute = target.getTime();
    sc.claim(rel.index, rel.index + rel[0].length);
    out.found = { start: rel.index, end: rel.index + rel[0].length, text: rel[0] };
    return out;
  }

  /* 2) 时间段：9:30-11:00 / 9点-11点半 / 9点到11点 */
  const rangeRe =
    /(\d{1,2})\s*(?:[:：](\d{1,2})|(?:点|時|时)(半|\d{1,2}\s*分?)?)\s*(?:-|~|～|到|至)\s*(\d{1,2})\s*(?:[:：](\d{1,2})|(?:点|時|时)(半|\d{1,2}\s*分?)?)/;
  const rm = rangeRe.exec(sc.text);
  if (rm && sc.isFree(rm.index, rm.index + rm[0].length)) {
    out.hour = Number(rm[1]);
    out.minute = rm[2] ? Number(rm[2]) : parseMinuteToken(rm[3]);
    out.endHour = Number(rm[4]);
    out.endMinute = rm[5] ? Number(rm[5]) : parseMinuteToken(rm[6]);
    sc.claim(rm.index, rm.index + rm[0].length);
    out.found = { start: rm.index, end: rm.index + rm[0].length, text: rm[0] };
    return out;
  }

  /* 3) 15:30 */
  const colonRe = /(?<!\d)(\d{1,2})[:：](\d{2})(?!\d)/;
  const cm = colonRe.exec(sc.text);
  if (cm && sc.isFree(cm.index, cm.index + cm[0].length)) {
    out.hour = Number(cm[1]);
    out.minute = Number(cm[2]);
    sc.claim(cm.index, cm.index + cm[0].length);
    out.found = { start: cm.index, end: cm.index + cm[0].length, text: cm[0] };
    return out;
  }

  /* 4) 3点 / 3点半 / 3点20 / 三点 */
  const cnRe = /(?<![\d零〇一二两三四五六七八九十])(\d{1,2}|[零〇一二两三四五六七八九十]{1,3})\s*(?:点|時|时)\s*(半|\d{1,2}\s*分?)?/;
  const cn = cnRe.exec(sc.text);
  if (cn && sc.isFree(cn.index, cn.index + cn[0].length)) {
    const h = parseCjkNumber(cn[1]!);
    if (h !== null && h >= 0 && h <= 24) {
      out.hour = h;
      out.minute = parseMinuteToken(cn[2]);
      sc.claim(cn.index, cn.index + cn[0].length);
      out.found = { start: cn.index, end: cn.index + cn[0].length, text: cn[0] };
      return out;
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/*                                  象限猜测                                   */
/* -------------------------------------------------------------------------- */

const URGENT_WORDS = /(紧急|马上|立刻|立即|今天|今晚|截止|deadline|ddl|催|尽快|逾期|明天交)/i;
const IMPORTANT_WORDS =
  /(重要|关键|考试|答辩|面试|体检|报名|缴费|论文|复习|健身|读书|学习|复盘|项目|家人|健康)/;

/** 关键词兜底猜测象限；用户在界面上随时可改。 */
export function guessQuadrant(text: string, fallback: Quadrant = 2): Quadrant {
  const urgent = URGENT_WORDS.test(text);
  const important = IMPORTANT_WORDS.test(text);
  if (urgent && important) return 1;
  if (!urgent && important) return 2;
  if (urgent && !important) return 3;
  return fallback;
}

/* -------------------------------------------------------------------------- */
/*                                  主流程                                     */
/* -------------------------------------------------------------------------- */

/** 解析一句口语化的记录，返回结构化草稿。纯函数，不读写任何外部状态。 */
export function parseQuickCapture(raw: string, ctx: ParseContext = {}): ParsedDraft {
  const now = ctx.now ?? Date.now();
  const text = (raw ?? "").trim();
  const sc = new TextScanner(text);
  const matches: ParsedDraft["matches"] = [];

  const record = (kind: ParsedDraft["matches"][number]["kind"], m: { index?: number; 0: string }): void => {
    const start = m.index ?? 0;
    matches.push({ kind, text: m[0], start, end: start + m[0].length });
  };

  /* 1. 象限标记：!1 .. !4 或 [q1] */
  let explicitQuadrant: Quadrant | null = null;
  const qm = /(?:^|\s)[!！]([1-4])(?=\s|$)/.exec(text) ?? /\[q([1-4])\]/i.exec(text);
  if (qm && sc.isFree(qm.index, qm.index + qm[0].length)) {
    explicitQuadrant = Number(qm[1]) as Quadrant;
    sc.claim(qm.index, qm.index + qm[0].length);
    record("quadrant", qm);
  }

  /* 2. 标签：#作业 */
  const tags: string[] = [];
  for (const m of text.matchAll(/#([^\s#!！,，。;；]+)/g)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!sc.isFree(start, end)) continue;
    const tag = m[1]!.trim();
    if (!tag) continue;
    if (!tags.includes(tag)) tags.push(tag);
    sc.claim(start, end);
    record("tag", m);
  }

  /* 3. 目标引用：@高数，按目标标题做包含匹配 */
  let goalId: string | null = null;
  let goalTitle: string | null = null;
  const goals = ctx.goals ?? [];
  for (const m of text.matchAll(/@([^\s@#!！,，。;；]+)/g)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!sc.isFree(start, end)) continue;
    const needle = m[1]!.trim().toLowerCase();
    const hit =
      goals.find((g) => g.title.toLowerCase() === needle) ??
      goals.find((g) => g.title.toLowerCase().includes(needle)) ??
      goals.find((g) => needle.includes(g.title.toLowerCase()));
    sc.claim(start, end);
    record("goal", m);
    if (hit) {
      goalId = hit.id;
      goalTitle = hit.title;
    } else if (!goalTitle) {
      goalTitle = m[1]!.trim();
    }
  }

  /* 4. 重复规则：每天 / 每周一 / 每月 */
  let rrule: string | null = null;
  const recRe = /每(天|日|周|星期|礼拜|个?月)([一二三四五六日天1-7])?/;
  const rec = recRe.exec(text);
  if (rec && sc.isFree(rec.index, rec.index + rec[0].length)) {
    const unit = rec[1]!;
    if (/天|日/.test(unit)) {
      rrule = "FREQ=DAILY";
    } else if (/周|星期|礼拜/.test(unit)) {
      const wd = rec[2] ? BYDAY[WEEKDAY_MAP[rec[2]]! - 1] : null;
      rrule = wd ? `FREQ=WEEKLY;BYDAY=${wd}` : "FREQ=WEEKLY";
    } else {
      rrule = "FREQ=MONTHLY";
    }
    sc.claim(rec.index, rec.index + rec[0].length);
    record("recurrence", rec);
  }

  /* 5. 日期：今天 / 明天 / 下周三 / 9月1日 / 今晚 / 明早 */
  let dateTs: number | null = null;
  let dayHourHint: number | null = null;

  const dateRe =
    /(大后天|后天|明天|明日|明儿|今天|今日|昨天|(?:下下|下|这|本)?(?:周|星期|礼拜)[一二三四五六日天1-7]|\d{4}(?:年|-|\/)\d{1,2}(?:月|-|\/)\d{1,2}[日号]?|\d{1,2}(?:月|-|\/)\d{1,2}[日号]?)/;
  const dm = dateRe.exec(text);
  if (dm && sc.isFree(dm.index, dm.index + dm[0].length)) {
    const resolved = resolveDateToken(dm[0], now);
    if (resolved !== null) {
      dateTs = resolved;
      sc.claim(dm.index, dm.index + dm[0].length);
      record("date", dm);
    }
  }

  if (dateTs === null) {
    const eveRe = /今早|今晚|明早|明晚/;
    const ev = eveRe.exec(text);
    if (ev && sc.isFree(ev.index, ev.index + ev[0].length)) {
      dateTs = addDays(startOfDay(now), /明/.test(ev[0]) ? 1 : 0);
      dayHourHint = /早/.test(ev[0]) ? 8 : 20;
      sc.claim(ev.index, ev.index + ev[0].length);
      record("date", ev);
    }
  }

  /* 6. 时段：凌晨 / 上午 / 下午 / 晚上 */
  let period: string | null = null;
  const periodRe = /凌晨|早上|早晨|清晨|上午|中午|正午|下午|傍晚|晚上|晚间|夜里/;
  const pm = periodRe.exec(text);
  if (pm && sc.isFree(pm.index, pm.index + pm[0].length)) {
    period = pm[0];
    sc.claim(pm.index, pm.index + pm[0].length);
    record("time", pm);
  }

  /* 7. 时刻 */
  const time = extractTime(sc, now);
  if (time.found) record("time", { index: time.found.start, 0: time.found.text });

  /* 8. 时长：40分钟 / 1.5小时 */
  let durationMin: number | null = null;
  const durRe =
    /(\d{1,3}(?:\.\d)?|[零〇一二两三四五六七八九十]{1,3})\s*个?\s*(分钟|分|min|小时|钟头|h)(?![后点時时])/i;
  const dur = durRe.exec(text);
  if (dur && sc.isFree(dur.index, dur.index + dur[0].length)) {
    const n = parseCjkNumber(dur[1]!) ?? 0;
    const unit = dur[2]!.toLowerCase();
    durationMin = /小时|钟头|h/.test(unit) ? Math.round(n * 60) : Math.round(n);
    sc.claim(dur.index, dur.index + dur[0].length);
    record("duration", dur);
  }

  /* 9. 地点：在教三 */
  let location = "";
  const locRe = /在\s*([^\s，,。;；!！]{1,20})/;
  const loc = locRe.exec(text);
  if (loc && sc.isFree(loc.index, loc.index + loc[0].length)) {
    location = loc[1]!.trim();
    sc.claim(loc.index, loc.index + loc[0].length);
    record("location", loc);
  }

  /* 10. 组装时间 */
  let startAt: number | null = null;
  let endAt: number | null = null;
  let dueAt: number | null = null;
  let allDay = false;

  if (time.absolute !== null) {
    startAt = time.absolute;
  } else if (time.hour !== null) {
    const dayBase = dateTs ?? startOfDay(now);
    const hour = applyPeriod(time.hour, period);
    const d = new Date(dayBase);
    d.setHours(hour, time.minute, 0, 0);
    startAt = d.getTime();

    if (time.endHour !== null) {
      const endHour = applyPeriod(time.endHour, period);
      const e = new Date(dayBase);
      e.setHours(endHour, time.endMinute, 0, 0);
      let end = e.getTime();
      if (end <= startAt) end += 86_400_000;
      endAt = end;
    }
  } else if (dateTs !== null) {
    if (dayHourHint !== null) {
      const d = new Date(dateTs);
      d.setHours(dayHourHint, 0, 0, 0);
      startAt = d.getTime();
    } else {
      startAt = dateTs;
      allDay = true;
    }
  }

  if (startAt !== null && endAt === null && durationMin !== null) {
    endAt = startAt + durationMin * MINUTE_OF_DAY;
  }

  // 截止语义：只有明确是「截止/交/DDL」时，才额外记录 dueAt
  if (startAt !== null && /(截止|deadline|ddl|交作业|交材料|提交)/i.test(text)) {
    dueAt = endAt ?? startAt;
  }
  if (allDay && startAt !== null) {
    dueAt = endOfDay(startAt);
  }

  /* 11. 标题 = 未认领的剩余文本 */
  const title = sc.remainder() || text;

  /* 12. 置信度：命中字段越多越自信 */
  const fieldCount = [
    dateTs !== null,
    time.hour !== null || time.absolute !== null,
    durationMin !== null,
    location !== "",
    tags.length > 0,
  ].filter(Boolean).length;
  const confidence = Math.min(1, 0.3 + fieldCount * 0.15);

  return {
    title,
    notes: "",
    startAt,
    endAt,
    dueAt,
    allDay,
    durationMin,
    quadrantGuess: explicitQuadrant ?? guessQuadrant(text, ctx.defaultQuadrant ?? 2),
    tags,
    goalId,
    goalTitle,
    location,
    rrule,
    confidence: Number(confidence.toFixed(2)),
    matches,
  };
}

/** 测试友好版本：固定 now。 */
export function parseQuickCaptureAt(
  raw: string,
  now: number,
  ctx: Omit<ParseContext, "now"> = {},
): ParsedDraft {
  return parseQuickCapture(raw, { ...ctx, now });
}

/** 生成一条收件箱条目的默认展示文案（列表里用）。 */
export function summarizeDraft(draft: ParsedDraft): string {
  const parts: string[] = [];
  if (draft.allDay && draft.startAt) parts.push("全天");
  if (draft.tags.length) parts.push(draft.tags.map((t) => `#${t}`).join(" "));
  if (draft.goalTitle) parts.push(`@${draft.goalTitle}`);
  if (draft.location) parts.push(`在${draft.location}`);
  return parts.join(" ");
}

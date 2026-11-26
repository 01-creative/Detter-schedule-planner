/**
 * 课表 HTML 解析器（纯函数，无 DOM 依赖）。
 *
 * 背景：四川大学教务系统「本学期课程表」的保存页是服务端渲染的表格，结构稳定但**不合法地嵌套**：
 * 课程块是绝对定位的 `<div class="class_div">`，一个 `<td>` 里可能塞两个（同一时间两门课）。
 * 所以这里不做「DOM 树 + 选择器」那套，而是基于三条明确假设做正则切片：
 *
 *   假设 1：课程表在 `<tbody id="courseTableBody">…</tbody>` 里（找不到时退化为解析整页 td）；
 *   假设 2：每个单元格是 `<td id="{day}_{period}">`，day 取值 1..7（1=周一 … 7=周日，与 ISO 周几一致），
 *           period 是「第几节」的起始值；表头 `<th id="0_x">` 会被自动跳过；
 *   假设 3：一个 `<td>` 里的每个课程块都以 `<div class="… class_div …">` 开始，
 *           块内 `<p>` 的 class 决定语义：`p-kcm-*`=课程名、`kcb_p_gray`=教师/周次/节次、
 *           `p-jxl-*`=地点。
 *
 * 这三条都在真实文件（2026-2027 秋季学期，14 个有课格子 / 15 个课程块）上验证过。
 * 教务系统换版式时，只需要改这一个文件，UI 与导入流程不受影响。
 */

/* -------------------------------------------------------------------------- */
/*                                  类型                                       */
/* -------------------------------------------------------------------------- */

/** 一次上课时段。weeks 是展开后的周次集合（升序、去重）。 */
export interface TimetableSlot {
  /** ISO 周几：1=周一 … 7=周日 */
  weekday: number;
  /** 起始节次（1 起） */
  startPeriod: number;
  /** 结束节次（含） */
  endPeriod: number;
  /** 学期第几周上课，如 [1,2,3] 或 [4,6,8]（单双周已展开） */
  weeks: number[];
  /** 上课地点，可能为空 */
  location: string;
}

export interface ParsedCourse {
  /** 去掉教务系统 `_42` 课程号后缀后的课程名 */
  name: string;
  /** 被去掉的那个后缀（如 `42`），可能为空 */
  code: string;
  /** 去掉 `*` 的教师名；多位教师用逗号保留原样 */
  teacher: string;
  /** 同一门课在不同格子里的多个时段 */
  slots: TimetableSlot[];
}

export interface ParsedTimetable {
  courses: ParsedCourse[];
  /** 不影响继续导入、但值得让用户知道的结构问题 */
  warnings: string[];
  stats: {
    /** 扫到的 td 单元格数（含空单元格） */
    cells: number;
    /** 有课程内容的单元格数 */
    courseCells: number;
    /** 解析出的时段总数 */
    slots: number;
  };
}

/* -------------------------------------------------------------------------- */
/*                              文本 / HTML 工具                                */
/* -------------------------------------------------------------------------- */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** 只处理课表里会出现的实体；未知实体原样保留，避免猜错。 */
export function decodeHtmlEntities(raw: string): string {
  return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** 去标签 + 解码实体 + 折叠空白。 */
function plainText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstParagraph(html: string, classToken: string): string | null {
  // class 属性里只要含有该 token 就算命中（教务系统用 p-kcm-1..n 表示配色）
  const pattern = new RegExp(
    `<p\\b[^>]*\\bclass\\s*=\\s*["'][^"']*${classToken}[^"']*["'][^>]*>([\\s\\S]*?)<\\/p>`,
    "i",
  );
  const match = pattern.exec(html);
  return match ? plainText(match[1] ?? "") : null;
}

function allParagraphs(html: string, classToken: string): string[] {
  const pattern = new RegExp(
    `<p\\b[^>]*\\bclass\\s*=\\s*["'][^"']*${classToken}[^"']*["'][^>]*>([\\s\\S]*?)<\\/p>`,
    "gi",
  );
  const values: string[] = [];
  for (const match of html.matchAll(pattern)) {
    const text = plainText(match[1] ?? "");
    if (text) values.push(text);
  }
  return values;
}

/* -------------------------------------------------------------------------- */
/*                              周次 / 节次解析                                 */
/* -------------------------------------------------------------------------- */

/** 节次范围：`1-2节`、`5-7节`、`10-12节`；单节写成 `3节`。 */
export function parsePeriodRange(raw: string): { startPeriod: number; endPeriod: number } | null {
  const text = raw.replace(/[－–—]/g, "-").replace(/\s+/g, "");
  const range = /^(\d{1,2})-(\d{1,2})节$/.exec(text);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (start >= 1 && end >= start) return { startPeriod: start, endPeriod: end };
    return null;
  }
  const single = /^(\d{1,2})节$/.exec(text);
  if (single) {
    const value = Number(single[1]);
    return value >= 1 ? { startPeriod: value, endPeriod: value } : null;
  }
  return null;
}

const MAX_WEEK = 60;

/**
 * 周次解析。已见的写法（真实文件里都出现过）：
 *
 *   1-17周              连续
 *   1-8周,10-16周       两段（逗号分隔）
 *   1-17周(单)          单周（括号标记）
 *   1-16周(双)          双周（括号标记）
 *   3-9周单周           单周（后缀标记）
 *   4-18周双周          双周（后缀标记）
 *   1-16 周             带空格
 *
 * 解析策略：先剥掉单双周标记，再按逗号切段、逐段展开，最后按奇偶过滤并去重排序。
 * 无法识别的片段直接忽略（由调用方通过 warnings 报告），永远不抛异常。
 */
export function parseWeeks(raw: string): number[] {
  let text = raw
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[，、;；]/g, ",")
    .replace(/[－–—]/g, "-")
    .replace(/\s+/g, "");
  if (!text) return [];

  let parity: 0 | 1 | null = null;
  if (/单周|\(单\)|\(单周\)|单$/.test(text)) parity = 1;
  else if (/双周|\(双\)|\(双周\)|双$/.test(text)) parity = 0;

  text = text
    .replace(/\(单周?\)|\(双周?\)|单周|双周/g, "")
    .replace(/\(周\)/g, "")
    .replace(/周/g, "");

  const weeks = new Set<number>();
  for (const segment of text.split(",")) {
    if (!segment) continue;
    const range = /^(\d{1,2})-(\d{1,2})$/.exec(segment);
    if (range) {
      let start = Number(range[1]);
      let end = Number(range[2]);
      if (start > end) [start, end] = [end, start];
      for (let week = Math.max(1, start); week <= Math.min(MAX_WEEK, end); week += 1) {
        if (parity === null || week % 2 === parity) weeks.add(week);
      }
      continue;
    }
    const single = /^(\d{1,2})$/.exec(segment);
    if (single) {
      const week = Number(single[1]);
      if (week >= 1 && week <= MAX_WEEK && (parity === null || week % 2 === parity)) weeks.add(week);
    }
  }
  return [...weeks].sort((left, right) => left - right);
}

/* -------------------------------------------------------------------------- */
/*                              课程名 / 教师                                   */
/* -------------------------------------------------------------------------- */

export const WEEKDAY_TOKENS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

export function weekdayToken(weekday: number): (typeof WEEKDAY_TOKENS)[number] {
  const index = Math.min(7, Math.max(1, Math.trunc(weekday))) - 1;
  return WEEKDAY_TOKENS[index] as (typeof WEEKDAY_TOKENS)[number];
}

/**
 * 课程名清洗：去掉教务系统拼在末尾的 `_42`（教学班/课程号后缀）。
 *
 * 只在「后缀足够短且看起来像编号」时才剥，避免把「Python_数据分析」这种名字切坏。
 */
export function cleanCourseName(raw: string): { name: string; code: string } {
  const text = raw.trim();
  const match = /^(.*\S)_([0-9A-Za-z]{1,8})$/.exec(text);
  if (!match || !match[1]) return { name: text, code: "" };
  return { name: match[1].trim(), code: match[2] ?? "" };
}

/** 教师清洗：去掉教务系统标记「主讲」用的星号，保留多位教师。 */
export function cleanTeacher(raw: string): string {
  return raw.replace(/\*/g, "").replace(/\s+/g, " ").trim();
}

/* -------------------------------------------------------------------------- */
/*                                  主解析                                     */
/* -------------------------------------------------------------------------- */

const TBODY_PATTERN = /<tbody\b[^>]*\bid\s*=\s*["']?courseTableBody["']?[^>]*>/i;
const CELL_PATTERN = /<td\b[^>]*\bid\s*=\s*["']?(\d{1,2})_(\d{1,3})["']?[^>]*>([\s\S]*?)<\/td>/gi;
const CLASS_DIV_PATTERN = /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bclass_div\b[^"']*["'][^>]*>/gi;

interface RawSlot extends TimetableSlot {
  courseName: string;
  courseCode: string;
  teacher: string;
}

/** 把课程表区域切成「一个课程块一个 chunk」；块内嵌套的 tools div 不会影响字段提取。 */
function splitCourseBlocks(cellHtml: string): string[] {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const match of cellHtml.matchAll(CLASS_DIV_PATTERN)) {
    starts.push(match.index ?? 0);
    ends.push((match.index ?? 0) + match[0].length);
  }
  if (starts.length === 0) return [];
  return starts.map((_, index) => {
    const from = ends[index] as number;
    const to = index + 1 < starts.length ? (starts[index + 1] as number) : cellHtml.length;
    return cellHtml.slice(from, to);
  });
}

function parseBlock(
  block: string,
  weekday: number,
  fallbackPeriod: number,
  warnings: string[],
): RawSlot | null {
  const rawName = firstParagraph(block, "p-kcm");
  if (!rawName) return null;
  const { name, code } = cleanCourseName(rawName);
  if (!name) return null;

  const grays = allParagraphs(block, "kcb_p_gray");
  let teacher = "";
  let weeks: number[] = [];
  let periodRange: { startPeriod: number; endPeriod: number } | null = null;

  for (const line of grays) {
    if (/周/.test(line) && /\d/.test(line)) {
      if (weeks.length === 0) weeks = parseWeeks(line);
      continue;
    }
    const range = parsePeriodRange(line);
    if (range) {
      periodRange = range;
      continue;
    }
    if (!teacher) teacher = cleanTeacher(line);
  }

  if (!periodRange) {
    // 假设 2 的兜底：没有 `x-y节` 文本时，用单元格自身的节次当起始节
    periodRange = { startPeriod: fallbackPeriod, endPeriod: fallbackPeriod };
  }
  if (weeks.length === 0) warnings.push(`「${name}」缺少周次信息，已按第 1 周处理`);
  const location = firstParagraph(block, "p-jxl") ?? "";

  return {
    courseName: name,
    courseCode: code,
    teacher,
    weekday,
    startPeriod: periodRange.startPeriod,
    endPeriod: periodRange.endPeriod,
    weeks: weeks.length > 0 ? weeks : [1],
    location,
  };
}

/**
 * 解析教务系统保存下来的课表 HTML。
 *
 * 永不抛异常：结构不对时返回空 courses + warnings，让导入预览能给出人话提示。
 */
export function parseTimetableHtml(html: string): ParsedTimetable {
  const warnings: string[] = [];
  const courses = new Map<string, ParsedCourse>();
  const stats = { cells: 0, courseCells: 0, slots: 0 };

  if (typeof html !== "string" || html.length === 0) {
    return { courses: [], warnings: ["文件是空的"], stats };
  }

  let region = html;
  const tbody = TBODY_PATTERN.exec(html);
  if (tbody) {
    const start = (tbody.index ?? 0) + tbody[0].length;
    const end = html.toLowerCase().indexOf("</tbody>", start);
    region = end === -1 ? html.slice(start) : html.slice(start, end);
  } else {
    warnings.push("没有找到 <tbody id=\"courseTableBody\">，已退化为扫描整页表格单元格");
  }

  const rawSlots: RawSlot[] = [];
  for (const cell of region.matchAll(CELL_PATTERN)) {
    const day = Number(cell[1]);
    const period = Number(cell[2]);
    const inner = cell[3] ?? "";
    if (day < 1 || day > 7) continue; // 表头 `0_x`
    stats.cells += 1;
    if (!/class_div/i.test(inner)) continue;
    stats.courseCells += 1;

    const blocks = splitCourseBlocks(inner);
    if (blocks.length === 0) {
      warnings.push(`第 ${day} 天第 ${period} 节的单元格有课程样式但没有 class_div 块`);
      continue;
    }
    for (const block of blocks) {
      const slot = parseBlock(block, day, period, warnings);
      if (slot) rawSlots.push(slot);
    }
  }

  for (const slot of rawSlots) {
    const key = slot.courseName;
    const existing = courses.get(key);
    const course: ParsedCourse = existing ?? {
      name: slot.courseName,
      code: slot.courseCode,
      teacher: slot.teacher,
      slots: [],
    };
    if (!course.code && slot.courseCode) course.code = slot.courseCode;
    if (!course.teacher && slot.teacher) course.teacher = slot.teacher;

    const duplicate = course.slots.some(
      (item) =>
        item.weekday === slot.weekday &&
        item.startPeriod === slot.startPeriod &&
        item.endPeriod === slot.endPeriod &&
        item.location === slot.location &&
        item.weeks.join(",") === slot.weeks.join(","),
    );
    if (!duplicate) {
      course.slots.push({
        weekday: slot.weekday,
        startPeriod: slot.startPeriod,
        endPeriod: slot.endPeriod,
        weeks: slot.weeks,
        location: slot.location,
      });
      stats.slots += 1;
    }
    courses.set(key, course);
  }

  const parsed = [...courses.values()].map((course) => ({
    ...course,
    slots: [...course.slots].sort(
      (left, right) =>
        left.weekday - right.weekday ||
        left.startPeriod - right.startPeriod ||
        (left.weeks[0] ?? 0) - (right.weeks[0] ?? 0),
    ),
  }));

  return { courses: parsed, warnings, stats };
}

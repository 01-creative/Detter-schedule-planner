import { uuidv7 } from "@detter/shared";
import type { Goal, Quadrant, Task, TaskInput } from "@detter/shared";

/**
 * 目标栏的纯规则：目标 → 任务、模板铺开、RRULE 人话、进度、排序。
 *
 * 全是纯函数（除了不写库），这样「拖目标建任务」「铺开模板」这类行为
 * 可以脱离浏览器手势被验证。
 */

export interface GoalDrop {
  quadrant: Quadrant;
  posX: number;
  posY: number;
}

/** 目标拖到象限 = 生成一条以目标标题命名的任务，并把它关联回目标。 */
export function buildGoalTaskInput(goal: Goal, drop: GoalDrop, now: number = Date.now()): TaskInput {
  return {
    id: uuidv7(now),
    title: goal.title,
    notes: "",
    status: "todo",
    quadrant: drop.quadrant,
    manualQuadrant: true,
    posX: Math.min(1, Math.max(0, drop.posX)),
    posY: Math.min(1, Math.max(0, drop.posY)),
    goalId: goal.id,
    source: "goal",
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 模板「铺开」要生成哪些任务：
 * 有里程碑就按里程碑拆，没有就只生成目标本身一条。
 */
export function templateTitles(goal: Goal): string[] {
  const titles = goal.milestones
    .map((milestone) => milestone.title.trim())
    .filter((title) => title.length > 0);
  return titles.length > 0 ? titles : [goal.title];
}

/**
 * 模板任务在自由模式下的初始位置：左上开始蛇形排，避免全部叠在中心。
 * 列表模式下这些坐标只是「以后切到自由模式时的记忆」。
 */
export function buildTemplateTaskInputs(
  goal: Goal,
  titles: readonly string[],
  quadrant: Quadrant,
  now: number = Date.now(),
): TaskInput[] {
  return titles.map((title, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    return {
      id: uuidv7(now + index),
      title,
      notes: "",
      status: "todo",
      quadrant,
      manualQuadrant: true,
      posX: [0.18, 0.5, 0.82][column] ?? 0.5,
      posY: Math.min(0.82, 0.18 + row * 0.26),
      goalId: goal.id,
      source: "template",
      sortIndex: index,
      createdAt: now + index,
      updatedAt: now + index,
    };
  });
}

/* -------------------------------------------------------------------------- */
/*                                 RRULE → 人话                                */
/* -------------------------------------------------------------------------- */

const WEEKDAY_LABEL: Record<string, string> = {
  MO: "一",
  TU: "二",
  WE: "三",
  TH: "四",
  FR: "五",
  SA: "六",
  SU: "日",
};

export function parseRruleParts(rrule: string): Map<string, string> {
  const parts = new Map<string, string>();
  for (const chunk of rrule.replace(/^RRULE:/i, "").split(";")) {
    const [key, value] = chunk.split("=");
    if (key && value) parts.set(key.trim().toUpperCase(), value.trim().toUpperCase());
  }
  return parts;
}

/** 例：FREQ=WEEKLY;BYDAY=MO,WE,FR → 每周一、三、五 */
export function describeRrule(rrule: string | null | undefined): string | null {
  if (!rrule) return null;
  const parts = parseRruleParts(rrule);
  const freq = parts.get("FREQ");
  const interval = Number(parts.get("INTERVAL") ?? "1") || 1;
  const count = parts.get("COUNT");

  let head: string;
  if (freq === "DAILY") {
    head = interval === 1 ? "每天" : `每 ${interval} 天`;
  } else if (freq === "WEEKLY") {
    const byday = parts.get("BYDAY");
    if (byday) {
      const days = byday
        .split(",")
        .map((day) => WEEKDAY_LABEL[day] ?? day)
        .join("、");
      head = interval === 1 ? `每周${days}` : `每 ${interval} 周的周${days}`;
    } else {
      head = interval === 1 ? "每周" : `每 ${interval} 周`;
    }
  } else if (freq === "MONTHLY") {
    const day = parts.get("BYMONTHDAY");
    head = day ? (interval === 1 ? `每月 ${day} 日` : `每 ${interval} 个月 ${day} 日`) : "每月";
  } else if (freq === "YEARLY") {
    head = "每年";
  } else {
    head = "按规则重复";
  }

  return count ? `${head} · 共 ${count} 次` : head;
}

/* -------------------------------------------------------------------------- */
/*                                   进度 / 排序                              */
/* -------------------------------------------------------------------------- */

export interface GoalTaskStats {
  total: number;
  done: number;
  /** 没有任务时返回 null，UI 显示「—」而不是 0% */
  ratio: number | null;
}

export function summarizeGoalTasks(tasks: readonly Task[]): GoalTaskStats {
  let done = 0;
  for (const task of tasks) {
    if (task.status === "done") done += 1;
  }
  return {
    total: tasks.length,
    done,
    ratio: tasks.length === 0 ? null : done / tasks.length,
  };
}

export function groupTasksByGoal(tasks: readonly Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.goalId) continue;
    const list = map.get(task.goalId);
    if (list) list.push(task);
    else map.set(task.goalId, [task]);
  }
  return map;
}

/** 同一个 tab 内按 sortIndex 升序；索引相同用创建时间兜底，保证顺序稳定。 */
export function sortGoals(goals: readonly Goal[]): Goal[] {
  return [...goals].sort(
    (a, b) => a.sortIndex - b.sortIndex || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
}

export function goalsOfKind(goals: readonly Goal[], kind: Goal["kind"]): Goal[] {
  return sortGoals(goals.filter((goal) => goal.kind === kind && goal.status !== "archived"));
}

/** 把 fromIndex 的条目移到 toIndex；越界或原位返回原顺序（不产生写操作）。 */
export function reorderGoals(goals: readonly Goal[], fromIndex: number, toIndex: number): Goal[] {
  const list = [...goals];
  const last = list.length - 1;
  if (last < 0) return list;
  const from = Math.max(0, Math.min(fromIndex, last));
  const to = Math.max(0, Math.min(toIndex, last));
  if (from === to) return list;
  const [moved] = list.splice(from, 1);
  if (!moved) return list;
  list.splice(to, 0, moved);
  return list;
}

export function withSortIndexes(goals: readonly Goal[]): Array<{ id: string; sortIndex: number }> {
  return goals.map((goal, index) => ({ id: goal.id, sortIndex: index }));
}

export function nextGoalSortIndex(goals: readonly Goal[]): number {
  return goals.reduce((max, goal) => Math.max(max, goal.sortIndex), -1) + 1;
}

/** 目标副标题：周期显示人话规则，一次性显示截止日，模板显示用过几次。 */
export function goalSubtitle(goal: Goal): string {
  if (goal.kind === "template") {
    return goal.usageCount > 0 ? `模板 · 已用 ${goal.usageCount} 次` : "模板 · 还没铺开过";
  }
  if (goal.kind === "recurring") {
    return `周期 · ${describeRrule(goal.rrule) ?? "未设置规则"}`;
  }
  if (goal.endDate) return `一次性 · 截止 ${goal.endDate}`;
  return "一次性 · 无截止日";
}

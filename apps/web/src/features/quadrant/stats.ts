import { isSameDay } from "@detter/shared";
import type { Quadrant, Task } from "@detter/shared";

/**
 * 首屏统计条的数字。
 *
 * 今日 / 逾期回答「今天要处理什么」，Q2 占比回答「有没有在做重要但不紧急的事」；
 * 四象限计数给平面四个角的标题用，保证标题上的数字和圆点始终一致。
 */
export interface BoardStats {
  /** 今天要处理（排期或截止在今天）且没完成 */
  today: number;
  /** 已经过了截止时间且没完成 */
  overdue: number;
  /** 未完成且落在 Q2 的任务占比，0–100 的整数；没有任务时为 0 */
  q2Share: number;
  /** 未完成总数 */
  open: number;
  /** 每个象限的未完成数（标题角标） */
  quadrants: Record<Quadrant, number>;
}

export function computeBoardStats(tasks: readonly Task[], now: number = Date.now()): BoardStats {
  let today = 0;
  let overdue = 0;
  let open = 0;
  let q2 = 0;
  const quadrants: Record<Quadrant, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };

  for (const task of tasks) {
    if (task.status === "done" || task.status === "dropped") continue;
    open += 1;
    quadrants[task.quadrant] += 1;
    if (task.quadrant === 2) q2 += 1;

    const when = task.dueAt ?? task.startAt;
    if (when !== null && isSameDay(when, now)) today += 1;
    if (task.dueAt !== null && task.dueAt < now) overdue += 1;
  }

  return {
    today,
    overdue,
    q2Share: open === 0 ? 0 : Math.round((q2 / open) * 100),
    open,
    quadrants,
  };
}

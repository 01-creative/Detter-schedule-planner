import { isSameDay } from "@detter/shared";
import type { Task } from "@detter/shared";

/**
 * 首屏统计条的三个数字。
 *
 * 刻意只留三个：今日要做多少、已经逾期多少、有多少时间落在 Q2（重要不紧急）。
 * 最后一个才是这个产品真正想推动的指标 —— Q2 占比越高，说明在「防火」而不是「救火」。
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
}

export function computeBoardStats(tasks: readonly Task[], now: number = Date.now()): BoardStats {
  let today = 0;
  let overdue = 0;
  let open = 0;
  let q2 = 0;

  for (const task of tasks) {
    if (task.status === "done" || task.status === "dropped") continue;
    open += 1;
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
  };
}

import type { EntityName } from "@detter/shared";
import type { SqlParam } from "./types";

/**
 * entity payload → 投影列。
 *
 * 设计取舍（与 0001_init.sql 一致）：payload JSON 是唯一事实来源，投影列只是索引骨架，
 * 写库时从 payload 派生、绝不让投影列反向影响 payload。这样 schema 演进只需要改 zod，
 * 投影列漏了只是查询变慢，不会丢数据。
 *
 * 列顺序必须与下方 VALUES 的占位符顺序一致（insertEntityStatement / updateEntityStatement 依赖它）。
 */
export const PROJECTION_COLUMNS: Record<EntityName, string[]> = {
  task: ["status", "quadrant", "kind", "goal_id", "start_at", "due_at", "completed_at"],
  goal: ["status", "kind", "sort_index"],
  inbox: ["status", "captured_at"],
  okr: ["period", "period_start", "status"],
  kr: ["okr_id"],
  kpi: ["sort_index"],
  kpiEntry: ["kpi_id", "date"],
  pomodoro: ["task_id", "started_at"],
  mindMap: ["goal_id"],
  mindNode: ["map_id", "parent_id"],
  course: ["archived", "goal_id"],
  assessment: ["course_id", "status", "kind", "due_at"],
  assignment: ["course_id", "week_no", "status", "due_at"],
  setting: ["key"],
};

type Payload = Record<string, unknown>;

/** 投影列只接受 SQLite 能绑定的标量；其余一律给安全默认值，宁可查询不准也不让写入失败。 */
function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : asText(value);
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : asNumber(value);
}

/** 按 PROJECTION_COLUMNS 的顺序产出绑定值。 */
export function projectValues(entity: EntityName, payload: Payload): SqlParam[] {
  const columns = PROJECTION_COLUMNS[entity];
  return columns.map((column) => projectValue(entity, column, payload));
}

function projectValue(entity: EntityName, column: string, payload: Payload): SqlParam {
  switch (entity) {
    case "task":
      if (column === "status") return asText(payload.status);
      if (column === "quadrant") return asNumber(payload.quadrant);
      if (column === "kind") return asText(payload.kind);
      if (column === "goal_id") return nullableText(payload.goalId);
      if (column === "start_at") return nullableNumber(payload.startAt);
      if (column === "due_at") return nullableNumber(payload.dueAt);
      if (column === "completed_at") return nullableNumber(payload.completedAt);
      return null;
    case "goal":
      if (column === "status") return asText(payload.status);
      if (column === "kind") return asText(payload.kind);
      if (column === "sort_index") return asNumber(payload.sortIndex);
      return null;
    case "inbox":
      if (column === "status") return asText(payload.status);
      if (column === "captured_at") return asNumber(payload.capturedAt);
      return null;
    case "okr":
      if (column === "period") return asText(payload.period);
      if (column === "period_start") return asText(payload.periodStart);
      if (column === "status") return asText(payload.status);
      return null;
    case "kr":
      return column === "okr_id" ? asText(payload.okrId) : null;
    case "kpi":
      return column === "sort_index" ? asNumber(payload.sortIndex) : null;
    case "kpiEntry":
      if (column === "kpi_id") return asText(payload.kpiId);
      if (column === "date") return asText(payload.date);
      return null;
    case "pomodoro":
      if (column === "task_id") return nullableText(payload.taskId);
      if (column === "started_at") return asNumber(payload.startedAt);
      return null;
    case "mindMap":
      return column === "goal_id" ? nullableText(payload.goalId) : null;
    case "mindNode":
      if (column === "map_id") return asText(payload.mapId);
      if (column === "parent_id") return nullableText(payload.parentId);
      return null;
    case "course":
      // archived 是布尔，投影成 0/1 才能直接进 WHERE
      if (column === "archived") return payload.archived === true ? 1 : 0;
      if (column === "goal_id") return nullableText(payload.goalId);
      return null;
    case "assessment":
      if (column === "course_id") return asText(payload.courseId);
      if (column === "status") return asText(payload.status);
      if (column === "kind") return asText(payload.kind);
      if (column === "due_at") return nullableNumber(payload.dueAt);
      return null;
    case "assignment":
      if (column === "course_id") return asText(payload.courseId);
      if (column === "week_no") return asNumber(payload.weekNo);
      if (column === "status") return asText(payload.status);
      if (column === "due_at") return nullableNumber(payload.dueAt);
      return null;
    case "setting":
      return column === "key" ? asText(payload.key) : null;
    default:
      return null;
  }
}

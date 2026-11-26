import {
  ASSESSMENT_KINDS,
  ASSESSMENT_STATUSES,
  ASSIGNMENT_STATUSES,
  ENTITY_SCHEMAS,
  ENTITY_TABLES,
  TASK_STATUSES,
} from "@detter/shared";
import type { EntityName } from "@detter/shared";
import type { Db, DbStatement, SqlParam } from "../db/types";
import { PROJECTION_COLUMNS, projectValues } from "../db/projections";
import { ApiError } from "../lib/errors";
import { uuidv7 } from "../lib/ids";

/**
 * 通用实体仓储。
 *
 * 一个函数服务 11 个实体：读写都以 payload JSON 为准，投影列只从 payload 派生。
 * 表名/列名全部来自 shared 的常量表（编译期字面量），值一律参数绑定——
 * 唯一被拼进 SQL 的字符串是这些常量，因此不存在注入面。
 */

export type EntityPayload = Record<string, unknown>;

export interface EntityRow {
  id: string;
  rev: number;
  deleted_at: number | null;
  updated_at: number;
  device_id: string;
  payload: string;
}

const COMMON_COLUMNS = ["id", "user_id", "rev", "deleted_at", "updated_at", "device_id"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

/* -------------------------------------------------------------------------- */
/*                              语句构造（写入路径）                            */
/* -------------------------------------------------------------------------- */

export function insertEntityStatement(
  entity: EntityName,
  userId: string,
  payload: EntityPayload,
): DbStatement {
  const table = ENTITY_TABLES[entity];
  const columns = [...COMMON_COLUMNS, ...PROJECTION_COLUMNS[entity], "payload"];
  const params: SqlParam[] = [
    String(payload.id),
    userId,
    Number(payload.rev ?? 0),
    nullableInt(payload.deletedAt),
    Number(payload.updatedAt ?? 0),
    String(payload.deviceId ?? ""),
    ...projectValues(entity, payload),
    JSON.stringify(payload),
  ];
  const placeholders = columns.map(() => "?").join(", ");
  return { sql: `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`, params };
}

export function updateEntityStatement(
  entity: EntityName,
  userId: string,
  payload: EntityPayload,
): DbStatement {
  const table = ENTITY_TABLES[entity];
  const assignments = [
    "rev = ?",
    "deleted_at = ?",
    "updated_at = ?",
    "device_id = ?",
    ...PROJECTION_COLUMNS[entity].map((column) => `${column} = ?`),
    "payload = ?",
  ];
  const params: SqlParam[] = [
    Number(payload.rev ?? 0),
    nullableInt(payload.deletedAt),
    Number(payload.updatedAt ?? 0),
    String(payload.deviceId ?? ""),
    ...projectValues(entity, payload),
    JSON.stringify(payload),
    String(payload.id),
    userId,
  ];
  return { sql: `UPDATE ${table} SET ${assignments.join(", ")} WHERE id = ? AND user_id = ?`, params };
}

/** 追加一条变更日志；墓碑的 payload 必须为 NULL（客户端据此判断删除）。 */
export function changeStatement(
  entity: EntityName,
  userId: string,
  entityId: string,
  rev: number,
  deleted: boolean,
  payload: EntityPayload | null,
  at: number,
): DbStatement {
  return {
    sql: "INSERT INTO changes (user_id, entity, entity_id, rev, deleted, payload, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    params: [userId, entity, entityId, rev, deleted ? 1 : 0, deleted || payload === null ? null : JSON.stringify(payload), at],
  };
}

/**
 * op_log（幂等表）。
 *
 * seq 用 last_insert_rowid() 而不是参数：同批次的前一条语句刚插 changes，
 * 这里取到的就是那条 changes 的 seq，避免再查一次 max(seq) 造成的并发歧义。
 */
export function opLogStatement(opId: string, userId: string, rev: number, at: number): DbStatement {
  return {
    sql: "INSERT INTO op_log (op_id, user_id, rev, seq, at) VALUES (?, ?, ?, last_insert_rowid(), ?)",
    params: [opId, userId, rev, at],
  };
}

/* -------------------------------------------------------------------------- */
/*                                读取 / 校验                                  */
/* -------------------------------------------------------------------------- */

export async function getEntityRow(
  db: Db,
  entity: EntityName,
  userId: string,
  id: string,
): Promise<EntityRow | null> {
  return db.first<EntityRow>(
    `SELECT id, rev, deleted_at, updated_at, device_id, payload FROM ${ENTITY_TABLES[entity]} WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
}

export async function readPayload(
  db: Db,
  entity: EntityName,
  userId: string,
  id: string,
  includeDeleted = false,
): Promise<EntityPayload | null> {
  const row = await getEntityRow(db, entity, userId, id);
  if (!row) return null;
  if (!includeDeleted && row.deleted_at !== null) return null;
  return JSON.parse(row.payload) as EntityPayload;
}

export type ValidationResult =
  | { ok: true; payload: EntityPayload }
  | { ok: false; path: string };

/**
 * 用契约里的 zod schema 校验。
 * setting.value 允许缺省（z.unknown() 不产生字段），这里补 null 以免投影出 undefined。
 */
export function validateEntity(entity: EntityName, candidate: Record<string, unknown>): ValidationResult {
  const input = entity === "setting" && !("value" in candidate) ? { ...candidate, value: null } : candidate;
  const result = ENTITY_SCHEMAS[entity].safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue && issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return { ok: false, path };
  }
  return { ok: true, payload: result.data as EntityPayload };
}

export function parseEntity(entity: EntityName, candidate: Record<string, unknown>): EntityPayload {
  const result = validateEntity(entity, candidate);
  if (!result.ok) {
    throw new ApiError("validation_error", `实体字段不合法：${result.path}`, { entity, path: result.path });
  }
  return result.payload;
}

/* -------------------------------------------------------------------------- */
/*                                  列表查询                                   */
/* -------------------------------------------------------------------------- */

export interface ListParams {
  limit: number;
  cursor?: string | null;
  includeDeleted?: boolean;
  /** 原始查询参数；只有白名单里的键会变成 SQL 条件。 */
  query?: Record<string, string | undefined>;
}

export const MAX_PAGE_SIZE = 500;

function parseCursor(cursor: string | null | undefined): { updatedAt: number; id: string } | null {
  if (!cursor) return null;
  const index = cursor.indexOf(":");
  if (index <= 0) return null;
  const updatedAt = Number(cursor.slice(0, index));
  const id = cursor.slice(index + 1);
  if (!Number.isFinite(updatedAt) || id.length === 0) return null;
  return { updatedAt, id };
}

function encodeCursor(payload: EntityPayload): string {
  return `${Number(payload.updatedAt ?? 0)}:${String(payload.id ?? "")}`;
}

function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** 把 "on"/"true"/"1" 都当成 true，其余 false；非法值不抛错，避免污染列表查询。 */
export function parseBoolean(raw: string | undefined): boolean {
  if (!raw) return false;
  return raw === "true" || raw === "1" || raw === "on";
}

interface FilterSet {
  conditions: string[];
  params: SqlParam[];
}

function assertEnum(value: string, allowed: readonly string[], field: string): string {
  if (!allowed.includes(value)) {
    throw new ApiError("validation_error", `${field} 取值不合法`, { field, value, allowed });
  }
  return value;
}

/**
 * 实体特有过滤。
 *
 * 每个 case 里出现的列名都是常量；`json_extract` 只用于没有投影列的字段（如 task.okrId），
 * 路径也是常量，故不存在注入面。
 */
function buildFilters(entity: EntityName, query: Record<string, string | undefined>): FilterSet {
  const conditions: string[] = [];
  const params: SqlParam[] = [];

  const text = (column: string, value: string | undefined): void => {
    if (value === undefined || value === "") return;
    conditions.push(`${column} = ?`);
    params.push(value);
  };

  const numeric = (column: string, value: string | undefined): void => {
    if (value === undefined || value === "") return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new ApiError("validation_error", `${column} 必须是数字`, { column, value });
    }
    conditions.push(`${column} = ?`);
    params.push(Math.trunc(parsed));
  };

  const jsonText = (path: string, value: string | undefined): void => {
    if (value === undefined || value === "") return;
    conditions.push(`json_extract(payload, '${path}') = ?`);
    params.push(value);
  };

  /** 毫秒时间戳区间（含边界）；空串等价于不传。 */
  const numericRange = (column: string, fromRaw: string | undefined, toRaw: string | undefined): void => {
    const parse = (value: string | undefined, label: string): number | null => {
      if (value === undefined || value === "") return null;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new ApiError("validation_error", `${label} 必须是毫秒时间戳`, { value });
      }
      return Math.trunc(parsed);
    };
    const from = parse(fromRaw, "from");
    const to = parse(toRaw, "to");
    if (from !== null) {
      conditions.push(`${column} >= ?`);
      params.push(from);
    }
    if (to !== null) {
      conditions.push(`${column} <= ?`);
      params.push(to);
    }
  };

  switch (entity) {
    case "task": {
      if (query.status !== undefined && query.status !== "") {
        assertEnum(query.status, TASK_STATUSES, "status");
        conditions.push("status = ?");
        params.push(query.status);
      }
      if (query.quadrant !== undefined && query.quadrant !== "") {
        const quadrant = Number(query.quadrant);
        if (![1, 2, 3, 4].includes(quadrant)) {
          throw new ApiError("validation_error", "quadrant 必须是 1..4");
        }
        conditions.push("quadrant = ?");
        params.push(quadrant);
      }
      text("goal_id", query.goalId);
      jsonText("$.okrId", query.okrId);
      jsonText("$.krId", query.krId);

      // from/to 命中 start_at 或 due_at 任一（事件看开始时间，截止任务看截止时间）
      const from = query.from === undefined || query.from === "" ? null : Number(query.from);
      const to = query.to === undefined || query.to === "" ? null : Number(query.to);
      if ((from !== null && !Number.isFinite(from)) || (to !== null && !Number.isFinite(to))) {
        throw new ApiError("validation_error", "from/to 必须是毫秒时间戳");
      }
      if (from !== null || to !== null) {
        const range = (column: string): string => {
          const parts: string[] = [];
          if (from !== null) parts.push(`${column} >= ?`);
          if (to !== null) parts.push(`${column} <= ?`);
          return `(${parts.join(" AND ")})`;
        };
        conditions.push(`(${range("start_at")} OR ${range("due_at")})`);
        if (from !== null) params.push(from);
        if (to !== null) params.push(to);
        if (from !== null) params.push(from);
        if (to !== null) params.push(to);
      }

      if (query.q !== undefined && query.q !== "") {
        conditions.push("json_extract(payload, '$.title') LIKE ? ESCAPE '\\'");
        params.push(`%${escapeLike(query.q)}%`);
      }
      break;
    }
    case "goal":
      text("status", query.status);
      text("kind", query.kind);
      break;
    case "inbox":
      text("status", query.status);
      break;
    case "okr":
      text("period", query.period);
      text("period_start", query.periodStart);
      text("status", query.status);
      break;
    case "kr":
      text("okr_id", query.okrId);
      break;
    case "kpi":
      jsonText("$.period", query.period);
      break;
    case "kpiEntry": {
      text("kpi_id", query.kpiId);
      // date 是 YYYY-MM-DD，字符串序即时间序
      if (query.from !== undefined && query.from !== "") {
        conditions.push("date >= ?");
        params.push(query.from);
      }
      if (query.to !== undefined && query.to !== "") {
        conditions.push("date <= ?");
        params.push(query.to);
      }
      break;
    }
    case "pomodoro":
      text("task_id", query.taskId);
      break;
    case "mindMap":
      text("goal_id", query.goalId);
      break;
    case "mindNode":
      text("map_id", query.mapId);
      text("parent_id", query.parentId);
      break;
    case "course": {
      // 归档是 0/1 投影列。三种语义：
      //   archived=true|false → 只看归档 / 只看在用
      //   includeArchived=true → 全都看（导出、审计场景）
      //   都不传 → 默认只看在用的课（与 list_courses / 页面一致）
      const archivedRaw = query.archived;
      if (archivedRaw !== undefined && archivedRaw !== "") {
        conditions.push("archived = ?");
        params.push(parseBoolean(archivedRaw) ? 1 : 0);
      } else if (!parseBoolean(query.includeArchived)) {
        conditions.push("archived = 0");
      }
      text("goal_id", query.goalId);
      if (query.q !== undefined && query.q !== "") {
        conditions.push("json_extract(payload, '$.name') LIKE ? ESCAPE '\\'");
        params.push(`%${escapeLike(query.q)}%`);
      }
      break;
    }
    case "assessment": {
      text("course_id", query.courseId);
      if (query.status !== undefined && query.status !== "") {
        assertEnum(query.status, ASSESSMENT_STATUSES, "status");
        conditions.push("status = ?");
        params.push(query.status);
      }
      if (query.kind !== undefined && query.kind !== "") {
        assertEnum(query.kind, ASSESSMENT_KINDS, "kind");
        conditions.push("kind = ?");
        params.push(query.kind);
      }
      numericRange("due_at", query.from, query.to);
      break;
    }
    case "assignment": {
      text("course_id", query.courseId);
      numeric("week_no", query.weekNo);
      if (query.status !== undefined && query.status !== "") {
        assertEnum(query.status, ASSIGNMENT_STATUSES, "status");
        conditions.push("status = ?");
        params.push(query.status);
      }
      numericRange("due_at", query.from, query.to);
      break;
    }
    case "setting":
      text("key", query.key);
      break;
    default:
      break;
  }

  return { conditions, params };
}

export async function listPayloads(
  db: Db,
  entity: EntityName,
  userId: string,
  params: ListParams,
): Promise<{ items: EntityPayload[]; nextCursor: string | null }> {
  const table = ENTITY_TABLES[entity];
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(params.limit)));

  const conditions: string[] = ["user_id = ?"];
  const values: SqlParam[] = [userId];
  if (!params.includeDeleted) conditions.push("deleted_at IS NULL");

  const filters = buildFilters(entity, params.query ?? {});
  conditions.push(...filters.conditions);
  values.push(...filters.params);

  const cursor = parseCursor(params.cursor);
  if (cursor) {
    // keyset 分页：比 OFFSET 稳定（并发写入不会导致重复/漏行）
    conditions.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
    values.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
  }

  values.push(limit);
  const rows = await db.all<{ payload: string }>(
    `SELECT payload FROM ${table} WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT ?`,
    values,
  );
  const items = rows.map((row) => JSON.parse(row.payload) as EntityPayload);
  const last = items[items.length - 1];
  const nextCursor = rows.length === limit && last ? encodeCursor(last) : null;
  return { items, nextCursor };
}

/* -------------------------------------------------------------------------- */
/*                                 写入路径                                    */
/* -------------------------------------------------------------------------- */

export interface CreateEntityInput {
  input: unknown;
  deviceId: string;
  now: number;
}

function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed|constraint failed: UNIQUE/i.test(message);
}

export async function createEntity(
  db: Db,
  entity: EntityName,
  userId: string,
  input: CreateEntityInput,
): Promise<EntityPayload> {
  const raw = isRecord(input.input) ? input.input : {};
  const providedId = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : null;

  const payload = parseEntity(entity, {
    ...raw,
    id: providedId ?? uuidv7(input.now),
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
    // REST 写入是服务端权威：rev 由服务端分配，客户端不能自带
    rev: 1,
    deviceId: input.deviceId,
  });

  try {
    await db.batch([
      insertEntityStatement(entity, userId, payload),
      changeStatement(entity, userId, String(payload.id), Number(payload.rev), false, payload, input.now),
    ]);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw ApiError.conflict("实体已存在", { entity, id: String(payload.id) });
    }
    throw error;
  }

  return payload;
}

export interface UpdateEntityOptions {
  /**
   * 允许更新墓碑行。
   * setting 用得到：唯一索引 (user_id, key) 覆盖墓碑，同名 key 重新 PUT 时只能复活那一行。
   */
  includeDeleted?: boolean;
}

export async function updateEntity(
  db: Db,
  entity: EntityName,
  userId: string,
  id: string,
  patch: unknown,
  now: number,
  options: UpdateEntityOptions = {},
): Promise<EntityPayload | null> {
  const row = await getEntityRow(db, entity, userId, id);
  if (!row) return null;
  if (row.deleted_at !== null && !options.includeDeleted) return null;

  const current = JSON.parse(row.payload) as EntityPayload;
  const patchObject = isRecord(patch) ? patch : {};
  const rev = Number(row.rev) + 1;

  const next = parseEntity(entity, {
    ...current,
    ...patchObject,
    id,
    createdAt: current.createdAt ?? now,
    deletedAt: null,
    updatedAt: now,
    rev,
    // 没带新 deviceId 就沿用原值：REST 改动的来源设备不影响 LWW 判定
    deviceId: typeof patchObject.deviceId === "string" ? patchObject.deviceId : row.device_id,
  });

  await db.batch([
    updateEntityStatement(entity, userId, next),
    changeStatement(entity, userId, id, rev, false, next, now),
  ]);

  return next;
}

export async function softDeleteEntity(
  db: Db,
  entity: EntityName,
  userId: string,
  id: string,
  now: number,
): Promise<EntityPayload | null> {
  const row = await getEntityRow(db, entity, userId, id);
  if (!row) return null;

  const current = JSON.parse(row.payload) as EntityPayload;
  if (row.deleted_at !== null) {
    // 幂等：已删除就返回现有墓碑，不产生新的 change
    return current;
  }

  const rev = Number(row.rev) + 1;
  const payload: EntityPayload = { ...current, id, rev, updatedAt: now, deletedAt: now };

  await db.batch([
    updateEntityStatement(entity, userId, payload),
    // 墓碑的 changes.payload 必须为 NULL，与同步协议的约定一致
    changeStatement(entity, userId, id, rev, true, null, now),
  ]);

  return payload;
}

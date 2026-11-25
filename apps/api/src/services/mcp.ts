import {
  GOAL_KINDS,
  GOAL_STATUSES,
  INBOX_STATUSES,
  OKR_PERIODS,
  TASK_KINDS,
  TASK_STATUSES,
  dayKey,
  endOfWeek,
  startOfWeek,
} from "@detter/shared";
import type { ApiScope, McpToolName } from "@detter/shared";
import { ZodError } from "zod";
import type { Db } from "../db/types";
import { ApiError } from "../lib/errors";
import { uuidv7 } from "../lib/ids";
import { hasScope } from "../auth/middleware";
import { createEntity, listPayloads, readPayload, softDeleteEntity, updateEntity } from "../repo/crud";
import {
  buildContextPack,
  captureToInbox,
  resolveDayEnd,
  resolveDayStart,
  summarizeKpis,
} from "./context";
import type { CaptureResult } from "./context";

/**
 * MCP 工具实现（JSON-RPC over HTTP，见 docs/architecture/06-AI-INTEGRATION.md §3）。
 *
 * 三条铁律：
 * 1. 所有读写都走 repo 层（createEntity / listPayloads / …），不在这里写第二套 SQL 写入逻辑；
 * 2. 每个工具声明自己需要 read 还是 write scope，`tools/call` 统一校验，调用方无法绕过；
 * 3. 写工具成功后统一写 `audit_log`（actor = apikey:<prefix>），单点记录，不分散在各 handler 里。
 *
 * 错误只返回人类可读的一句话（不含堆栈 / SQL），错误码：
 *   -32601 方法不存在、-32602 参数错误、-32000 业务错误（由 routes/mcp.ts 组装）。
 */

type JsonObject = Record<string, unknown>;

interface ToolOutcome {
  data: unknown;
  audit?: { entity: string; entityId?: string | null; extra?: JsonObject };
}

interface ToolInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export interface McpToolDef {
  name: McpToolName;
  description: string;
  inputSchema: ToolInputSchema;
  /** true → 需要 write scope 并写审计；false → 只需要 read */
  write: boolean;
  run: (ctx: McpCallContext, args: JsonObject) => Promise<ToolOutcome>;
}

export interface McpCallContext {
  db: Db;
  userId: string;
  scopes: ApiScope[];
  now: number;
  /** apikey:<8 位前缀>；MCP 只接受 API Key，所以这里不会是 session */
  actor: string;
  ip: string;
}

/* -------------------------------------------------------------------------- */
/*                              参数读取 / 错误                                 */
/* -------------------------------------------------------------------------- */

/** 参数错误与业务错误在服务层抛，transport 层负责翻成 JSON-RPC error。 */
export class McpRpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "McpRpcError";
    this.code = code;
  }
}

export const JSON_RPC_ERRORS = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  SERVER: -32000,
} as const;

function invalidParams(message: string): McpRpcError {
  return new McpRpcError(JSON_RPC_ERRORS.INVALID_PARAMS, message);
}

function hasArg(args: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(args, key) && args[key] !== undefined;
}

function requireStringArg(args: JsonObject, key: string, max = 500): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidParams(`缺少参数 ${key}（非空字符串）`);
  }
  if (value.length > max) throw invalidParams(`参数 ${key} 超过 ${max} 字符`);
  return value.trim();
}

function optionalStringArg(args: JsonObject, key: string, max = 500): string | null | undefined {
  if (!hasArg(args, key)) return undefined;
  const value = args[key];
  if (value === null) return null;
  if (typeof value !== "string") throw invalidParams(`参数 ${key} 必须是字符串`);
  if (value.length > max) throw invalidParams(`参数 ${key} 超过 ${max} 字符`);
  return value;
}

function optionalNumberArg(args: JsonObject, key: string): number | null | undefined {
  if (!hasArg(args, key)) return undefined;
  const value = args[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalidParams(`参数 ${key} 必须是数字（毫秒时间戳）`);
  }
  return Math.trunc(value);
}

function requireNumberArg(args: JsonObject, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalidParams(`缺少参数 ${key}（数字）`);
  }
  return value;
}

function optionalIntArg(
  args: JsonObject,
  key: string,
  min: number,
  max: number,
): number | undefined {
  if (!hasArg(args, key)) return undefined;
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalidParams(`参数 ${key} 必须是整数`);
  }
  const parsed = Math.trunc(value);
  if (parsed < min || parsed > max) throw invalidParams(`参数 ${key} 取值范围 ${min}..${max}`);
  return parsed;
}

function optionalBooleanArg(args: JsonObject, key: string): boolean | undefined {
  if (!hasArg(args, key)) return undefined;
  const value = args[key];
  if (typeof value !== "boolean") throw invalidParams(`参数 ${key} 必须是布尔值`);
  return value;
}

function optionalStringArrayArg(args: JsonObject, key: string): string[] | undefined {
  if (!hasArg(args, key)) return undefined;
  const value = args[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw invalidParams(`参数 ${key} 必须是字符串数组`);
  }
  return value as string[];
}

function optionalEnumArg<T extends string>(
  args: JsonObject,
  key: string,
  allowed: readonly T[],
): T | undefined {
  if (!hasArg(args, key)) return undefined;
  const value = args[key];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw invalidParams(`参数 ${key} 取值必须是：${allowed.join(" / ")}`);
  }
  return value as T;
}

function requireRecordArg(args: JsonObject, key: string): JsonObject {
  const value = args[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidParams(`参数 ${key} 必须是对象`);
  }
  return value as JsonObject;
}

function asRecordId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const id = (payload as JsonObject).id;
  return typeof id === "string" ? id : null;
}

/** 把任意异常收敛成 JSON-RPC 错误：业务错误 -32000，参数错误 -32602，其余 -32603。 */
export function toRpcError(error: unknown): McpRpcError {
  if (error instanceof McpRpcError) return error;
  if (error instanceof ApiError) {
    if (error.code === "validation_error") return invalidParams(error.message);
    return new McpRpcError(JSON_RPC_ERRORS.SERVER, error.message);
  }
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const path = issue && issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return invalidParams(`参数不合法：${path}`);
  }
  return new McpRpcError(JSON_RPC_ERRORS.INTERNAL, "工具执行失败");
}

/* -------------------------------------------------------------------------- */
/*                                  审计                                       */
/* -------------------------------------------------------------------------- */

const AUDIT_STRING_MAX = 120;

/** 审计只留「谁在什么时候对什么做了什么」，参数做截断，避免把长文本/隐私写进日志。 */
function summarizeArgs(args: JsonObject): JsonObject {
  const summary: JsonObject = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      summary[key] = value.length > AUDIT_STRING_MAX ? `${value.slice(0, AUDIT_STRING_MAX)}…` : value;
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      summary[key] = value;
    } else if (Array.isArray(value)) {
      summary[key] = value.slice(0, 10);
    } else if (typeof value === "object") {
      const text = JSON.stringify(value);
      summary[key] = text.length > AUDIT_STRING_MAX * 2 ? `${text.slice(0, AUDIT_STRING_MAX * 2)}…` : text;
    }
  }
  return summary;
}

async function recordAudit(
  ctx: McpCallContext,
  def: McpToolDef,
  args: JsonObject,
  outcome: ToolOutcome,
): Promise<void> {
  const audit = outcome.audit;
  const meta: JsonObject = { tool: def.name, args: summarizeArgs(args) };
  if (audit?.extra) Object.assign(meta, audit.extra);
  await ctx.db.run(
    `INSERT INTO audit_log (id, user_id, actor, action, entity, entity_id, ip, meta, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv7(ctx.now),
      ctx.userId,
      ctx.actor,
      `mcp.${def.name}`,
      audit?.entity ?? null,
      audit?.entityId ?? null,
      ctx.ip,
      JSON.stringify(meta),
      ctx.now,
    ],
  );
}

/* -------------------------------------------------------------------------- */
/*                              工具实现：任务                                  */
/* -------------------------------------------------------------------------- */

const MAX_LIST = 200;

async function handleListTasks(ctx: McpCallContext, args: JsonObject): Promise<ToolOutcome> {
  const query: Record<string, string | undefined> = {};
  const status = optionalEnumArg(args, "status", TASK_STATUSES);
  if (status) query.status = status;
  const quadrant = optionalIntArg(args, "quadrant", 1, 4);
  if (quadrant !== undefined) query.quadrant = String(quadrant);
  const from = optionalNumberArg(args, "from");
  if (from !== undefined && from !== null) query.from = String(from);
  const to = optionalNumberArg(args, "to");
  if (to !== undefined && to !== null) query.to = String(to);
  const goalId = optionalStringArg(args, "goalId", 200);
  if (goalId) query.goalId = goalId;

  const limit = optionalIntArg(args, "limit", 1, MAX_LIST) ?? 50;
  const { items } = await listPayloads(ctx.db, "task", ctx.userId, { limit, query });
  return { data: { items, count: items.length } };
}

async function handleGetTask(ctx: McpCallContext, args: JsonObject): Promise<ToolOutcome> {
  const id = requireStringArg(args, "id", 200);
  const task = await readPayload(ctx.db, "task", ctx.userId, id);
  if (!task) throw ApiError.notFound("任务不存在");
  return { data: task };
}

async function handleCreateTask(ctx: McpCallContext, args: JsonObject): Promise<ToolOutcome> {
  const title = requireStringArg(args, "title", 500);
  const input: JsonObject = { title, source: "ai", deviceId: "" };

  const quadrant = optionalIntArg(args, "quadrant", 1, 4);
  if (quadrant !== undefined) {
    input.quadrant = quadrant;
    input.manualQuadrant = true;
  }
  for (const key of ["startAt", "endAt", "dueAt"] as const) {
    const value = optionalNumberArg(args, key);
    if (value !== undefined) input[key] = value;
  }
  const notes = optionalStringArg(args, "notes", 20_000);
  if (notes !== undefined) input.notes = notes;
  const location = optionalStringArg(args, "location", 200);
  if (location !== undefined) input.location = location;
  const goalId = optionalStringArg(args, "goalId", 200);
  if (goalId !== undefined) input.goalId = goalId;
  const tags = optionalStringArrayArg(args, "tags");
  if (tags !== undefined) input.tags = tags.slice(0, 20);
  const kind = optionalEnumArg(args, "kind", TASK_KINDS);
  if (kind) input.kind = kind;
  const estimateMin = optionalIntArg(args, "estimateMin", 0, 100_000);
  if (estimateMin !== undefined) input.estimateMin = estimateMin;
  const allDay = optionalBooleanArg(args, "allDay");
  if (allDay !== undefined) input.allDay = allDay;

  const task = await createEntity(ctx.db, "task", ctx.userId, {
    input,
    deviceId: "",
    now: ctx.now,
  });
  return {
    data: task,
    audit: { entity: "task", entityId: asRecordId(task), extra: { title } },
  };
}

async function handleUpdateTask(ctx: McpCallContext, args: JsonObject): Promise<ToolOutcome> {
  const id = requireStringArg(args, "id", 200);
  const patch: JsonObject = {};

  const title = optionalStringArg(args, "title", 500);
  if (title !== undefined && title !== null) patch.title = title;
  const notes = optionalStringArg(args, "notes", 20_000);
  if (notes !== undefined) patch.notes = notes;
  const status = optionalEnumArg(args, "status", TASK_STATUSES);
  if (status) patch.status = status;
  const quadrant = optionalIntArg(args, "quadrant", 1, 4);
  if (quadrant !== undefined) {
    patch.quadrant = quadrant;
    patch.manualQuadrant = true;
  }
  for (const key of ["startAt", "endAt", "dueAt"] as const) {
    const value = optionalNumberArg(args, key);
    if (value !== undefined) patch[key] = value;
  }
  const goalId = optionalStringArg(args, "goalId", 200);
  if (goalId !== undefined) patch.goalId = goalId;
  const tags = optionalStringArrayArg(args, "tags");
  if (tags !== undefined) patch.tags = tags.slice(0, 20);
  const estimateMin = optionalIntArg(args, "estimateMin", 0, 100_000);
  if (estimateMin !== undefined) patch.estimateMin = estimateMin;
  const pinned = optionalBooleanArg(args, "pinned");
  if (pinned !== undefined) patch.pinned = pinned;

  if (Object.keys(patch).length === 0) {
    throw invalidParams("update_task 至少要提供一个要修改的字段");
  }
  if (status === "done" && patch.completedAt === undefined) patch.completedAt = ctx.now;

  const task = await updateEntity(ctx.db, "task", ctx.userId, id, patch, ctx.now);
  if (!task) throw ApiError.notFound("任务不存在");
  return { data: task, audit: { entity: "task", entityId: id } };
}

async function handleCompleteTask(ctx: McpCallContext, args: JsonObject): Promise<ToolOutcome> {
  const id = requireStringArg(args, "id", 200);
  const current = await readPayload(ctx.db, "task", ctx.userId, id);
  if (!current) throw ApiError.notFound("任务不存在");
  if (current.status === "done") {
    return { data: current, audit: { entity: "task", entityId: id } };
  }
  const task = await updateEntity(
    ctx.db,
    "task",
    ctx.userId,
    id,
    { status: "done", completedAt: ctx.now },
    ctx.now,
  );
  if (!task) throw ApiError.notFound("任务不存在");
  return { data: task, audit: { entity: "task", entityId: id } };
}

async function handleDeleteTask(ctx: McpCallContext, args: JsonObject): Promise<ToolOutcome> {
  const id = requireStringArg(args, "id", 200);
  const task = await softDeleteEntity(ctx.db, "task", ctx.userId, id, ctx.now);
  if (!task) throw ApiError.notFound("任务不存在");
  return { data: { id, deletedAt: task.deletedAt ?? ctx.now }, audit: { entity: "task", entityId: id } };
}

/* -------------------------------------------------------------------------- */
/*                              工具实现：目标                                  */
/* -------------------------------------------------------------------------- */

async function handleListGoals(ctx: McpCallContext, args: JsonObject): Promise<ToolOutcome> {
  const query: Record<string, string | undefined> = {};
  const status = optionalEnumArg(args, "status", GOAL_STATUSES);
  if (status) query.status = status;
  const kind = optionalEnumArg(args, "kind", GOAL_KINDS);
  if (kind) query.kind = kind;

  const { items } = await listPayloads(ctx.db, "goal", ctx.userId, { limit: 100, query });
  return { data: { items, count: items.length } };
}

async function handleCreateGoal(ctx: McpCallContext, args: JsonObject): Promise<ToolOutcome> {
  const title = requireStringArg(args, "title", 200);
  const input: JsonObject = { title, deviceId: "" };
  const kind = optionalEnumArg(args, "kind", GOAL_KINDS);
  if (kind) input.kind = kind;
  const horizon = optionalEnumArg(args, "horizon", ["none", "week", "month", "quarter", "year"] as const);
  if (horizon) input.horizon = horizon;
  const rrule = optionalStringArg(args, "rrule", 500);
  if (rrule !== undefined) input.rrule = rrule;
  const description = optionalStringArg(args, "description", 2000);
  if (description !== undefined) input.description = description;

  const goal = await createEntity(ctx.db, "goal", ctx.userId, {
    input,
    deviceId: "",
    now: ctx.now,
  });
  return { data: goal, audit: { entity: "goal", entityId: asRecordId(goal), extra: { title } } };
}

async function handleUpdateGoal(ctx: McpCallContext, args: JsonObject): Promise<ToolOutcome> {
  const id = requireStringArg(args, "id", 200);
  const patch: JsonObject = {};

  const title = optionalStringArg(args, "title", 200);
  if (title !== undefined && title !== null) patch.title = title;
  const description = optionalStringArg(args, "description", 2000);
  if (description !== undefined) patch.description = description;
  const status = optionalEnumArg(args, "status", GOAL_STATUSES);
  if (status) patch.status = status;
  const horizon = optionalEnumArg(args, "horizon", ["none", "week", "month", "quarter", "year"] as const);
  if (horizon) patch.horizon = horizon;
  const rrule = optionalStringArg(args, "rrule", 500);
  if (rrule !== undefined) patch.rrule = rrule;

  if (hasArg(args, "milestones")) {
    const raw = args.milestones;
    if (!Array.isArray(raw)) throw invalidParams("参数 milestones 必须是数组");
    patch.milestones = raw.map((item, index) => {
      if (typeof item !== "object" || item === null) {
        throw invalidParams(`milestones[${index}] 必须是对象`);
      }
      const record = item as JsonObject;
      const milestoneTitle = optionalStringArg(record, "title", 200);
      if (!milestoneTitle) throw invalidParams(`milestones[${index}].title 不能为空`);
      return {
        id: typeof record.id === "string" ? record.id : uuidv7(ctx.now),
        title: milestoneTitle,
        done: optionalBooleanArg(record, "done") ?? false,
      };
    });
  }

  if (Object.keys(patch).length === 0) {
    throw invalidParams("update_goal 至少要提供一个要修改的字段");
  }

  const goal = await updateEntity(ctx.db, "goal", ctx.userId, id, patch, ctx.now);
  if (!goal) throw ApiError.notFound("目标不存在");
  return { data: goal, audit: { entity: "goal", entityId: id } };
}

/* -------------------------------------------------------------------------- */
/*                          工具实现：捕获 / 收件箱                              */
/* -------------------------------------------------------------------------- */

async function handleCapture(ctx: McpCallContext, args: JsonObject): Promise<ToolOutcome> {
  const text = requireStringArg(args, "text", 4000);
  const result: CaptureResult = await captureToInbox(ctx.db, ctx.userId, {
    text,
    source: "ai",
    now: ctx.now,
  });
  return {
    data: result,
    audit: {
      entity: "inbox",
      entityId: result.inboxId,
      extra: { suggestions: result.suggestions.length },
    },
  };
}

async function handleListInbox(ctx: McpCallContext, args: JsonObject): Promise<ToolOutcome> {
  const status = optionalEnumArg(args, "status", INBOX_STATUSES) ?? "pending";
  const { items } = await listPayloads(ctx.db, "inbox", ctx.userId, {
    limit: 100,
    query: { status },
  });
  return { data: { items, count: items.length } };
}

async function handleTriageInbox(ctx: McpCallContext, args: JsonObject): Promise<ToolOutcome> {
  const id = requireStringArg(args, "id", 200);
  const item = await readPayload(ctx.db, "inbox", ctx.userId, id);
  if (!item) throw ApiError.notFound("收件箱条目不存在");
  if (item.status === "triaged") throw new McpRpcError(JSON_RPC_ERRORS.SERVER, "该条目已经分诊过");

  const patch = hasArg(args, "patch") ? requireRecordArg(args, "patch") : {};
  const draft =
    typeof item.parsed === "object" && item.parsed !== null ? (item.parsed as JsonObject) : {};

  const pickNullableString = (key: string, fallback: unknown): string | null => {
    const value = optionalStringArg(patch, key, 20_000);
    if (value !== undefined) return value;
    return typeof fallback === "string" ? fallback : null;
  };
  const pickNullableNumber = (key: string, fallback: unknown): number | null => {
    const value = optionalNumberArg(patch, key);
    if (value !== undefined) return value;
    return typeof fallback === "number" && Number.isFinite(fallback) ? fallback : null;
  };

  const title =
    (optionalStringArg(patch, "title", 500) ?? "").length > 0
      ? (optionalStringArg(patch, "title", 500) as string)
      : typeof draft.title === "string" && draft.title.length > 0
        ? draft.title
        : String(item.rawText ?? "未命名");

  const quadrant =
    optionalIntArg(patch, "quadrant", 1, 4) ??
    (typeof draft.quadrantGuess === "number" ? Math.min(4, Math.max(1, Math.trunc(draft.quadrantGuess))) : 2);

  const taskInput: JsonObject = {
    title,
    notes: pickNullableString("notes", draft.notes) ?? "",
    startAt: pickNullableNumber("startAt", draft.startAt),
    endAt: pickNullableNumber("endAt", draft.endAt),
    dueAt: pickNullableNumber("dueAt", draft.dueAt),
    allDay: optionalBooleanArg(patch, "allDay") ?? draft.allDay === true,
    quadrant,
    manualQuadrant: true,
    tags: optionalStringArrayArg(patch, "tags") ?? (Array.isArray(draft.tags) ? draft.tags : []),
    goalId: pickNullableString("goalId", draft.goalId),
    source: "capture",
    deviceId: "",
  };

  const task = await createEntity(ctx.db, "task", ctx.userId, {
    input: taskInput,
    deviceId: "",
    now: ctx.now,
  });
  await updateEntity(ctx.db, "inbox", ctx.userId, id, { status: "triaged", taskId: task.id }, ctx.now);

  return {
    data: { inboxId: id, task },
    audit: { entity: "inbox", entityId: id, extra: { taskId: asRecordId(task) } },
  };
}

/* -------------------------------------------------------------------------- */
/*                           工具实现：OKR / KPI                               */
/* -------------------------------------------------------------------------- */

async function handleGetOkr(ctx: McpCallContext, args: JsonObject): Promise<ToolOutcome> {
  const query: Record<string, string | undefined> = { status: "active" };
  const period = optionalEnumArg(args, "period", OKR_PERIODS);
  if (period) query.period = period;
  const periodStart = optionalStringArg(args, "periodStart", 40);
  if (periodStart) query.periodStart = periodStart;

  const { items } = await listPayloads(ctx.db, "okr", ctx.userId, { limit: 20, query });
  const ids = items.map((item) => String(item.id));
  const krRows = ids.length
    ? await ctx.db.all<{ payload: string }>(
        `SELECT payload FROM key_results
          WHERE user_id = ? AND deleted_at IS NULL AND okr_id IN (${ids.map(() => "?").join(", ")})
          ORDER BY json_extract(payload, '$.sortIndex') ASC, updated_at ASC`,
        [ctx.userId, ...ids],
      )
    : [];
  const krsByOkr = new Map<string, JsonObject[]>();
  for (const row of krRows) {
    const kr = JSON.parse(row.payload) as JsonObject;
    const okrId = String(kr.okrId ?? "");
    const list = krsByOkr.get(okrId) ?? [];
    list.push(kr);
    krsByOkr.set(okrId, list);
  }

  const objectives = items.map((okr) => ({
    ...okr,
    // 文档里 OKR 的自然语言名字段叫 objective；实体 schema 用 title，这里两者都给
    objective: typeof okr.title === "string" ? okr.title : "",
    krs: krsByOkr.get(String(okr.id)) ?? [],
  }));
  return { data: { objectives, count: objectives.length } };
}

async function handleSetKeyResult(ctx: McpCallContext, args: JsonObject): Promise<ToolOutcome> {
  const krId = requireStringArg(args, "krId", 200);
  const currentValue = requireNumberArg(args, "currentValue");
  const current = await readPayload(ctx.db, "kr", ctx.userId, krId);
  if (!current) throw ApiError.notFound("关键结果不存在");

  const kr = await updateEntity(ctx.db, "kr", ctx.userId, krId, { currentValue }, ctx.now);
  if (!kr) throw ApiError.notFound("关键结果不存在");
  return { data: kr, audit: { entity: "kr", entityId: krId } };
}

function resolveDateKey(raw: unknown, now: number): string {
  if (typeof raw === "number" && Number.isFinite(raw)) return dayKey(Math.trunc(raw));
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (raw === undefined || raw === null) return dayKey(now);
  throw invalidParams("参数 date 必须是毫秒时间戳或 YYYY-MM-DD");
}

async function handleLogKpi(ctx: McpCallContext, args: JsonObject): Promise<ToolOutcome> {
  const kpiId = requireStringArg(args, "kpiId", 200);
  const value = requireNumberArg(args, "value");
  const kpi = await readPayload(ctx.db, "kpi", ctx.userId, kpiId);
  if (!kpi) throw ApiError.notFound("KPI 不存在");

  const date = resolveDateKey(args.date, ctx.now);
  const note = optionalStringArg(args, "note", 500) ?? "";
  const entry = await createEntity(ctx.db, "kpiEntry", ctx.userId, {
    input: { kpiId, date, value, note, source: "manual", deviceId: "" },
    deviceId: "",
    now: ctx.now,
  });
  return {
    data: { entry, kpi: { id: kpiId, name: kpi.name ?? "" } },
    audit: { entity: "kpiEntry", entityId: asRecordId(entry), extra: { kpiId, date } },
  };
}

async function handleGetKpiSummary(ctx: McpCallContext, args: JsonObject): Promise<ToolOutcome> {
  const fromRaw = optionalNumberArg(args, "from");
  const toRaw = optionalNumberArg(args, "to");
  const start = fromRaw ?? startOfWeek(ctx.now);
  const end = toRaw ?? endOfWeek(ctx.now);
  if (start > end) throw invalidParams("参数 from 必须早于 to");

  const items = await summarizeKpis(ctx.db, ctx.userId, { start, end });
  return {
    data: {
      from: start,
      to: end,
      periodLabel: `${dayKey(start)} ~ ${dayKey(end)}`,
      items,
      count: items.length,
    },
  };
}

/* -------------------------------------------------------------------------- */
/*                          工具实现：日程 / 上下文                              */
/* -------------------------------------------------------------------------- */

function resolveAgendaDay(raw: unknown, now: number): number {
  if (raw === undefined || raw === null) return resolveDayStart(now, now);
  if (typeof raw === "number" && Number.isFinite(raw)) return resolveDayStart(raw, now);
  if (typeof raw === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return resolveDayStart(raw, now);
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return resolveDayStart(parsed, now);
  }
  throw invalidParams("参数 date 必须是毫秒时间戳或 YYYY-MM-DD");
}

async function handleGetAgenda(ctx: McpCallContext, args: JsonObject): Promise<ToolOutcome> {
  const dayStart = resolveAgendaDay(args.date, ctx.now);
  const dayEnd = resolveDayEnd(dayStart);
  const { items } = await listPayloads(ctx.db, "task", ctx.userId, {
    limit: MAX_LIST,
    query: { from: String(dayStart), to: String(dayEnd) },
  });
  const tasks = items
    .filter((task) => task.status !== "dropped")
    .sort((left, right) => {
      const a = Number(left.startAt ?? left.dueAt ?? 0);
      const b = Number(right.startAt ?? right.dueAt ?? 0);
      return a - b;
    });
  return { data: { date: dayKey(dayStart), items: tasks, count: tasks.length } };
}

async function handleGetContextPack(ctx: McpCallContext, args: JsonObject): Promise<ToolOutcome> {
  const range = optionalEnumArg(args, "range", ["today", "week", "month", "quarter"] as const) ?? "week";
  const pack = await buildContextPack(ctx.db, ctx.userId, { range, now: ctx.now });
  return { data: pack };
}

/* -------------------------------------------------------------------------- */
/*                              工具实现：搜索                                  */
/* -------------------------------------------------------------------------- */

function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (match) => `\\${match}`);
}

async function handleSearch(ctx: McpCallContext, args: JsonObject): Promise<ToolOutcome> {
  const q = requireStringArg(args, "q", 200);
  const limit = optionalIntArg(args, "limit", 1, 50) ?? 20;
  const pattern = `%${escapeLike(q)}%`;

  const taskRows = await ctx.db.all<{ payload: string }>(
    `SELECT payload FROM tasks
      WHERE user_id = ? AND deleted_at IS NULL
        AND (json_extract(payload, '$.title') LIKE ? ESCAPE '\\'
          OR json_extract(payload, '$.notes') LIKE ? ESCAPE '\\')
      ORDER BY updated_at DESC LIMIT ?`,
    [ctx.userId, pattern, pattern, limit],
  );
  const goalRows = await ctx.db.all<{ payload: string }>(
    `SELECT payload FROM goals
      WHERE user_id = ? AND deleted_at IS NULL AND json_extract(payload, '$.title') LIKE ? ESCAPE '\\'
      ORDER BY updated_at DESC LIMIT ?`,
    [ctx.userId, pattern, limit],
  );
  const inboxRows = await ctx.db.all<{ payload: string }>(
    `SELECT payload FROM inbox_items
      WHERE user_id = ? AND deleted_at IS NULL AND json_extract(payload, '$.rawText') LIKE ? ESCAPE '\\'
      ORDER BY captured_at DESC LIMIT ?`,
    [ctx.userId, pattern, limit],
  );

  const parse = (rows: Array<{ payload: string }>): unknown[] =>
    rows.map((row) => JSON.parse(row.payload) as unknown);
  const tasks = parse(taskRows);
  const goals = parse(goalRows);
  const inbox = parse(inboxRows);

  return {
    data: {
      query: q,
      tasks,
      goals,
      inbox,
      counts: { tasks: tasks.length, goals: goals.length, inbox: inbox.length },
    },
  };
}

/* -------------------------------------------------------------------------- */
/*                              工具清单 / 调用                                 */
/* -------------------------------------------------------------------------- */

const TIME_NOTE = "时间参数一律用毫秒时间戳（本地时区 Asia/Shanghai）";

function schema(properties: Record<string, unknown>, required?: string[]): ToolInputSchema {
  return required ? { type: "object", properties, required } : { type: "object", properties };
}

const str = (description: string): Record<string, unknown> => ({ type: "string", description });
const num = (description: string): Record<string, unknown> => ({ type: "number", description });
const int = (description: string, minimum?: number, maximum?: number): Record<string, unknown> => ({
  type: "integer",
  description,
  ...(minimum === undefined ? {} : { minimum }),
  ...(maximum === undefined ? {} : { maximum }),
});
const bool = (description: string): Record<string, unknown> => ({ type: "boolean", description });
const strArray = (description: string): Record<string, unknown> => ({
  type: "array",
  items: { type: "string" },
  description,
});
const oneOf = (values: readonly string[], description: string): Record<string, unknown> => ({
  type: "string",
  enum: [...values],
  description,
});

const ID_DESC = "实体 ID（uuidv7 字符串）";
const QUADRANT_DESC = "四象限：1=重要且紧急，2=重要不紧急，3=紧急不重要，4=不重要不紧急";

export const MCP_TOOL_DEFS: McpToolDef[] = [
  {
    name: "list_tasks",
    description: `查询任务列表。${TIME_NOTE}。from/to 命中任务的开始时间或截止时间；不传 status 时包含全部状态（含已完成）。`,
    write: false,
    inputSchema: schema({
      from: num("起始时间，毫秒时间戳（含）"),
      to: num("结束时间，毫秒时间戳（含）"),
      status: oneOf(TASK_STATUSES, "任务状态"),
      quadrant: int(QUADRANT_DESC, 1, 4),
      goalId: str("按关联目标过滤"),
      limit: int("最多返回多少条，默认 50", 1, MAX_LIST),
    }),
    run: handleListTasks,
  },
  {
    name: "get_task",
    description: "按 ID 查询一条任务的完整详情。",
    write: false,
    inputSchema: schema({ id: str(ID_DESC) }, ["id"]),
    run: handleGetTask,
  },
  {
    name: "create_task",
    description: `在 Detter 中创建一条任务。${TIME_NOTE}。${QUADRANT_DESC}。不传 quadrant 时默认 Q2。`,
    write: true,
    inputSchema: schema(
      {
        title: str("任务标题，必填"),
        quadrant: int(QUADRANT_DESC, 1, 4),
        startAt: num("开始时间，毫秒时间戳"),
        endAt: num("结束时间，毫秒时间戳"),
        dueAt: num("截止时间，毫秒时间戳"),
        goalId: str("关联的目标 ID"),
        tags: strArray("标签，如 [\"作业\",\"高数\"]"),
        notes: str("备注"),
        kind: oneOf(TASK_KINDS, "task=待办，event=日程事件"),
        estimateMin: int("预计耗时（分钟）", 0, 100_000),
        allDay: bool("是否全天"),
        location: str("地点"),
      },
      ["title"],
    ),
    run: handleCreateTask,
  },
  {
    name: "update_task",
    description: `修改任务。只传要改的字段。${TIME_NOTE}。status=done 时会自动写完成时间。`,
    write: true,
    inputSchema: schema(
      {
        id: str(ID_DESC),
        title: str("新标题"),
        quadrant: int(QUADRANT_DESC, 1, 4),
        status: oneOf(TASK_STATUSES, "新状态"),
        startAt: num("开始时间，毫秒时间戳，null 表示清空"),
        endAt: num("结束时间，毫秒时间戳，null 表示清空"),
        dueAt: num("截止时间，毫秒时间戳，null 表示清空"),
        goalId: str("关联目标 ID，null 表示取消关联"),
        tags: strArray("标签（整体替换）"),
        notes: str("备注（整体替换）"),
        estimateMin: int("预计耗时（分钟）", 0, 100_000),
        pinned: bool("是否置顶"),
      },
      ["id"],
    ),
    run: handleUpdateTask,
  },
  {
    name: "complete_task",
    description: "把任务标记为已完成（幂等）。",
    write: true,
    inputSchema: schema({ id: str(ID_DESC) }, ["id"]),
    run: handleCompleteTask,
  },
  {
    name: "delete_task",
    description: "软删除任务（保留变更记录，可被同步恢复）。",
    write: true,
    inputSchema: schema({ id: str(ID_DESC) }, ["id"]),
    run: handleDeleteTask,
  },
  {
    name: "list_goals",
    description: "查询目标列表，可按状态与类型过滤。",
    write: false,
    inputSchema: schema({
      status: oneOf(GOAL_STATUSES, "目标状态"),
      kind: oneOf(GOAL_KINDS, "目标类型：once=一次性，recurring=周期，template=模板"),
    }),
    run: handleListGoals,
  },
  {
    name: "create_goal",
    description: "创建一个目标（默认一次性、进行中）。",
    write: true,
    inputSchema: schema(
      {
        title: str("目标标题，必填"),
        kind: oneOf(GOAL_KINDS, "目标类型"),
        horizon: oneOf(["none", "week", "month", "quarter", "year"] as const, "时间跨度"),
        rrule: str("周期规则（RFC5545），如 FREQ=WEEKLY;BYDAY=MO"),
        description: str("目标描述"),
      },
      ["title"],
    ),
    run: handleCreateGoal,
  },
  {
    name: "update_goal",
    description: "修改目标。只传要改的字段；milestones 是整体替换。",
    write: true,
    inputSchema: schema(
      {
        id: str(ID_DESC),
        title: str("新标题"),
        description: str("新描述"),
        status: oneOf(GOAL_STATUSES, "新状态"),
        horizon: oneOf(["none", "week", "month", "quarter", "year"] as const, "时间跨度"),
        rrule: str("周期规则（RFC5545）"),
        milestones: {
          type: "array",
          description: "里程碑列表（整体替换）",
          items: {
            type: "object",
            properties: { title: str("里程碑标题"), done: bool("是否完成") },
            required: ["title"],
          },
        },
      },
      ["id"],
    ),
    run: handleUpdateGoal,
  },
  {
    name: "capture",
    description:
      "快速捕获：把一句自然语言（如「明天下午3点 交高数作业 #作业」）解析后放进收件箱。返回解析草稿与可能关联的目标，不会直接创建任务。",
    write: true,
    inputSchema: schema({ text: str("要捕获的自然语言文本，1~4000 字") }, ["text"]),
    run: handleCapture,
  },
  {
    name: "list_inbox",
    description: "查询收件箱条目（默认只看待分诊 pending）。",
    write: false,
    inputSchema: schema({ status: oneOf(INBOX_STATUSES, "收件箱状态") }),
    run: handleListInbox,
  },
  {
    name: "triage_inbox",
    description:
      "把收件箱条目分诊成任务：用条目解析结果作为默认值，patch 可覆盖 title/quadrant/时间/标签/目标。成功后条目状态变为 triaged。",
    write: true,
    inputSchema: schema(
      {
        id: str("收件箱条目 ID"),
        patch: {
          type: "object",
          description: "覆盖解析结果的字段（可选）",
          properties: {
            title: str("任务标题"),
            quadrant: int(QUADRANT_DESC, 1, 4),
            startAt: num("开始时间，毫秒时间戳"),
            endAt: num("结束时间，毫秒时间戳"),
            dueAt: num("截止时间，毫秒时间戳"),
            allDay: bool("是否全天"),
            tags: strArray("标签"),
            goalId: str("关联目标 ID"),
            notes: str("备注"),
          },
        },
      },
      ["id"],
    ),
    run: handleTriageInbox,
  },
  {
    name: "get_okr",
    description: "查询进行中的 OKR 及其关键结果（KR）。",
    write: false,
    inputSchema: schema({
      period: oneOf(OKR_PERIODS, "周期类型"),
      periodStart: str("周期起始日 YYYY-MM-DD"),
    }),
    run: handleGetOkr,
  },
  {
    name: "set_key_result",
    description: "更新关键结果（KR）的当前值，进度由服务端按 startValue/targetValue 计算。",
    write: true,
    inputSchema: schema({ krId: str("关键结果 ID"), currentValue: num("新的当前值") }, ["krId", "currentValue"]),
    run: handleSetKeyResult,
  },
  {
    name: "log_kpi",
    description: "给某个 KPI 打卡记录一个值。date 省略时记到今天。",
    write: true,
    inputSchema: schema(
      {
        kpiId: str("KPI ID"),
        value: num("数值"),
        date: { type: ["string", "number"], description: "日期 YYYY-MM-DD 或毫秒时间戳，默认今天" },
        note: str("备注"),
      },
      ["kpiId", "value"],
    ),
    run: handleLogKpi,
  },
  {
    name: "get_kpi_summary",
    description: `查询 KPI 汇总与达成率。${TIME_NOTE}。from/to 省略时默认本周。`,
    write: false,
    inputSchema: schema({
      from: num("起始时间，毫秒时间戳"),
      to: num("结束时间，毫秒时间戳"),
    }),
    run: handleGetKpiSummary,
  },
  {
    name: "get_agenda",
    description: "查询某一天的日程（默认今天），按开始时间排序。date 用毫秒时间戳或 YYYY-MM-DD。",
    write: false,
    inputSchema: schema({
      date: { type: ["string", "number"], description: "日期：毫秒时间戳或 YYYY-MM-DD，默认今天" },
    }),
    run: handleGetAgenda,
  },
  {
    name: "get_context_pack",
    description:
      "获取上下文包：区间内的任务、目标、OKR、KPI、番茄钟、收件箱与规则生成的 briefing。适合「帮我看看这周」这类整体分析。",
    write: false,
    inputSchema: schema({
      range: oneOf(["today", "week", "month", "quarter"] as const, "区间，默认 week"),
    }),
    run: handleGetContextPack,
  },
  {
    name: "search",
    description: "全局搜索任务标题/备注、目标标题、收件箱原文。",
    write: false,
    inputSchema: schema(
      {
        q: str("关键词"),
        limit: int("每类最多返回多少条，默认 20", 1, 50),
      },
      ["q"],
    ),
    run: handleSearch,
  },
];

const TOOL_MAP = new Map<string, McpToolDef>(MCP_TOOL_DEFS.map((def) => [def.name, def]));

/** MCP 协议只认识 name / description / inputSchema，`write` 是我们的内部字段。 */
export function listMcpTools(): Array<{ name: string; description: string; inputSchema: ToolInputSchema }> {
  return MCP_TOOL_DEFS.map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
  }));
}

/**
 * 执行一次 tools/call。
 *
 * scope 校验 → 执行 → 写审计 → 返回结构化数据；任何异常都会被收敛成 McpRpcError。
 */
export async function callMcpTool(
  ctx: McpCallContext,
  name: string,
  rawArguments: unknown,
): Promise<unknown> {
  const def = TOOL_MAP.get(name);
  if (!def) throw invalidParams(`未知工具：${name}`);

  const requiredScope: ApiScope = def.write ? "write" : "read";
  if (!hasScope(ctx.scopes, requiredScope)) {
    throw new McpRpcError(
      JSON_RPC_ERRORS.SERVER,
      `该 API Key 缺少 ${requiredScope} scope，无法调用 ${name}`,
    );
  }

  if (rawArguments !== undefined && rawArguments !== null) {
    if (typeof rawArguments !== "object" || Array.isArray(rawArguments)) {
      throw invalidParams("params.arguments 必须是对象");
    }
  }
  const args = (rawArguments ?? {}) as JsonObject;

  let outcome: ToolOutcome;
  try {
    outcome = await def.run(ctx, args);
  } catch (error) {
    const rpcError = toRpcError(error);
    // 不把堆栈写进响应；只在服务端日志留一行，便于排查的是哪个工具
    if (rpcError.code === JSON_RPC_ERRORS.INTERNAL) {
      console.error(
        JSON.stringify({
          mcp: true,
          tool: def.name,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        }),
      );
    }
    throw rpcError;
  }

  if (def.write) {
    try {
      await recordAudit(ctx, def, args, outcome);
    } catch (error) {
      // 审计失败不应让已经成功的写操作看起来失败，但必须能在日志里看到
      console.error(
        JSON.stringify({
          mcp: true,
          tool: def.name,
          error: `audit failed: ${error instanceof Error ? error.message : String(error)}`,
        }),
      );
    }
  }

  return outcome.data;
}

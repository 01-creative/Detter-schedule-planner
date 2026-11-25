import { z } from "zod";
import { CaptureSourceSchema, KpiPeriodSchema, OkrPeriodSchema, QuadrantSchema, TASK_STATUSES } from "./entities.ts";

/**
 * HTTP / MCP 接口契约（v1）。
 *
 * 所有响应统一信封：
 *   成功 { ok: true,  data: T }
 *   失败 { ok: false, error: { code, message, details? } }
 *
 * 认证：
 *   - 浏览器：httpOnly Cookie 会话（登录后由服务端下发）
 *   - 机器/agent：Authorization: Bearer dtk_xxx（API Key，带 scope）
 *   - 二者都通过后，请求上下文里得到唯一的 owner 身份（本项目为单用户）
 */

/* -------------------------------------------------------------------------- */
/*                                  错误码                                     */
/* -------------------------------------------------------------------------- */

export const API_ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_error",
  "conflict",
  "rate_limited",
  "payload_too_large",
  "unsupported_media_type",
  "internal_error",
  "not_configured",
  "setup_required",
  "already_initialized",
  "csrf_failed",
  "scope_insufficient",
] as const;

export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
}

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiErrorBody };

/* -------------------------------------------------------------------------- */
/*                                  认证                                       */
/* -------------------------------------------------------------------------- */

export const SetupRequestSchema = z.object({
  /** 首次部署时由服务端打印到日志/环境变量的一次性口令 */
  setupToken: z.string().min(8),
  /** 主密码，至少 10 位 */
  password: z.string().min(10).max(200),
  /** 设备名，用于设备列表 */
  deviceName: z.string().max(80).default("第一台设备"),
});
export type SetupRequest = z.infer<typeof SetupRequestSchema>;

export const LoginRequestSchema = z.object({
  password: z.string().min(1).max(200),
  deviceName: z.string().max(80).default("浏览器"),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const AuthStatusSchema = z.object({
  initialized: z.boolean(),
  authenticated: z.boolean(),
  /** 当前会话绑定的设备 ID */
  deviceId: z.string().nullable(),
  /** 通过 API Key 访问时为该 Key 的 scope */
  scopes: z.array(z.enum(["read", "write", "admin"])).default([]),
  serverTime: z.number().int(),
  version: z.string(),
});
export type AuthStatus = z.infer<typeof AuthStatusSchema>;

/* -------------------------------------------------------------------------- */
/*                                   API Key                                   */
/* -------------------------------------------------------------------------- */

export const API_SCOPES = ["read", "write", "admin"] as const;
export const ApiScopeSchema = z.enum(API_SCOPES);
export type ApiScope = z.infer<typeof ApiScopeSchema>;

export const ApiKeyCreateSchema = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(ApiScopeSchema).min(1).default(["read"]),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});
export type ApiKeyCreate = z.infer<typeof ApiKeyCreateSchema>;

/** 只在创建时返回一次明文密钥 */
export const ApiKeyCreatedSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  plaintext: z.string(),
  scopes: z.array(ApiScopeSchema),
  expiresAt: z.number().int().nullable(),
});
export type ApiKeyCreated = z.infer<typeof ApiKeyCreatedSchema>;

export const ApiKeyInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(ApiScopeSchema),
  createdAt: z.number().int(),
  lastUsedAt: z.number().int().nullable(),
  expiresAt: z.number().int().nullable(),
  revokedAt: z.number().int().nullable(),
});
export type ApiKeyInfo = z.infer<typeof ApiKeyInfoSchema>;

/* -------------------------------------------------------------------------- */
/*                                  查询参数                                    */
/* -------------------------------------------------------------------------- */

export const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().optional(),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

export const TaskQuerySchema = z.object({
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  quadrant: QuadrantSchema.optional(),
  goalId: z.string().optional(),
  okrId: z.string().optional(),
  q: z.string().max(200).optional(),
  includeDeleted: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  /** keyset 分页游标（服务端返回的 nextCursor） */
  cursor: z.string().optional(),
});
export type TaskQuery = z.infer<typeof TaskQuerySchema>;

/** 列表统一响应：{ items, nextCursor }。所有 collection 的 GET 都返回它。 */
export function listResponseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable().default(null),
  });
}

export const OkrQuerySchema = z.object({
  period: OkrPeriodSchema.optional(),
  periodStart: z.string().optional(),
  status: z.enum(["active", "closed"]).optional(),
});
export type OkrQuery = z.infer<typeof OkrQuerySchema>;

export const KpiQuerySchema = z.object({
  period: KpiPeriodSchema.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export type KpiQuery = z.infer<typeof KpiQuerySchema>;

/* -------------------------------------------------------------------------- */
/*                                  快速捕获                                    */
/* -------------------------------------------------------------------------- */

export const CaptureRequestSchema = z.object({
  text: z.string().min(1).max(4000),
  source: CaptureSourceSchema.default("manual"),
  /** 客户端已解析的结果（离线时先本地解析），服务端会用同一套解析器校验 */
  draft: z.unknown().optional(),
});
export type CaptureRequest = z.infer<typeof CaptureRequestSchema>;

export const CaptureResponseSchema = z.object({
  inboxId: z.string(),
  draft: z.unknown(),
  /** 与已知目标/标签的匹配建议 */
  suggestions: z
    .array(
      z.object({
        goalId: z.string(),
        goalTitle: z.string(),
        score: z.number(),
      }),
    )
    .default([]),
});
export type CaptureResponse = z.infer<typeof CaptureResponseSchema>;

/* -------------------------------------------------------------------------- */
/*                                  AI 上下文包                                 */
/* -------------------------------------------------------------------------- */

export const CONTEXT_RANGES = ["today", "week", "month", "quarter"] as const;
export const ContextRangeSchema = z.enum(CONTEXT_RANGES);
export type ContextRange = z.infer<typeof ContextRangeSchema>;

export const ContextPackQuerySchema = z.object({
  range: ContextRangeSchema.default("week"),
  format: z.enum(["markdown", "json"]).default("json"),
  include: z
    .array(z.enum(["tasks", "goals", "okr", "kpi", "pomodoro", "inbox", "mindmap"]))
    .default(["tasks", "goals", "okr", "kpi", "pomodoro", "inbox"]),
});
export type ContextPackQuery = z.infer<typeof ContextPackQuerySchema>;

/**
 * 供外部 AI / agent 使用的上下文包。
 * 设计原则：宁可多给语义，也不要让模型去猜字段含义。
 */
export const ContextPackSchema = z.object({
  generatedAt: z.number().int(),
  range: ContextRangeSchema,
  period: z.object({ start: z.number().int(), end: z.number().int(), label: z.string() }),
  profile: z.object({
    displayName: z.string().default(""),
    timezone: z.string().default("Asia/Shanghai"),
    quadrantScheme: z.string().default("eisenhower"),
  }),
  tasks: z.array(z.unknown()).default([]),
  goals: z.array(z.unknown()).default([]),
  okr: z.array(z.unknown()).default([]),
  kpis: z.array(z.unknown()).default([]),
  pomodoro: z
    .object({ sessions: z.number().int(), focusMinutes: z.number().int() })
    .default({ sessions: 0, focusMinutes: 0 }),
  inbox: z.array(z.unknown()).default([]),
  stats: z.record(z.number()).default({}),
  /** 给模型的自然语言摘要与操作提示 */
  briefing: z.string().default(""),
});
export type ContextPack = z.infer<typeof ContextPackSchema>;

/* -------------------------------------------------------------------------- */
/*                                     MCP                                     */
/* -------------------------------------------------------------------------- */

/** MCP 暴露的工具名（与 docs/architecture/06-AI-INTEGRATION.md 保持一致） */
export const MCP_TOOLS = [
  "list_tasks",
  "get_task",
  "create_task",
  "update_task",
  "complete_task",
  "delete_task",
  "list_goals",
  "create_goal",
  "update_goal",
  "capture",
  "list_inbox",
  "triage_inbox",
  "get_okr",
  "set_key_result",
  "log_kpi",
  "get_kpi_summary",
  "get_agenda",
  "get_context_pack",
  "search",
] as const;
export type McpToolName = (typeof MCP_TOOLS)[number];

/* -------------------------------------------------------------------------- */
/*                                  健康检查                                    */
/* -------------------------------------------------------------------------- */

export const HealthSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  time: z.number().int(),
  runtime: z.enum(["workers", "node"]),
  db: z.enum(["ok", "error"]),
});
export type Health = z.infer<typeof HealthSchema>;

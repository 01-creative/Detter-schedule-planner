import { z } from "zod";

/**
 * Detter 领域模型（唯一事实来源）。
 *
 * 前后端、同步协议、AI 接口全部以本文件的 zod schema 为准。
 * 修改本文件 = 修改契约，必须同步更新 docs/architecture/01-DATA-MODEL.md。
 *
 * 通用约定：
 * - 所有时间戳为「毫秒整数」，语义为本地时间；
 * - 所有同步实体都带 id / createdAt / updatedAt / rev / deletedAt / deviceId；
 * - 删除一律软删除（deletedAt 置为时间戳），保证离线设备能收到墓碑并干净地删掉本地数据。
 */

/* -------------------------------------------------------------------------- */
/*                                 基础类型                                    */
/* -------------------------------------------------------------------------- */

export const QUADRANTS = [1, 2, 3, 4] as const;
export type Quadrant = (typeof QUADRANTS)[number];
export const QuadrantSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export const TASK_KINDS = ["task", "event"] as const;
export const TaskKindSchema = z.enum(TASK_KINDS);
export type TaskKind = z.infer<typeof TaskKindSchema>;

export const TASK_STATUSES = ["inbox", "todo", "doing", "done", "dropped"] as const;
export const TaskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TASK_SOURCES = ["manual", "capture", "ai", "import", "goal", "template"] as const;
export const TaskSourceSchema = z.enum(TASK_SOURCES);
export type TaskSource = z.infer<typeof TaskSourceSchema>;

export const GOAL_KINDS = ["once", "recurring", "template"] as const;
export const GoalKindSchema = z.enum(GOAL_KINDS);
export type GoalKind = z.infer<typeof GoalKindSchema>;

export const GOAL_STATUSES = ["active", "paused", "done", "archived"] as const;
export const GoalStatusSchema = z.enum(GOAL_STATUSES);
export type GoalStatus = z.infer<typeof GoalStatusSchema>;

export const HORIZONS = ["none", "week", "month", "quarter", "year"] as const;
export const HorizonSchema = z.enum(HORIZONS);
export type Horizon = z.infer<typeof HorizonSchema>;

export const CAPTURE_SOURCES = ["hotkey", "share", "mobile", "ai", "api", "manual"] as const;
export const CaptureSourceSchema = z.enum(CAPTURE_SOURCES);
export type CaptureSource = z.infer<typeof CaptureSourceSchema>;

export const INBOX_STATUSES = ["pending", "triaged", "archived"] as const;
export const InboxStatusSchema = z.enum(INBOX_STATUSES);
export type InboxStatus = z.infer<typeof InboxStatusSchema>;

export const OKR_PERIODS = ["week", "month", "quarter", "year"] as const;
export const OkrPeriodSchema = z.enum(OKR_PERIODS);
export type OkrPeriod = z.infer<typeof OkrPeriodSchema>;

export const KR_METRIC_TYPES = ["percent", "number", "boolean", "milestone"] as const;
export const KrMetricTypeSchema = z.enum(KR_METRIC_TYPES);
export type KrMetricType = z.infer<typeof KrMetricTypeSchema>;

export const KPI_PERIODS = ["day", "week", "month"] as const;
export const KpiPeriodSchema = z.enum(KPI_PERIODS);
export type KpiPeriod = z.infer<typeof KpiPeriodSchema>;

export const KPI_AGGREGATIONS = ["sum", "count", "max", "avg", "last"] as const;
export const KpiAggregationSchema = z.enum(KPI_AGGREGATIONS);
export type KpiAggregation = z.infer<typeof KpiAggregationSchema>;

export const KPI_AUTO_SOURCES = ["pomodoro_min", "focus_sessions", "tasks_done"] as const;
export const KpiAutoSourceSchema = z.enum(KPI_AUTO_SOURCES);
export type KpiAutoSource = z.infer<typeof KpiAutoSourceSchema>;

export const POMODORO_KINDS = ["focus", "short_break", "long_break"] as const;
export const PomodoroKindSchema = z.enum(POMODORO_KINDS);
export type PomodoroKind = z.infer<typeof PomodoroKindSchema>;

export const MIND_NODE_KINDS = ["idea", "goal", "task", "kr", "note"] as const;
export const MindNodeKindSchema = z.enum(MIND_NODE_KINDS);
export type MindNodeKind = z.infer<typeof MindNodeKindSchema>;

/* -------------------------------------------------------------------------- */
/*                                 同步基座                                    */
/* -------------------------------------------------------------------------- */

/** 所有可同步实体的公共字段。 */
export const baseEntityShape = {
  id: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  /** 软删除时间；null 表示存活 */
  deletedAt: z.number().int().nonnegative().nullable().default(null),
  /** 乐观并发版本号，由服务端递增 */
  rev: z.number().int().nonnegative().default(0),
  /** 最后一次写入的设备 ID，用于冲突判定与排查 */
  deviceId: z.string().default(""),
};

export const BaseEntitySchema = z.object(baseEntityShape);
export type BaseEntity = z.infer<typeof BaseEntitySchema>;

/* -------------------------------------------------------------------------- */
/*                                   Task                                      */
/* -------------------------------------------------------------------------- */

export const ChecklistItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  done: z.boolean().default(false),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

/**
 * Task 同时承担「待办」与「日程事件」两种角色：
 * - kind = "task" ：有完成态，进四象限 / 收件箱；
 * - kind = "event"：时间块（上课、会议、出行），到点即算过去，不要求打卡；
 * 二者共享时间字段与重复规则，因此日历和四象限可以用同一套数据。
 */
export const TaskSchema = z.object({
  ...baseEntityShape,
  title: z.string().min(1).max(500),
  notes: z.string().default(""),
  kind: TaskKindSchema.default("task"),
  status: TaskStatusSchema.default("todo"),
  quadrant: QuadrantSchema.default(2),
  /** 手工锁定象限后，不再由重要/紧急推导 */
  manualQuadrant: z.boolean().default(false),
  importance: z.number().int().min(1).max(5).nullable().default(null),
  urgency: z.number().int().min(1).max(5).nullable().default(null),
  /** 象限内相对坐标 0..1（0,0 = 左上） */
  posX: z.number().min(0).max(1).default(0.5),
  posY: z.number().min(0).max(1).default(0.5),
  goalId: z.string().nullable().default(null),
  okrId: z.string().nullable().default(null),
  krId: z.string().nullable().default(null),
  startAt: z.number().int().nullable().default(null),
  endAt: z.number().int().nullable().default(null),
  allDay: z.boolean().default(false),
  dueAt: z.number().int().nullable().default(null),
  /** 提前多少分钟提醒（相对 startAt 或 dueAt） */
  remindOffsets: z.array(z.number().int().min(0)).default([0]),
  /** 已经触发过的提醒时间点，避免重复推送 */
  remindedAt: z.array(z.number().int()).default([]),
  location: z.string().default(""),
  url: z.string().default(""),
  tags: z.array(z.string()).default([]),
  estimateMin: z.number().int().min(0).nullable().default(null),
  actualMin: z.number().int().min(0).default(0),
  /** 重复系列：父任务 ID（该系列的第一条） */
  recurrenceId: z.string().nullable().default(null),
  /** RFC5545 RRULE，例：FREQ=WEEKLY;BYDAY=MO */
  rrule: z.string().nullable().default(null),
  /** 重复实例的原始时间点，用于识别“这一次” */
  occurrenceKey: z.string().nullable().default(null),
  checklist: z.array(ChecklistItemSchema).default([]),
  source: TaskSourceSchema.default("manual"),
  completedAt: z.number().int().nullable().default(null),
  pinned: z.boolean().default(false),
  sortIndex: z.number().default(0),
});
export type Task = z.infer<typeof TaskSchema>;
export type TaskInput = z.input<typeof TaskSchema>;

/** 拖拽到象限时只需要这几个字段 */
export const TaskDropPatchSchema = TaskSchema.pick({
  quadrant: true,
  posX: true,
  posY: true,
  manualQuadrant: true,
}).partial();
export type TaskDropPatch = z.infer<typeof TaskDropPatchSchema>;

/* -------------------------------------------------------------------------- */
/*                                   Goal                                      */
/* -------------------------------------------------------------------------- */

export const MilestoneSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean().default(false),
});
export type Milestone = z.infer<typeof MilestoneSchema>;

/**
 * 右侧目标栏的一条目标。三种形态：
 * - once      ：一次性目标（“9月前搞定驾照”）
 * - recurring ：周期性目标（“每周三次健身”），带 rrule
 * - template  ：模板，平时收在“模板库”里，需要时一键铺成任务
 */
export const GoalSchema = z.object({
  ...baseEntityShape,
  title: z.string().min(1).max(200),
  description: z.string().default(""),
  kind: GoalKindSchema.default("once"),
  status: GoalStatusSchema.default("active"),
  horizon: HorizonSchema.default("none"),
  color: z.string().default("#6366F1"),
  icon: z.string().default("target"),
  rrule: z.string().nullable().default(null),
  startDate: z.string().nullable().default(null),
  endDate: z.string().nullable().default(null),
  milestones: z.array(MilestoneSchema).default([]),
  okrId: z.string().nullable().default(null),
  krId: z.string().nullable().default(null),
  /** 模板被使用次数，用于“常用优先”排序 */
  usageCount: z.number().int().min(0).default(0),
  lastUsedAt: z.number().int().nullable().default(null),
  sortIndex: z.number().default(0),
  archivedAt: z.number().int().nullable().default(null),
});
export type Goal = z.infer<typeof GoalSchema>;
export type GoalInput = z.input<typeof GoalSchema>;

/* -------------------------------------------------------------------------- */
/*                              快速捕获 / 收件箱                               */
/* -------------------------------------------------------------------------- */

/**
 * 自然语言解析出的草稿。解析是「尽力而为」：
 * 解析器只给出建议，用户确认后才会落库成 Task。
 */
export const ParsedDraftSchema = z.object({
  title: z.string().default(""),
  notes: z.string().default(""),
  startAt: z.number().int().nullable().default(null),
  endAt: z.number().int().nullable().default(null),
  dueAt: z.number().int().nullable().default(null),
  allDay: z.boolean().default(false),
  durationMin: z.number().int().min(0).nullable().default(null),
  quadrantGuess: QuadrantSchema.nullable().default(null),
  tags: z.array(z.string()).default([]),
  goalId: z.string().nullable().default(null),
  goalTitle: z.string().nullable().default(null),
  location: z.string().default(""),
  rrule: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0),
  /** 命中的原文片段，用于 UI 高亮 */
  matches: z
    .array(
      z.object({
        kind: z.enum(["date", "time", "duration", "tag", "goal", "quadrant", "location", "recurrence"]),
        text: z.string(),
        start: z.number().int(),
        end: z.number().int(),
      }),
    )
    .default([]),
});
export type ParsedDraft = z.infer<typeof ParsedDraftSchema>;

export const InboxItemSchema = z.object({
  ...baseEntityShape,
  rawText: z.string().min(1),
  source: CaptureSourceSchema.default("manual"),
  status: InboxStatusSchema.default("pending"),
  parsed: ParsedDraftSchema.nullable().default(null),
  /** 分诊后生成的任务 ID */
  taskId: z.string().nullable().default(null),
  capturedAt: z.number().int(),
});
export type InboxItem = z.infer<typeof InboxItemSchema>;
export type InboxItemInput = z.input<typeof InboxItemSchema>;

/* -------------------------------------------------------------------------- */
/*                                    OKR                                      */
/* -------------------------------------------------------------------------- */

export const OkrSchema = z.object({
  ...baseEntityShape,
  title: z.string().min(1).max(300),
  description: z.string().default(""),
  period: OkrPeriodSchema.default("week"),
  /** 周期起始日 YYYY-MM-DD，与 period 共同确定唯一周期 */
  periodStart: z.string(),
  periodEnd: z.string(),
  status: z.enum(["active", "closed"]).default("active"),
  color: z.string().default("#8B5CF6"),
  sortIndex: z.number().default(0),
});
export type Okr = z.infer<typeof OkrSchema>;
export type OkrInput = z.input<typeof OkrSchema>;

export const KeyResultSchema = z.object({
  ...baseEntityShape,
  okrId: z.string(),
  title: z.string().min(1).max(300),
  metricType: KrMetricTypeSchema.default("percent"),
  startValue: z.number().default(0),
  targetValue: z.number().default(100),
  currentValue: z.number().default(0),
  unit: z.string().default("%"),
  /** 关联的目标（Goal），KR 进度可由此聚合 */
  linkedGoalIds: z.array(z.string()).default([]),
  /** 关联的任务，完成任务可自动推进进度 */
  linkedTaskIds: z.array(z.string()).default([]),
  sortIndex: z.number().default(0),
});
export type KeyResult = z.infer<typeof KeyResultSchema>;
export type KeyResultInput = z.input<typeof KeyResultSchema>;

/* -------------------------------------------------------------------------- */
/*                                    KPI                                      */
/* -------------------------------------------------------------------------- */

export const KpiSchema = z.object({
  ...baseEntityShape,
  name: z.string().min(1).max(120),
  unit: z.string().default("次"),
  direction: z.enum(["up", "down"]).default("up"),
  targetValue: z.number().default(0),
  period: KpiPeriodSchema.default("week"),
  aggregation: KpiAggregationSchema.default("sum"),
  /** 自动从番茄钟/任务完成聚合，null 表示手工打卡 */
  autoSource: KpiAutoSourceSchema.nullable().default(null),
  color: z.string().default("#0EA5E9"),
  icon: z.string().default("activity"),
  active: z.boolean().default(true),
  sortIndex: z.number().default(0),
});
export type Kpi = z.infer<typeof KpiSchema>;
export type KpiInput = z.input<typeof KpiSchema>;

export const KpiEntrySchema = z.object({
  ...baseEntityShape,
  kpiId: z.string(),
  /** YYYY-MM-DD */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.number(),
  note: z.string().default(""),
  source: z.enum(["manual", "auto"]).default("manual"),
});
export type KpiEntry = z.infer<typeof KpiEntrySchema>;
export type KpiEntryInput = z.input<typeof KpiEntrySchema>;

/* -------------------------------------------------------------------------- */
/*                                  番茄钟                                     */
/* -------------------------------------------------------------------------- */

export const PomodoroSessionSchema = z.object({
  ...baseEntityShape,
  taskId: z.string().nullable().default(null),
  kind: PomodoroKindSchema.default("focus"),
  startedAt: z.number().int(),
  endedAt: z.number().int().nullable().default(null),
  /** 计划时长（分钟） */
  planMin: z.number().int().min(1).default(25),
  /** 实际专注时长（分钟），中断后按累计计算 */
  actualMin: z.number().int().min(0).default(0),
  completed: z.boolean().default(false),
  interruptions: z.number().int().min(0).default(0),
  note: z.string().default(""),
});
export type PomodoroSession = z.infer<typeof PomodoroSessionSchema>;
export type PomodoroSessionInput = z.input<typeof PomodoroSessionSchema>;

/* -------------------------------------------------------------------------- */
/*                                 思维导图                                    */
/* -------------------------------------------------------------------------- */

export const MindMapSchema = z.object({
  ...baseEntityShape,
  title: z.string().min(1).max(200),
  goalId: z.string().nullable().default(null),
  viewportX: z.number().default(0),
  viewportY: z.number().default(0),
  viewportZoom: z.number().min(0.1).max(3).default(1),
});
export type MindMap = z.infer<typeof MindMapSchema>;
export type MindMapInput = z.input<typeof MindMapSchema>;

export const MindNodeSchema = z.object({
  ...baseEntityShape,
  mapId: z.string(),
  parentId: z.string().nullable().default(null),
  text: z.string().default(""),
  /** 画布绝对坐标（px） */
  x: z.number().default(0),
  y: z.number().default(0),
  kind: MindNodeKindSchema.default("idea"),
  /** kind=goal/task/kr 时指向的实体 */
  refId: z.string().nullable().default(null),
  color: z.string().nullable().default(null),
  collapsed: z.boolean().default(false),
  sortIndex: z.number().default(0),
});
export type MindNode = z.infer<typeof MindNodeSchema>;
export type MindNodeInput = z.input<typeof MindNodeSchema>;

/* -------------------------------------------------------------------------- */
/*                             设置 / 设备 / 提醒                               */
/* -------------------------------------------------------------------------- */

export const SettingSchema = z.object({
  ...baseEntityShape,
  key: z.string().min(1),
  value: z.unknown(),
});
export type Setting = z.infer<typeof SettingSchema>;

export const DeviceSchema = z.object({
  id: z.string(),
  name: z.string().default("未命名设备"),
  platform: z.string().default("web"),
  lastSeenAt: z.number().int().nullable().default(null),
  createdAt: z.number().int(),
});
export type Device = z.infer<typeof DeviceSchema>;

export const REMINDER_CHANNELS = ["webpush", "wechat", "email", "inapp"] as const;
export const ReminderChannelSchema = z.enum(REMINDER_CHANNELS);
export type ReminderChannel = z.infer<typeof ReminderChannelSchema>;

/* -------------------------------------------------------------------------- */
/*                                  注册表                                     */
/* -------------------------------------------------------------------------- */

/** 所有可同步实体名（同步协议里的 entity 字段取值）。 */
export const ENTITY_NAMES = [
  "task",
  "goal",
  "inbox",
  "okr",
  "kr",
  "kpi",
  "kpiEntry",
  "pomodoro",
  "mindMap",
  "mindNode",
  "setting",
] as const;
export type EntityName = (typeof ENTITY_NAMES)[number];

/** 服务端用来校验 payload 的 schema 注册表。 */
export const ENTITY_SCHEMAS = {
  task: TaskSchema,
  goal: GoalSchema,
  inbox: InboxItemSchema,
  okr: OkrSchema,
  kr: KeyResultSchema,
  kpi: KpiSchema,
  kpiEntry: KpiEntrySchema,
  pomodoro: PomodoroSessionSchema,
  mindMap: MindMapSchema,
  mindNode: MindNodeSchema,
  setting: SettingSchema,
} as const satisfies Record<EntityName, z.ZodTypeAny>;

/** entity → 数据库表名 */
export const ENTITY_TABLES = {
  task: "tasks",
  goal: "goals",
  inbox: "inbox_items",
  okr: "okrs",
  kr: "key_results",
  kpi: "kpis",
  kpiEntry: "kpi_entries",
  pomodoro: "pomodoro_sessions",
  mindMap: "mind_maps",
  mindNode: "mind_nodes",
  setting: "settings",
} as const satisfies Record<EntityName, string>;

/** 各实体在本地库里用作二级索引的高频字段（供 Dexie 声明与 SQL 建索引共用） */
export const ENTITY_INDEX_HINTS: Record<EntityName, string[]> = {
  task: ["status", "quadrant", "goalId", "startAt", "dueAt", "updatedAt"],
  goal: ["status", "kind", "sortIndex"],
  inbox: ["status", "capturedAt"],
  okr: ["periodStart", "period"],
  kr: ["okrId"],
  kpi: ["sortIndex"],
  kpiEntry: ["kpiId", "date"],
  pomodoro: ["taskId", "startedAt"],
  mindMap: ["goalId"],
  mindNode: ["mapId", "parentId"],
  setting: ["key"],
};

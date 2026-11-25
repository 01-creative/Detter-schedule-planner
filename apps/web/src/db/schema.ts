import Dexie from "dexie";
import type { Table } from "dexie";
import type {
  EntityName,
  Goal,
  InboxItem,
  KeyResult,
  Kpi,
  KpiEntry,
  MindMap,
  MindNode,
  Okr,
  PomodoroSession,
  Setting,
  Task,
} from "@detter/shared";

/**
 * 本地库结构。
 *
 * 表名与任务书 §4.4 一致；entity → 表名的映射单独放在 repo.ts 里，
 * 因为服务端的表名（inbox_items / key_results…）和本地不同，不能混用。
 *
 * 字段用 `declare` 而不是 `!`：tsconfig 开了 useDefineForClassFields，
 * 用 `!` 会在实例化时把属性定义成 undefined，正好盖掉 Dexie 挂上来的 Table。
 */

/** outbox 里的一条待推送变更（= 同步协议里的 op + 重试元数据）。 */
export interface OutboxRecord {
  /** 自增主键，代表本地提交顺序，推送必须按它来 */
  seq?: number;
  opId: string;
  entity: EntityName;
  entityId: string;
  op: "upsert" | "delete";
  baseRev: number;
  at: number;
  /** upsert 时是完整实体快照；delete 时没有 */
  payload?: unknown;
  /** 失败次数，≥3 移入 outboxDead，绝不静默丢弃 */
  attempts: number;
  lastError?: string;
  /** 退避时间点（1s/2s/4s） */
  nextRetryAt?: number;
}

export interface DeadLetterRecord extends OutboxRecord {
  failedAt: number;
}

export interface MetaRecord {
  key: string;
  value: unknown;
  updatedAt: number;
}

export class DetterDB extends Dexie {
  declare tasks: Table<Task, string>;
  declare goals: Table<Goal, string>;
  declare inbox: Table<InboxItem, string>;
  declare okrs: Table<Okr, string>;
  declare keyResults: Table<KeyResult, string>;
  declare kpis: Table<Kpi, string>;
  declare kpiEntries: Table<KpiEntry, string>;
  declare pomodoroSessions: Table<PomodoroSession, string>;
  declare mindMaps: Table<MindMap, string>;
  declare mindNodes: Table<MindNode, string>;
  declare settings: Table<Setting, string>;
  declare outbox: Table<OutboxRecord, number>;
  declare outboxDead: Table<DeadLetterRecord, number>;
  declare meta: Table<MetaRecord, string>;

  constructor(name = "detter") {
    super(name);
    this.version(1).stores({
      tasks: "id, status, quadrant, goalId, startAt, dueAt, updatedAt, deletedAt",
      goals: "id, status, kind, sortIndex, updatedAt",
      inbox: "id, status, capturedAt, updatedAt",
      okrs: "id, period, periodStart, status, updatedAt",
      keyResults: "id, okrId, updatedAt",
      kpis: "id, sortIndex, updatedAt",
      kpiEntries: "id, kpiId, date, updatedAt",
      pomodoroSessions: "id, taskId, startedAt, updatedAt",
      mindMaps: "id, goalId, updatedAt",
      mindNodes: "id, mapId, parentId, updatedAt",
      settings: "id, key, updatedAt",
      outbox: "++seq, opId, entity, entityId, at",
      outboxDead: "++seq, opId, entity, entityId, at",
      meta: "key",
    });
  }
}

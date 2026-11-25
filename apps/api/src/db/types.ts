/** 绑定值类型。布尔统一转 0/1，对象/数组由调用方先 JSON.stringify。 */
export type SqlParam = string | number | boolean | null | undefined;

export interface DbRunResult {
  changes: number;
  lastRowId: number;
}

export interface DbStatement {
  sql: string;
  params?: SqlParam[];
}

/**
 * 运行时无关的极简 DB 接口：Cloudflare D1 与 node:sqlite 各实现一份。
 *
 * 与任务书的差异（唯一一处）：`batch` 返回每条语句的执行结果数组，而不是 `Promise<void>`。
 * 原因：同步 push 必须在同一个事务里插 changes 行，并把该行自增的 seq 既写进 op_log（幂等凭据）
 * 又放进响应；如果 batch 不返回结果，只能在提交后再查一次 max(seq)，并发下会张冠李戴。
 * 返回数组是 `Promise<void>` 的严格超集——忽略返回值的调用点行为完全不变。
 */
export interface Db {
  all<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T | null>;
  run(sql: string, params?: SqlParam[]): Promise<DbRunResult>;
  /** 原子批量；D1 用 db.batch，node:sqlite 用显式事务。 */
  batch(stmts: DbStatement[]): Promise<DbRunResult[]>;
  /** 执行多语句 SQL（仅迁移用）。 */
  exec(sql: string): Promise<void>;
}

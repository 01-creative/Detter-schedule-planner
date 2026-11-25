import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { Db, DbRunResult, DbStatement, SqlParam } from "./types";

type NodeBindable = string | number | bigint | null | Uint8Array;

function bindable(params: SqlParam[] = []): NodeBindable[] {
  return params.map((param) => {
    if (param === undefined) return null;
    if (typeof param === "boolean") return param ? 1 : 0;
    return param;
  });
}

/**
 * node:sqlite 适配器（支持 ":memory:"，测试用它拿到干净的空库）。
 *
 * 两点注意：
 * 1) 语句对象按 SQL 文本缓存 —— 同步流程里同一条 INSERT 会跑几千次，重复 prepare 的白白开销可观；
 * 2) batch 用显式 BEGIN/COMMIT —— node:sqlite 没有 D1 那种 batch API，
 *    而同步协议要求「实体写入 + changes 写入」原子提交，成功后回滚是唯一正确选择。
 */
export function createNodeDb(file: string): Db {
  const database = new DatabaseSync(file);
  const statements = new Map<string, StatementSync>();

  const statement = (sql: string): StatementSync => {
    const cached = statements.get(sql);
    if (cached) return cached;
    const prepared = database.prepare(sql);
    statements.set(sql, prepared);
    return prepared;
  };

  const runOne = (sql: string, params?: SqlParam[]): DbRunResult => {
    const result = statement(sql).run(...bindable(params));
    return { changes: Number(result.changes ?? 0), lastRowId: Number(result.lastInsertRowid ?? 0) };
  };

  return {
    async all<T>(sql: string, params?: SqlParam[]): Promise<T[]> {
      return statement(sql).all(...bindable(params)) as T[];
    },

    async first<T>(sql: string, params?: SqlParam[]): Promise<T | null> {
      const rows = statement(sql).all(...bindable(params)) as T[];
      return rows[0] ?? null;
    },

    async run(sql: string, params?: SqlParam[]): Promise<DbRunResult> {
      return runOne(sql, params);
    },

    async batch(stmts: DbStatement[]): Promise<DbRunResult[]> {
      if (stmts.length === 0) return [];
      const results: DbRunResult[] = [];
      database.exec("BEGIN");
      try {
        for (const stmt of stmts) results.push(runOne(stmt.sql, stmt.params));
        database.exec("COMMIT");
      } catch (error) {
        try {
          database.exec("ROLLBACK");
        } catch {
          // 事务可能已被 SQLite 自动回滚；此时 ROLLBACK 会报错，原始错误更值得抛出去。
        }
        throw error;
      }
      return results;
    },

    async exec(sql: string): Promise<void> {
      database.exec(sql);
    },
  };
}

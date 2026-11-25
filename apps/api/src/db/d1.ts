import type { D1Database } from "@cloudflare/workers-types";
import type { Db, DbRunResult, DbStatement, SqlParam } from "./types";

/** D1 只接受 string / number / null / ArrayBuffer 这类绑定值；布尔与 undefined 必须先归一。 */
type D1Bindable = string | number | null | Uint8Array | ArrayBuffer;

function bindable(params: SqlParam[] = []): D1Bindable[] {
  return params.map((param) => {
    if (param === undefined) return null;
    if (typeof param === "boolean") return param ? 1 : 0;
    return param;
  });
}

function toResult(meta: { changes?: number; last_row_id?: number } | undefined): DbRunResult {
  return { changes: Number(meta?.changes ?? 0), lastRowId: Number(meta?.last_row_id ?? 0) };
}

/** D1 适配器。每次请求用同一个 D1Database 绑定构造，无状态，可以随用随建。 */
export function createD1Db(d1: D1Database): Db {
  const prepare = (sql: string, params?: SqlParam[]) => d1.prepare(sql).bind(...bindable(params));

  return {
    async all<T>(sql: string, params?: SqlParam[]): Promise<T[]> {
      const result = await prepare(sql, params).all();
      return (result.results ?? []) as T[];
    },

    async first<T>(sql: string, params?: SqlParam[]): Promise<T | null> {
      const result = await prepare(sql, params).all();
      const rows = (result.results ?? []) as T[];
      return rows[0] ?? null;
    },

    async run(sql: string, params?: SqlParam[]): Promise<DbRunResult> {
      const result = await prepare(sql, params).run();
      return toResult(result.meta);
    },

    async batch(stmts: DbStatement[]): Promise<DbRunResult[]> {
      if (stmts.length === 0) return [];
      const results = await d1.batch(stmts.map((stmt) => prepare(stmt.sql, stmt.params)));
      return results.map((result) => toResult(result.meta));
    },

    async exec(sql: string): Promise<void> {
      await d1.exec(sql);
    },
  };
}

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Db } from "./types";

/**
 * 顺序执行 migrations/*.sql（Node 入口与单测用；Workers 上由 wrangler d1 migrations 负责）。
 *
 * 为什么要有 _migrations 表：0001 里的建表都带 IF NOT EXISTS，重复跑不会炸，
 * 但后续迁移（ALTER TABLE / 数据回填）不是幂等的，必须记录已执行的文件名。
 */
export async function runMigrations(db: Db, migrationsDir: string): Promise<string[]> {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );

  const appliedRows = await db.all<{ id: string }>("SELECT id FROM _migrations");
  const applied = new Set(appliedRows.map((row) => row.id));

  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const executed: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    await db.exec(sql);
    await db.run("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)", [file, Date.now()]);
    executed.push(file);
  }
  return executed;
}

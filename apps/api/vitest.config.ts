import { defineConfig } from "vitest/config";

/**
 * 单测跑在 node:sqlite 的内存库上（`:memory:`），不碰网络与磁盘上的数据库文件。
 * 迁移 SQL 仍从 migrations/ 读——那是 schema 的唯一事实来源，测试必须验证真 DDL。
 */
export default defineConfig({
  // pnpm 把 @detter/shared 以 junction 链接进 node_modules；
  // 让 Vite 解析到真实路径（packages/shared），它才会把 TS 源码当源码处理。
  resolve: { preserveSymlinks: false },
  test: {
    pool: "threads",
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    server: { deps: { inline: ["@detter/shared"] } },
  },
});

import { defineConfig } from "vitest/config";

/**
 * 统一测试配置。
 * - pool: "threads" —— 受限沙箱里 fork 子进程会被拒绝，线程池不受影响；
 * - isolate: true 保持测试文件互不污染。
 */
export default defineConfig({
  test: {
    pool: "threads",
    include: ["src/**/*.{test,spec}.{ts,tsx}", "tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 20_000,
  },
});

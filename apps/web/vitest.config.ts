import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * 单测跑在 jsdom 里：Dexie 需要 IndexedDB，由 src/test/setup.ts 里的 fake-indexeddb 提供。
 * alias 与 vite.config.ts 保持一致，否则测试里的 "@/..." 解析不到。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    pool: "threads",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 20_000,
  },
});

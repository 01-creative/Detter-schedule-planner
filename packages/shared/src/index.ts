/**
 * @detter/shared —— 前后端共享的领域契约。
 *
 * 这里只放「纯」的东西：类型、schema、纯函数。
 * 不允许出现 DOM、fetch、IndexedDB、process.env 等环境依赖。
 */
export * from "./api.ts";
export * from "./entities.ts";
export * from "./ids.ts";
export * from "./nlp.ts";
export * from "./quadrant.ts";
export * from "./sync.ts";
export * from "./time.ts";

/** 应用版本号（与 package.json 保持同步，构建时由 vite 注入覆盖） */
export const APP_VERSION = "0.1.0";

/** 默认时区：用户是单人中文用户，先固定，后续可配置 */
export const DEFAULT_TIMEZONE = "Asia/Shanghai";

/** 番茄钟默认参数 */
export const POMODORO_DEFAULTS = {
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  longBreakEvery: 4,
} as const;

/** 同步节流配置（毫秒） */
export const SYNC_DEFAULTS = {
  pushDebounceMs: 800,
  pullIntervalMs: 15_000,
  pullIntervalActiveMs: 5_000,
  maxOpsPerBatch: 200,
} as const;

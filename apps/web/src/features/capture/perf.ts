/**
 * 「3 秒记录」的计时点。
 *
 * 任务书要求实测「从按键到落库」的耗时，并且验收时会盯着这个数字。
 * 这里只用浏览器原生的 User Timing API：`performance.measure` 的条目会留在
 * DevTools 的 Performance 面板里，Playwright 也能用
 * `performance.getEntriesByName("detter.capture.persist")` 直接读出来，
 * 因此这个数字不是「开发者自己算出来的」，是浏览器记录的。
 */

export const CAPTURE_MEASURE = "detter.capture.persist";

export function captureStart(): number {
  return typeof performance === "undefined" ? 0 : performance.now();
}

/**
 * 结束计时并返回毫秒数。
 * @param startedAt captureStart() 的返回值（按键那一刻）
 * @param label 记录来源（save / close / q1 / batch），方便在 DevTools 里区分
 */
export function captureEnd(startedAt: number, label: string): number {
  if (typeof performance === "undefined") return 0;
  const endedAt = performance.now();
  const ms = endedAt - startedAt;
  try {
    performance.measure(CAPTURE_MEASURE, { start: startedAt, end: endedAt });
  } catch {
    // 个别浏览器不支持 measure 的 options 形式；数字仍然返回，不影响主流程
  }
  if (import.meta.env.DEV && import.meta.env.MODE !== "test") {
    console.debug(`[capture] ${label} ${ms.toFixed(1)}ms`);
  }
  return ms;
}

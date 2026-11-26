import { useEffect, useState } from "react";

/**
 * 每 60 秒跳一次的「现在」。
 *
 * 当前时间指示线（红线 + 圆点）要跟着走，但没必要每帧重渲染：
 * 一分钟一次足够，而且只在秒针变化时触发一次 setState。
 * 组件卸载时必须清掉定时器，否则来回切视图会留下一堆 interval。
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

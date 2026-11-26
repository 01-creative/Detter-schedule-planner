import { useEffect, useState } from "react";

/**
 * 每分钟跳一次的「现在」。
 *
 * KPI 的周期进度（本周已过 60%）需要随时间推进，但没必要每秒重算；
 * 回到前台时立刻校正一次，避免锁屏一夜后还显示昨天的百分比。
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, intervalMs);
    const onVisible = () => tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);

  return now;
}

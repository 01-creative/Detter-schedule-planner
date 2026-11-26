import { useEffect, useState } from "react";

/**
 * 最小媒体查询 hook（只读，用于决定抽屉方向这类「必须知道宽度」的地方）。
 * jsdom 里 matchMedia 由 test/setup.ts 兜底，返回 false。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, [query]);

  return matches;
}

/** 窄屏（<768）：画板单列、详情面板从底部起、目标栏变成底部抽屉。 */
export function useIsMobile(): boolean {
  return !useMediaQuery("(min-width: 768px)");
}

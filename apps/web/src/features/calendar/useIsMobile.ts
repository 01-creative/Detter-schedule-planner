import { useEffect, useState } from "react";

/**
 * 媒体查询 hook。
 *
 * 只在「断点判断」这种无法用纯 CSS 表达的地方用（例如：移动端默认落到议程视图）。
 * 纯样式差异一律交给 Tailwind 的 md: 前缀，不要在 JS 里做布局。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** < 768px（设计规范 §5 的 md 断点）：移动端默认议程视图 */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

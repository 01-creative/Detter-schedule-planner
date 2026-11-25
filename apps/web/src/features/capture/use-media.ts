import { useEffect, useState } from "react";

/**
 * 订阅一条 media query。
 *
 * 面板要在 <768px 时变成底部 sheet，但样式不能只靠 CSS —— 两者的 DOM 结构不同
 * （桌面是输入框 + chips，移动端多一排快捷 chip 和一个「完成」按钮），
 * 所以需要一个 JS 侧的真假值。SSR / 测试环境没有 matchMedia 时按桌面处理。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, [query]);

  return matches;
}

/**
 * 软键盘顶起来的高度（px）。
 *
 * 底部 sheet 在 iOS/Android 上会被键盘盖住：布局视口不变，只是可视视口缩小了。
 * 用 visualViewport 的差值把 sheet 顶上去，键盘收起时差值回到 0。
 */
export function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (!active) {
      setInset(0);
      return;
    }
    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      const raw = window.innerHeight - viewport.height - viewport.offsetTop;
      setInset(raw > 40 ? Math.min(raw, window.innerHeight * 0.6) : 0);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [active]);

  return inset;
}

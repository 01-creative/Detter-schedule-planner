import { useEffect } from "react";
import type { ReactNode } from "react";
import { useUIStore } from "@/stores/ui";

/**
 * 主题落地。
 *
 * index.html 里的内联脚本已经按 localStorage 设过一次，这里负责：
 * 1. 用户切换后立刻改 data-theme（否则要等下一次刷新）；
 * 2. 选择「跟随系统」时监听系统偏好变化；
 * 3. 把选择写回 localStorage，供首帧脚本使用。
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useUIStore((state) => state.theme);

  useEffect(() => {
    const apply = () => {
      const prefersDark =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
      const dark = theme === "dark" || (theme === "system" && prefersDark);
      const root = document.documentElement;
      root.dataset.theme = dark ? "dark" : "light";
      root.style.colorScheme = dark ? "dark" : "light";
      try {
        window.localStorage.setItem("detter.theme", theme);
      } catch {
        // 存不了也不影响本次显示
      }
    };

    apply();

    if (theme !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [theme]);

  return <>{children}</>;
}

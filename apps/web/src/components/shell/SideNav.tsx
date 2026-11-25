import { NavLink } from "react-router-dom";
import { Command, Moon, Plus, Sun } from "lucide-react";
import { cn } from "@detter/ui";
import { useCaptureStore } from "@/stores/capture";
import { useUIStore } from "@/stores/ui";
import { NAV_ITEMS } from "./nav-items";

/**
 * 桌面左侧导航（≥768 显示，图标栏 76px，hover / 键盘聚焦展开到 220px）。
 *
 * 为什么用 width 过渡而不是 transform：展开时导航是覆盖在内容之上的浮层，
 * 只影响自身子树的重排（9 个固定尺寸的行），比做「宽度不变 + 平移面板 + 命中区修正」
 * 的方案简单得多，实测也不掉帧。真正的动画细节（label 淡入）仍在 opacity 上。
 */
export function SideNav() {
  const navExpanded = useUIStore((state) => state.navExpanded);
  const setNavExpanded = useUIStore((state) => state.setNavExpanded);
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);
  const openCapture = useCaptureStore((state) => state.openCapture);

  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  return (
    <aside
      aria-label="主导航"
      onMouseEnter={() => setNavExpanded(true)}
      onMouseLeave={() => setNavExpanded(false)}
      onFocusCapture={() => setNavExpanded(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setNavExpanded(false);
        }
      }}
      className={cn(
        "fixed inset-y-0 left-0 z-40 hidden flex-col overflow-hidden border-r border-border bg-surface md:flex",
        "transition-[width] duration-[var(--dur-3)] ease-out",
        navExpanded ? "w-[220px] shadow-2" : "w-[76px]",
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-3 px-[26px]">
        <span
          aria-hidden="true"
          className="grid size-6 shrink-0 grid-cols-2 gap-0.5 rounded-[7px] gradient-accent p-1 shadow-1"
        >
          <span className="rounded-[1px] bg-white/95" />
          <span className="rounded-[1px] bg-white/60" />
          <span className="rounded-[1px] bg-white/60" />
          <span className="rounded-[1px] bg-white/30" />
        </span>
        <span
          className={cn(
            "text-h2 whitespace-nowrap text-ink-900 transition-opacity duration-[var(--dur-2)]",
            navExpanded ? "opacity-100" : "opacity-0",
          )}
        >
          Detter
        </span>
      </div>

      <nav aria-label="模块" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            aria-label={item.label}
            className={({ isActive }) =>
              cn(
                "relative flex h-10 shrink-0 items-center gap-3 rounded-md px-3 transition-colors duration-[var(--dur-1)]",
                isActive
                  ? "bg-accent-soft font-strong text-accent"
                  : "text-ink-500 hover:bg-surface-sunken hover:text-ink-900",
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 h-5 w-0.5 rounded-full bg-accent"
                  />
                )}
                <item.icon className="size-[18px] shrink-0" aria-hidden="true" strokeWidth={1.9} />
                <span
                  className={cn(
                    "truncate whitespace-nowrap text-body transition-opacity duration-[var(--dur-2)]",
                    navExpanded ? "opacity-100" : "opacity-0",
                  )}
                >
                  {item.label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="flex shrink-0 flex-col gap-1 border-t border-border p-3">
        <button
          type="button"
          onClick={() => openCapture()}
          aria-label="快速记录"
          className={cn(
            "flex h-10 items-center gap-3 rounded-md px-3 text-ink-700 transition-colors duration-[var(--dur-1)] hover:bg-surface-sunken hover:text-ink-900",
          )}
        >
          <Plus className="size-[18px] shrink-0" aria-hidden="true" strokeWidth={2} />
          <span
            className={cn(
              "flex flex-1 items-center justify-between gap-2 whitespace-nowrap transition-opacity duration-[var(--dur-2)]",
              navExpanded ? "opacity-100" : "opacity-0",
            )}
          >
            <span className="text-body">快速记录</span>
            <kbd className="rounded border border-border bg-surface-sunken px-1 py-0.5 text-micro text-ink-500">
              <Command className="inline size-2.5" aria-hidden="true" />K
            </kbd>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          aria-label={isDark ? "切换到浅色模式" : "切换到深色模式"}
          className="flex h-10 items-center gap-3 rounded-md px-3 text-ink-500 transition-colors duration-[var(--dur-1)] hover:bg-surface-sunken hover:text-ink-900"
        >
          {isDark ? (
            <Sun className="size-[18px] shrink-0" aria-hidden="true" />
          ) : (
            <Moon className="size-[18px] shrink-0" aria-hidden="true" />
          )}
          <span
            className={cn(
              "whitespace-nowrap text-body transition-opacity duration-[var(--dur-2)]",
              navExpanded ? "opacity-100" : "opacity-0",
            )}
          >
            {isDark ? "浅色模式" : "深色模式"}
          </span>
        </button>
      </div>
    </aside>
  );
}

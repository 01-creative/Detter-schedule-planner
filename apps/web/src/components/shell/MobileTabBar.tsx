import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Ellipsis, Monitor, Moon, Plus, Sun } from "lucide-react";
import { Sheet, cn } from "@detter/ui";
import { useCaptureStore } from "@/stores/capture";
import { useUIStore, type ThemeMode } from "@/stores/ui";
import { MOBILE_MORE_ITEMS, MOBILE_TABS } from "./nav-items";

/**
 * 移动端底部 tab bar（64px + 安全区）。
 * 只有 5 个入口：四象限 / 收件箱 / 日历 / 专注 / 更多。
 * 其余模块与外观设置收进「更多」抽屉，避免小屏导航膨胀。
 *
 * 一级入口一共 9 个：4 个在 tab 上，5 个在抽屉里。
 * 人在 /okr 这类「抽屉里的页面」时，底栏不能一个都不亮（会让人以为没在导航里），
 * 所以「更多」在命中 MOBILE_MORE_ITEMS 时也走到选中态。
 */
export function MobileTabBar() {
  const mobileMoreOpen = useUIStore((state) => state.mobileMoreOpen);
  const setMobileMoreOpen = useUIStore((state) => state.setMobileMoreOpen);
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);
  const openCapture = useCaptureStore((state) => state.openCapture);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const isInMore = MOBILE_MORE_ITEMS.some((item) =>
    item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(`${item.to}/`),
  );

  const themeOptions: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
    { value: "light", label: "浅色", icon: Sun },
    { value: "dark", label: "深色", icon: Moon },
    { value: "system", label: "系统", icon: Monitor },
  ];

  return (
    <>
      <nav
        aria-label="底部导航"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border glass md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex h-16 items-stretch">
          {MOBILE_TABS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              aria-label={item.label}
              className={({ isActive }) =>
                cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 text-micro transition-colors duration-[var(--dur-1)]",
                  isActive ? "text-accent" : "text-ink-500",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full transition-colors duration-[var(--dur-1)]",
                      isActive && "bg-accent-soft",
                    )}
                  >
                    <item.icon className="size-[18px]" aria-hidden="true" strokeWidth={1.9} />
                  </span>
                  <span className="font-strong">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setMobileMoreOpen(true)}
            aria-label="更多模块"
            aria-current={isInMore ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 text-micro transition-colors duration-[var(--dur-1)]",
              isInMore ? "text-accent" : "text-ink-500",
            )}
          >
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-full transition-colors duration-[var(--dur-1)]",
                isInMore && "bg-accent-soft",
              )}
            >
              <Ellipsis className="size-[18px]" aria-hidden="true" />
            </span>
            <span className="font-strong">更多</span>
          </button>
        </div>
      </nav>

      <Sheet
        open={mobileMoreOpen}
        onOpenChange={setMobileMoreOpen}
        title="更多"
        description="其余模块与外观"
      >
        <div className="grid grid-cols-2 gap-2">
          {MOBILE_MORE_ITEMS.map((item) => {
            const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
            return (
              <button
                key={item.to}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  setMobileMoreOpen(false);
                  navigate(item.to);
                }}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors duration-[var(--dur-1)]",
                  active
                    ? "border-accent/30 bg-accent-soft"
                    : "border-border bg-surface-solid hover:border-border-strong hover:bg-surface-sunken",
                )}
              >
                <item.icon className="size-4 shrink-0 text-accent" aria-hidden="true" />
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block text-body font-strong",
                      active ? "text-accent" : "text-ink-900",
                    )}
                  >
                    {item.label}
                  </span>
                  <span className="block truncate text-micro text-ink-500">{item.description}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-5">
          <p className="mb-2 text-micro text-ink-500">外观</p>
          <div className="flex gap-2" role="group" aria-label="外观模式">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={theme === option.value}
                onClick={() => setTheme(option.value)}
                className={cn(
                  "flex h-11 flex-1 items-center justify-center gap-2 rounded-md border text-caption transition-colors duration-[var(--dur-1)]",
                  theme === option.value
                    ? "border-accent/30 bg-accent-soft text-accent"
                    : "border-border bg-surface-solid text-ink-500",
                )}
              >
                <option.icon className="size-4" aria-hidden="true" />
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setMobileMoreOpen(false);
            openCapture();
          }}
          className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-lg gradient-accent text-body font-strong text-on-accent shadow-accent"
        >
          <Plus className="size-4" aria-hidden="true" />
          快速记录一条
        </button>
      </Sheet>
    </>
  );
}

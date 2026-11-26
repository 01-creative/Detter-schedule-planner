import { useNavigate, useLocation } from "react-router-dom";
import { ChevronRight, LogOut, Monitor, Moon, Search, Settings, Sun } from "lucide-react";
import { Avatar, Menu, useToast } from "@detter/ui";
import type { MenuItem } from "@detter/ui";
import { useAuth } from "@/app/auth";
import { getDeviceName } from "@/lib/device";
import { formatDateLabel } from "@/lib/format";
import { useUIStore } from "@/stores/ui";
import { useCaptureStore } from "@/stores/capture";
import { currentNavItem, viewTitle } from "./nav-items";
import { SyncBadge } from "./SyncBadge";

/**
 * 顶部工具条。
 * 桌面：56px，毛玻璃，面包屑 + 搜索占位 + 同步状态 + 头像。
 * 移动：52px，只留「当前视图」+ 同步点 + 头像（底部已有 tab，不需要再堆导航）。
 */
export function TopBar() {
  const location = useLocation();
  const title = viewTitle(location.pathname);

  return (
    <header className="sticky top-0 z-30 hidden h-14 border-b border-border glass md:block">
      <div className="mx-auto flex h-full w-full max-w-[1440px] items-center gap-4 px-4 lg:px-8">
        <nav aria-label="面包屑" className="flex min-w-0 items-center gap-1.5 text-caption">
          <span className="shrink-0 text-ink-300">Detter</span>
          <ChevronRight className="size-3 shrink-0 text-ink-300" aria-hidden="true" />
          <span className="truncate font-strong text-ink-900">{title}</span>
          <span className="ml-2 hidden shrink-0 text-ink-300 lg:inline">
            {formatDateLabel(Date.now())}
          </span>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <SearchPlaceholder />
          <SyncBadge />
          <AvatarMenu />
        </div>
      </div>
    </header>
  );
}

export function MobileHeader() {
  const location = useLocation();
  const item = currentNavItem(location.pathname);
  const title = viewTitle(location.pathname);

  return (
    // 装到主屏后（standalone + viewport-fit=cover）内容会顶到状态栏下面，
    // 这里把安全区加进高度里，iPad / iPhone 的刘海与状态栏都不会压住标题。
    <header className="sticky top-0 z-30 flex h-[calc(52px+env(safe-area-inset-top))] items-center gap-3 border-b border-border glass px-4 pt-[env(safe-area-inset-top)] md:hidden">
      <div className="flex min-w-0 items-center gap-2">
        {item && <item.icon className="size-4 shrink-0 text-accent" aria-hidden="true" />}
        <h1 className="truncate text-h2 text-ink-900">{title}</h1>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <SyncBadge compact />
        <AvatarMenu />
      </div>
    </header>
  );
}

function SearchPlaceholder() {
  const { toast } = useToast();
  return (
    <>
      <button
        type="button"
        aria-label="全局搜索（即将上线）"
        onClick={() =>
          toast({
            title: "全局搜索还在路上",
            description: "现在用 Ctrl/Cmd + K 直接记一条更快",
          })
        }
        className="hidden h-9 w-56 items-center gap-2 rounded-md border border-border bg-surface-solid px-3 text-caption text-ink-300 transition-colors duration-[var(--dur-1)] hover:border-border-strong hover:text-ink-500 lg:flex xl:w-64"
      >
        <Search className="size-3.5" aria-hidden="true" />
        <span className="truncate">搜索任务、目标…</span>
        <span className="ml-auto rounded border border-border px-1 text-micro">即将上线</span>
      </button>
      <button
        type="button"
        aria-label="全局搜索（即将上线）"
        onClick={() =>
          toast({ title: "全局搜索还在路上", description: "现在用 Ctrl/Cmd + K 直接记一条更快" })
        }
        className="inline-flex size-9 items-center justify-center rounded-md border border-border bg-surface-solid text-ink-500 transition-colors duration-[var(--dur-1)] hover:border-border-strong hover:text-ink-900 lg:hidden"
      >
        <Search className="size-4" aria-hidden="true" />
      </button>
    </>
  );
}

/** 头像菜单：外观切换 + 设置 + 退出。退出是危险动作，用红色并在最后。 */
function AvatarMenu() {
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);
  const { logout } = useAuth();
  const navigate = useNavigate();
  const openCapture = useCaptureStore((state) => state.openCapture);
  const deviceName = getDeviceName();

  const items: MenuItem[] = [
    {
      key: "light",
      label: "浅色模式",
      icon: <Sun className="size-4" aria-hidden="true" />,
      active: theme === "light",
      onSelect: () => setTheme("light"),
    },
    {
      key: "dark",
      label: "深色模式",
      icon: <Moon className="size-4" aria-hidden="true" />,
      active: theme === "dark",
      onSelect: () => setTheme("dark"),
    },
    {
      key: "system",
      label: "跟随系统",
      icon: <Monitor className="size-4" aria-hidden="true" />,
      active: theme === "system",
      onSelect: () => setTheme("system"),
    },
    {
      key: "capture",
      label: "快速记录",
      icon: <Search className="size-4" aria-hidden="true" />,
      onSelect: () => openCapture(),
    },
    {
      key: "settings",
      label: "设置",
      icon: <Settings className="size-4" aria-hidden="true" />,
      onSelect: () => navigate("/settings"),
    },
    {
      key: "logout",
      label: "退出登录",
      icon: <LogOut className="size-4" aria-hidden="true" />,
      danger: true,
      onSelect: () => {
        void logout().then(() => navigate("/login", { replace: true }));
      },
    },
  ];

  return (
    <Menu
      align="end"
      label="账户菜单"
      items={items}
      trigger={
        <button
          type="button"
          aria-label={`账户菜单（${deviceName}）`}
          // 44×44 命中区（头像本身 36）：设计规范 §7 要求移动端可点元素 ≥ 44
          className="flex size-11 items-center justify-center rounded-full transition-transform duration-[var(--dur-1)] hover:scale-[1.03] active:scale-[.96]"
        >
          <Avatar name={deviceName} size="md" />
        </button>
      }
    />
  );
}

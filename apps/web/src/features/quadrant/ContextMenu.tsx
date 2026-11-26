import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@detter/ui";
import type { MenuEntry } from "./menu-model";

/**
 * 董事会式右键菜单：贴着指针出现，方向键可选，Esc 关闭。
 *
 * 为什么不用 @detter/ui 的 Menu：那个组件是「锚在某个按钮下方」的，
 * 而右键菜单要出现在指针位置、还要能被视口裁切后自动回弹，定位模型不同。
 * 视觉与键盘行为仍然沿用同一套令牌与规则。
 */

export interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  items: MenuEntry[];
  label?: string;
  onSelect: (key: string) => void;
  onClose: () => void;
}

export function ContextMenu({ open, x, y, items, label = "操作菜单", onSelect, onClose }: ContextMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [openSub, setOpenSub] = useState<string | null>(null);

  /* 打开时重置二级菜单，并把焦点放到第一项，保证「右键 → 方向键 → 回车」全键盘可达 */
  useEffect(() => {
    if (!open) {
      setOpenSub(null);
      return;
    }
    const timer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  /* 视口裁切：先按指针放，再量自身尺寸往回拉，右下角右键不会出血 */
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const rect = panel.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }, [open, x, y, items]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onClose);
    };
  }, [open, onClose]);

  const focusItem = useCallback((key: string | undefined) => {
    if (!key) return;
    panelRef.current?.querySelector<HTMLElement>(`[data-menu-key="${key}"]`)?.focus();
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const nodes = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
    );
    if (nodes.length === 0) return;
    const current = nodes.indexOf(document.activeElement as HTMLElement);

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = nodes[(current + delta + nodes.length) % nodes.length];
      next?.focus();
      return;
    }

    if (event.key === "ArrowRight") {
      const trigger = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(
        "[data-submenu-key]",
      );
      if (!trigger) return;
      event.preventDefault();
      const key = trigger.dataset.submenuKey ?? null;
      setOpenSub(key);
      window.setTimeout(() => {
        const panel = trigger.querySelector<HTMLElement>('[role="menu"]');
        panel?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
      }, 0);
      return;
    }

    if (event.key === "ArrowLeft") {
      if (!openSub) return;
      event.preventDefault();
      const key = openSub;
      setOpenSub(null);
      focusItem(key);
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      onClose();
    }
  };

  if (!open || typeof document === "undefined") return null;

  const renderItems = (entries: MenuEntry[]) =>
    entries.map((entry) => {
      if (entry.type === "separator") {
        return <div key={entry.key} role="separator" className="my-1 h-px bg-border" />;
      }

      if (entry.type === "submenu") {
        const expanded = openSub === entry.key;
        return (
          <div
            key={entry.key}
            className="relative"
            data-submenu-key={entry.key}
            onMouseEnter={() => setOpenSub(entry.key)}
          >
            <button
              type="button"
              role="menuitem"
              data-menu-key={entry.key}
              aria-haspopup="menu"
              aria-expanded={expanded}
              onClick={() => setOpenSub(expanded ? null : entry.key)}
              className={cn(
                "flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-body text-ink-700",
                "transition-colors duration-[var(--dur-1)] hover:bg-surface-sunken",
                expanded && "bg-surface-sunken",
              )}
            >
              <span className="flex-1 truncate">{entry.label}</span>
              <ChevronRight className="size-3.5 text-ink-300" aria-hidden="true" />
            </button>
            {expanded && (
              <div
                role="menu"
                aria-label={entry.label}
                onKeyDown={handleKeyDown}
                className="absolute top-0 left-full z-10 ml-1 w-56 rounded-lg border border-border bg-surface-solid p-1.5 shadow-3"
              >
                {renderItems(entry.items)}
              </div>
            )}
          </div>
        );
      }

      return (
        <button
          key={entry.key}
          type="button"
          role="menuitem"
          data-menu-key={entry.key}
          disabled={entry.disabled}
          aria-current={entry.active ? "true" : undefined}
          onClick={() => {
            if (entry.disabled) return;
            onSelect(entry.key);
            onClose();
          }}
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-body",
            "transition-colors duration-[var(--dur-1)] hover:bg-surface-sunken",
            "disabled:pointer-events-none disabled:text-ink-300",
            entry.danger ? "text-danger-ink hover:bg-danger-soft" : "text-ink-700",
            entry.active && "bg-accent-soft text-accent",
          )}
        >
          <span className="flex-1 truncate">{entry.label}</span>
          {entry.shortcut && (
            <span className="shrink-0 text-micro text-ink-300">{entry.shortcut}</span>
          )}
          {entry.active && <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />}
        </button>
      );
    });

  return createPortal(
    <>
      <div className="fixed inset-0 z-[74]" aria-hidden="true" />
      <div
        ref={panelRef}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        style={{ left: x, top: y }}
        className="fixed z-[75] w-56 rounded-lg border border-border bg-surface-solid p-1.5 shadow-3"
      >
        {renderItems(items)}
      </div>
    </>,
    document.body,
  );
}

export default ContextMenu;

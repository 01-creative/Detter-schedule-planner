import { useRef } from "react";
import type { KeyboardEvent, ReactElement, ReactNode } from "react";
import { Popover } from "./Popover";
import { cn } from "../lib/cn";

export interface MenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** 选中态（例如当前主题） */
  active?: boolean;
}

export interface MenuProps {
  trigger: ReactElement;
  items: MenuItem[];
  align?: "start" | "end";
  label?: string;
  className?: string;
}

/**
 * 菜单。方向键在面板内循环，Esc 由 Popover 统一处理。
 * 用 role=menu/menuitem 而不是 div 列表：读屏会念出「菜单，5 项」。
 */
export function Menu({ trigger, items, align = "end", label = "更多操作", className }: MenuProps) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (event: KeyboardEvent<HTMLDivElement>, delta: number) => {
    const nodes = itemRefs.current.filter((node): node is HTMLButtonElement => Boolean(node));
    if (nodes.length === 0) return;
    const current = nodes.findIndex((node) => node === document.activeElement);
    const next = (current + delta + nodes.length) % nodes.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      nodes[next]?.focus();
    }
  };

  return (
    <Popover trigger={trigger} align={align} role="menu" label={label} className={className}>
      {(close) => (
        <div
          onKeyDown={(event) => move(event, event.key === "ArrowUp" ? -1 : 1)}
          className="flex flex-col"
        >
          {items.map((item, index) => (
            <button
              key={item.key}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              aria-current={item.active ? "true" : undefined}
              onClick={() => {
                if (item.disabled) return;
                item.onSelect();
                close();
              }}
              className={cn(
                "flex h-9 items-center gap-2 rounded-md px-2.5 text-left text-body transition-colors duration-[var(--dur-1)]",
                "hover:bg-surface-sunken disabled:pointer-events-none disabled:text-ink-300",
                item.danger ? "text-danger-ink hover:bg-danger-soft" : "text-ink-700",
                item.active && "bg-accent-soft text-accent",
              )}
            >
              {item.icon}
              <span className="flex-1 truncate">{item.label}</span>
              {item.active && <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

import { cn } from "../lib/cn";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** 必填：开关没有可见文字时，读屏只能靠它 */
  label: string;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onCheckedChange, label, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-border-strong",
        // 40×24 的视觉不变，命中区补到 44×44。
        // 注意 ::after 的定位参照是「内边距盒」，这个开关有 1px 描边，
        // 所以要多借 1px 才能真的到 44：上下各 11px、左右各 3px。
        "after:absolute after:-inset-y-[11px] after:-inset-x-[3px] after:content-['']",
        "transition-colors duration-[var(--dur-2)] ease-out",
        checked ? "border-transparent gradient-accent" : "bg-surface-sunken",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-surface-solid shadow-1",
          "transition-transform duration-[var(--dur-2)] ease-out",
          checked ? "translate-x-[18px]" : "translate-x-[3px]",
        )}
      />
    </button>
  );
}

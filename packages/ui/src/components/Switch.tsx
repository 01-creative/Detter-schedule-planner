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

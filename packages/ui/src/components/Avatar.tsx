import { cn } from "../lib/cn";

export interface AvatarProps {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE = {
  sm: "size-7 text-micro",
  md: "size-9 text-caption",
  lg: "size-11 text-body",
} as const;

/** 取首个非空字符作为缩写：中文取姓，英文取首字母。 */
function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "D";
  const first = Array.from(trimmed)[0] ?? "D";
  return /[a-z]/i.test(first) ? first.toUpperCase() : first;
}

export function Avatar({ name, size = "md", className }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex select-none items-center justify-center rounded-full font-strong text-on-accent",
        "gradient-accent shadow-1 ring-2 ring-surface-solid",
        SIZE[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

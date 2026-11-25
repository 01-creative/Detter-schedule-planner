import { cn } from "../lib/cn";

export interface DividerProps {
  label?: string;
  className?: string;
}

export function Divider({ label, className }: DividerProps) {
  if (!label) {
    return <div role="separator" className={cn("h-px w-full bg-border", className)} />;
  }
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div role="separator" className="h-px flex-1 bg-border" />
      <span className="text-micro text-ink-300">{label}</span>
      <div role="separator" className="h-px flex-1 bg-border" />
    </div>
  );
}

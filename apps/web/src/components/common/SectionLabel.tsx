import type { ReactNode } from "react";
import { cn } from "@detter/ui";

/**
 * 分区标题：一行 11px 小字 + 一条发丝线。
 *
 * 用在「卡片很长、但内容其实分几组」的页面（设置、复盘）。
 * 不新增卡片、不改变卡片顺序，只在视觉上把连续的同权重卡片切成"章节"。
 */
export function SectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="shrink-0 text-micro font-strong text-ink-500">{children}</span>
      <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-border" />
    </div>
  );
}

export default SectionLabel;

import type { ReactNode } from "react";
import { cn } from "@detter/ui";

/**
 * 全站统一的页面标题区（设计规范 §2 排版层级 / §5 布局）。
 *
 * 只固定一件事：**眉题 12/18 → 4px → 标题 22/30 → 6px → 说明 14/22**。
 * 右侧的动作（视图切换、主按钮、周期导航）由调用方放在自己的 header flex 里，
 * 这样节奏统一，但各页仍然可以长成自己需要的样子（日历要区间、OKR 要周期）。
 *
 * 为什么值得单独抽一个组件：之前 9 个页面各写一遍，主标题顶部从 76px 飘到 99px，
 * 字号在 22/24 之间来回，眉题 11/12 混用 —— 单看每页都还行，切页就会「跳」。
 */
export interface PageHeadingProps {
  /** 标题上方的一行小字：标签 / 一句话定位 / 统计摘要 */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** 与标题同一行、标题右侧的补充信息（日期范围、周期标签、统计） */
  titleAddon?: ReactNode;
  /** 标题下方的一句说明；超过一行时保持 672px 上限，避免长文横跨整屏 */
  description?: ReactNode;
  className?: string;
}

export function PageHeading({
  eyebrow,
  title,
  titleAddon,
  description,
  className,
}: PageHeadingProps) {
  return (
    <div className={cn("min-w-0", className)}>
      {/* 用 div 而不是 p：首页会把统计 <dl> 放进眉题行，p 里嵌 dl 是非法结构 */}
      {eyebrow && <div className="text-caption text-ink-500">{eyebrow}</div>}
      <div className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-1", eyebrow && "mt-1")}>
        <h1 className="text-h1 text-ink-900">{title}</h1>
        {titleAddon}
      </div>
      {description && (
        <p className="mt-1.5 max-w-2xl text-body text-ink-500">{description}</p>
      )}
    </div>
  );
}

export default PageHeading;

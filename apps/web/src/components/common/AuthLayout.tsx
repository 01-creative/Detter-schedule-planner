import type { ReactNode } from "react";

/**
 * 登录 / 初始化共用的居中卡片布局。
 * 独立成一页而不是弹窗：这两个页面在没登录时就是唯一可见的界面，
 * 需要一个安静的、只放一件事的页面。
 */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-5 py-10">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="grid size-8 grid-cols-2 gap-0.5 rounded-lg gradient-accent p-1.5 shadow-accent"
        >
          <span className="rounded-[2px] bg-white/95" />
          <span className="rounded-[2px] bg-white/60" />
          <span className="rounded-[2px] bg-white/60" />
          <span className="rounded-[2px] bg-white/30" />
        </span>
        <span className="text-h2 text-ink-900">Detter</span>
      </div>

      <div className="w-full max-w-sm rounded-xl border border-border bg-surface-solid p-6 shadow-2">
        <h1 className="text-h1 text-ink-900">{title}</h1>
        <p className="mt-1 text-caption text-ink-500">{description}</p>
        <div className="mt-5">{children}</div>
      </div>

      {footer}
      <p className="text-micro text-ink-300">数据先写在这台设备上，登录只影响同步。</p>
    </div>
  );
}

import type { ReactNode } from "react";
import { Skeleton } from "@detter/ui";

/**
 * 加载态。
 *
 * 骨架屏的形状要和真实内容一致（标题 + 一小段说明 + 三行卡片），
 * 这样数据回来时不会「跳一下」；纯转圈会让用户不知道等的是什么。
 */
export function LoadingState({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={className} role="status" aria-live="polite" aria-label="正在加载">
      <span className="sr-only">正在加载内容</span>
      <div className="max-w-md space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-3 w-64" />
      </div>
      <div className="mt-6 space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="rounded-lg border border-border bg-surface-solid p-4">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="mt-2.5 h-3 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 整页启动态：只在「还在问服务端登录状态」时出现，通常 <300ms。 */
export function FullPageLoading({ message = "正在打开工作台…" }: { message?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6">
      <span
        aria-hidden="true"
        className="grid size-12 grid-cols-2 gap-1 rounded-xl gradient-accent p-2 shadow-accent"
      >
        <span className="rounded-sm bg-white/95" />
        <span className="rounded-sm bg-white/60" />
        <span className="rounded-sm bg-white/60" />
        <span className="rounded-sm bg-white/30" />
      </span>
      <p className="text-caption text-ink-500">{message}</p>
      <p className="text-micro text-ink-300">离线也能用，数据始终先写在这台设备上</p>
    </div>
  );
}

export function CardSkeleton({ children }: { children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface-solid p-4">
      <Skeleton className="h-3.5 w-2/3" />
      <Skeleton className="mt-2.5 h-3 w-1/3" />
      {children}
    </div>
  );
}

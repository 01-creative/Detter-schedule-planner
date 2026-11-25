import { CircleExclamationPoint, RefreshCw } from "lucide-react";
import { Button } from "@detter/ui";

/**
 * 错误态。
 *
 * 必须可重试：本地优先的应用里，绝大多数「错误」是临时的（后端重启、网络切换），
 * 直接丢一个红屏会把用户吓走。
 */
export function ErrorState({
  title = "这里出了点问题",
  description = "数据还在本地，重试一次通常就好。",
  onRetry,
  retryLabel = "重试",
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-danger-soft">
        <CircleExclamationPoint className="size-5 text-danger" aria-hidden="true" />
      </span>
      <div>
        <p className="text-body font-strong text-ink-900">{title}</p>
        <p className="mt-1 max-w-sm text-caption text-ink-500">{description}</p>
      </div>
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onRetry}
          leftIcon={<RefreshCw className="size-3" aria-hidden="true" />}
        >
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

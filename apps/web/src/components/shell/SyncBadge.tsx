import { useSyncStatus } from "@/sync/useSyncStatus";
import { retryFailed, syncNow } from "@/sync/client";
import { formatSyncTime } from "@/lib/format";
import { cn } from "@detter/ui";
import { Popover } from "@detter/ui";
import { Button } from "@detter/ui";
import { Cloud, CloudOff, CloudUpload, RefreshCw } from "lucide-react";
import { useState } from "react";

/**
 * 同步徽标。
 *
 * 四种状态的文案直接对应状态机：
 * - 已同步 → 绿色点 + 时间；
 * - 同步中 → 转动的环；
 * - 离线 → 云朵断开 + 待同步条数（客户端在本地继续工作，不是报错）；
 * - 异常 → 红色提示，并暴露「N 条进了死信」的入口。
 */
export function SyncBadge({ compact = false }: { compact?: boolean }) {
  const { state, pending, dead, lastSyncAt, error } = useSyncStatus();
  const [busy, setBusy] = useState(false);

  const label =
    state === "syncing"
      ? "同步中"
      : state === "offline"
        ? pending > 0
          ? `离线 · ${pending} 条待同步`
          : "离线"
        : state === "error"
          ? "同步异常"
          : pending > 0
            ? `${pending} 条待同步`
            : "已同步";

  const tone =
    state === "error" ? "danger" : state === "offline" ? "warning" : state === "syncing" ? "accent" : "success";

  const Icon = state === "offline" ? CloudOff : state === "syncing" ? RefreshCw : state === "error" ? CloudUpload : Cloud;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      role="dialog"
      label="同步状态"
      trigger={
        <button
          type="button"
          aria-label={`同步状态：${label}`}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface-solid px-2.5 text-caption transition-colors duration-[var(--dur-1)] hover:border-border-strong",
            compact && "w-9 justify-center px-0",
          )}
        >
          <span className="relative flex size-4 items-center justify-center">
            <Icon
              className={cn(
                "size-4",
                state === "syncing" && "animate-driven-spin",
                tone === "success" && "text-success",
                tone === "warning" && "text-warning",
                tone === "danger" && "text-danger",
                tone === "accent" && "text-accent",
              )}
              aria-hidden="true"
            />
          </span>
          {!compact && (
            <span className="whitespace-nowrap text-ink-500">
              {state === "offline" && pending > 0 ? `离线 · ${pending}` : label}
            </span>
          )}
        </button>
      }
    >
      <div className="w-64 p-1.5 text-body">
        <div className="flex items-center justify-between px-1.5 py-1">
          <span className="text-caption text-ink-500">同步状态</span>
          <span
            className={cn(
              "text-caption font-strong",
              tone === "success" && "text-success-ink",
              tone === "warning" && "text-warning-ink",
              tone === "danger" && "text-danger-ink",
              tone === "accent" && "text-accent",
            )}
          >
            {label}
          </span>
        </div>
        <dl className="space-y-1 px-1.5 py-1 text-caption">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-500">待推送</dt>
            <dd className="numeric text-ink-900">{pending}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-500">失败待处理</dt>
            <dd className={cn("numeric", dead > 0 ? "text-danger-ink" : "text-ink-900")}>{dead}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-500">上次成功</dt>
            <dd className="text-ink-900">{formatSyncTime(lastSyncAt)}</dd>
          </div>
        </dl>
        {error && (
          <p className="mt-1 mx-1.5 rounded-md bg-surface-sunken px-2 py-1.5 text-micro text-ink-500">
            {error}
          </p>
        )}
        <div className="mt-2 flex gap-2 border-t border-border px-1.5 pt-2">
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            onClick={() => void run(syncNow)}
            leftIcon={<RefreshCw className="size-3" aria-hidden="true" />}
          >
            立即同步
          </Button>
          {dead > 0 && (
            <Button size="sm" variant="danger" onClick={() => void run(retryFailed)}>
              重试失败项
            </Button>
          )}
        </div>
      </div>
    </Popover>
  );
}

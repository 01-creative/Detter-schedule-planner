import { useState } from "react";
import {
  Cloud,
  Database,
  Download,
  Monitor,
  Moon,
  RefreshCw,
  Sun,
  Trash,
} from "lucide-react";
import { APP_VERSION } from "@detter/shared";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Switch,
  cn,
  useToast,
} from "@detter/ui";
import { db } from "@/db";
import { getDeviceId, getDeviceName, getPlatform } from "@/lib/device";
import { formatSyncTime } from "@/lib/format";
import { retryFailed, syncNow } from "@/sync/client";
import { useSyncStatus } from "@/sync/useSyncStatus";
import { useUIStore, type ThemeMode } from "@/stores/ui";

/**
 * 设置页。
 *
 * 这一页在 T02 就要「真能用」：同步状态、设备身份、外观、导出、清库，
 * 都是排查问题与验收离线能力的入口，不能只做摆设。
 */
export default function SettingsPage() {
  const { state, pending, dead, lastSyncAt, error } = useSyncStatus();
  const theme = useUIStore((store) => store.theme);
  const setTheme = useUIStore((store) => store.setTheme);
  const { toast } = useToast();

  const [busy, setBusy] = useState<"sync" | "retry" | "export" | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [autoExport, setAutoExport] = useState(false);

  const deviceId = getDeviceId();
  const deviceName = getDeviceName();

  const run = async (kind: "sync" | "retry" | "export", fn: () => Promise<unknown>) => {
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const exportLocalData = async () => {
    const payload: Record<string, unknown> = {
      exportedAt: new Date().toISOString(),
      version: APP_VERSION,
      deviceId,
    };
    for (const table of db.tables) {
      payload[table.name] = await table.toArray();
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `detter-export-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast({ title: "已导出本地数据", tone: "success" });
  };

  const themeOptions: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
    { value: "light", label: "浅色", icon: Sun },
    { value: "dark", label: "深色", icon: Moon },
    { value: "system", label: "跟随系统", icon: Monitor },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <header>
        <p className="text-caption text-ink-500">数据在你的设备上，服务端只是其中一份副本</p>
        <h1 className="mt-1 text-h1 text-ink-900">设置</h1>
      </header>

      <Card className="space-y-4">
        <div className="flex items-center gap-2">
          <Cloud className="size-4 text-accent" aria-hidden="true" />
          <h2 className="text-h2 text-ink-900">同步</h2>
          <Badge
            tone={
              state === "error"
                ? "danger"
                : state === "offline"
                  ? "warning"
                  : state === "syncing"
                    ? "accent"
                    : "success"
            }
            dot
            className="ml-auto"
          >
            {state === "error"
              ? "异常"
              : state === "offline"
                ? "离线"
                : state === "syncing"
                  ? "同步中"
                  : "已同步"}
          </Badge>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-caption sm:grid-cols-4">
          <div className="rounded-md bg-surface-sunken px-3 py-2">
            <dt className="text-ink-500">待推送</dt>
            <dd className="numeric mt-0.5 text-body font-strong text-ink-900">{pending}</dd>
          </div>
          <div className="rounded-md bg-surface-sunken px-3 py-2">
            <dt className="text-ink-500">死信</dt>
            <dd className={cn("numeric mt-0.5 text-body font-strong", dead > 0 ? "text-danger-ink" : "text-ink-900")}>
              {dead}
            </dd>
          </div>
          <div className="rounded-md bg-surface-sunken px-3 py-2">
            <dt className="text-ink-500">上次成功</dt>
            <dd className="mt-0.5 text-body font-strong text-ink-900">{formatSyncTime(lastSyncAt)}</dd>
          </div>
          <div className="rounded-md bg-surface-sunken px-3 py-2">
            <dt className="text-ink-500">游标</dt>
            <dd className="mt-0.5 truncate text-body font-strong text-ink-900">
              {lastSyncAt ? "已建立" : "等待首次同步"}
            </dd>
          </div>
        </dl>

        {error && (
          <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-caption text-warning-ink">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            loading={busy === "sync"}
            onClick={() => void run("sync", syncNow)}
            leftIcon={<RefreshCw className="size-3.5" aria-hidden="true" />}
          >
            立即同步
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={dead === 0}
            loading={busy === "retry"}
            onClick={() =>
              void run("retry", async () => {
                const count = await retryFailed();
                toast({ title: count > 0 ? `已重试 ${count} 条` : "没有需要重试的变更" });
              })
            }
          >
            重试失败项
          </Button>
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-h2 text-ink-900">外观</h2>
        <div className="flex flex-wrap gap-2" role="group" aria-label="外观模式">
          {themeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={theme === option.value}
              onClick={() => setTheme(option.value)}
              className={cn(
                "flex h-10 items-center gap-2 rounded-md border px-3 text-caption transition-colors duration-[var(--dur-1)]",
                theme === option.value
                  ? "border-accent/30 bg-accent-soft text-accent"
                  : "border-border bg-surface-solid text-ink-500 hover:border-border-strong hover:text-ink-900",
              )}
            >
              <option.icon className="size-4" aria-hidden="true" />
              {option.label}
            </button>
          ))}
        </div>
        <p className="text-micro text-ink-300">
          默认浅色；深色模式是一套独立覆盖的变量，不是简单反色。
        </p>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <Monitor className="size-4 text-accent" aria-hidden="true" />
          <h2 className="text-h2 text-ink-900">这台设备</h2>
        </div>
        <dl className="space-y-2 text-caption">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-ink-500">设备名</dt>
            <dd className="text-ink-900">{deviceName}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-ink-500">平台</dt>
            <dd className="text-ink-900">{getPlatform()}</dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="shrink-0 text-ink-500">设备 ID</dt>
            <dd className="min-w-0 truncate font-mono text-micro text-ink-700" title={deviceId}>
              {deviceId}
            </dd>
          </div>
        </dl>
        <p className="text-micro text-ink-300">
          设备 ID 参与冲突判定：两边同时改一条时，更新时间较晚的一方胜，时间相同则 ID 大的胜。
        </p>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <Database className="size-4 text-accent" aria-hidden="true" />
          <h2 className="text-h2 text-ink-900">本地数据</h2>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-md bg-surface-sunken px-3 py-2">
          <div>
            <p className="text-caption text-ink-900">同步后自动导出备份</p>
            <p className="text-micro text-ink-300">占位开关：T12 接入完整的备份策略</p>
          </div>
          <Switch
            checked={autoExport}
            onCheckedChange={setAutoExport}
            label="同步后自动导出备份"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={busy === "export"}
            onClick={() => void run("export", exportLocalData)}
            leftIcon={<Download className="size-3.5" aria-hidden="true" />}
          >
            导出 JSON
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => setConfirmClear(true)}
            leftIcon={<Trash className="size-3.5" aria-hidden="true" />}
          >
            清空本地数据
          </Button>
        </div>
        <p className="text-micro text-ink-300">
          清空只影响这台设备的 IndexedDB；服务端副本仍在，重新登录可再拉回来。
        </p>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-h2 text-ink-900">关于 Detter</h2>
          <p className="mt-0.5 text-micro text-ink-300">
            版本 {APP_VERSION} · 本地优先 · 单人使用
          </p>
        </div>
        <p className="text-micro text-ink-300">四象限 / 目标 / OKR / KPI / 番茄钟 / 捕获 / 导图 / AI 接口</p>
      </Card>

      <Dialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="清空这台设备的本地数据？"
        description="这会删除 IndexedDB 里的全部任务、收件箱与待同步变更，且无法撤销。"
        size="sm"
        dismissible={false}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                void db.delete().then(() => window.location.reload());
              }}
            >
              确认清空
            </Button>
          </>
        }
      >
        <p className="text-caption text-ink-500">
          如果只是想换设备，建议先「导出 JSON」留一份备份。服务端数据不受影响。
        </p>
      </Dialog>
    </div>
  );
}

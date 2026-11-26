import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, RefreshCw } from "lucide-react";
import { Badge, Button, Card, useToast } from "@detter/ui";
import { formatRelative } from "@/lib/format";
import { useNavigate } from "react-router-dom";
import {
  errorMessage,
  listNotifications,
  markNotificationsRead,
  runTickNow,
  type NotificationItem,
} from "./api";

/**
 * 应用内通知箱（inapp 渠道的前端消费端）。
 *
 * 这个渠道的价值是「一定写得进去」：不依赖权限、不依赖外部服务。
 * 设置页里放了最近 5 条 + 未读数，至少让用户能验证「调度确实跑了」；
 * 全局红点属于应用外壳（TopBar）的范围，T14 不改，报告里作为遗留项说明。
 */
const POLL_MS = 30_000;

export function RecentRemindersCard() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"read" | "tick" | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await listNotifications();
      setItems(data.items);
      setUnread(data.unreadCount);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const markAllRead = async () => {
    setBusy("read");
    try {
      const updated = await markNotificationsRead(true);
      await refresh();
      toast({ title: updated > 0 ? `已标记 ${updated} 条为已读` : "没有未读提醒", tone: "success" });
    } catch (caught) {
      toast({ title: "操作失败", description: errorMessage(caught), tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  const runTick = async () => {
    setBusy("tick");
    try {
      const summary = await runTickNow();
      await refresh();
      toast({
        title: "已手动检查一次",
        description: `新排程 ${summary.materialized ?? 0} 条，发送 ${summary.sent ?? 0} 条，失败 ${summary.failed ?? 0} 条。`,
        tone: "success",
      });
    } catch (caught) {
      toast({ title: "检查失败", description: errorMessage(caught), tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  const openItem = async (item: NotificationItem) => {
    if (item.readAt === null) {
      await markNotificationsRead(false, [item.id]).catch(() => undefined);
      void refresh();
    }
    if (item.url) navigate(item.url);
  };

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Bell className="size-4 text-accent" aria-hidden="true" />
        <h2 className="text-h2 text-ink-900">最近提醒</h2>
        {unread > 0 && (
          <Badge tone="danger" dot>
            {unread} 条未读
          </Badge>
        )}
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refresh()}
            leftIcon={<RefreshCw className="size-3.5" aria-hidden="true" />}
          >
            刷新
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={busy === "tick"}
            onClick={() => void runTick()}
          >
            立即检查
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={busy === "read"}
            disabled={unread === 0}
            onClick={() => void markAllRead()}
            leftIcon={<CheckCheck className="size-3.5" aria-hidden="true" />}
          >
            全部已读
          </Button>
        </div>
      </div>

      {error && (
        <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-caption text-warning-ink">
          读取通知失败：{error}
        </p>
      )}

      {items.length === 0 ? (
        <p className="rounded-md bg-surface-sunken px-3 py-3 text-caption text-ink-400">
          这里会显示「应用内通知」渠道写下的提醒。任务到点后即使所有外部渠道都失败，也会有一条落在这里。
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => void openItem(item)}
                className="flex w-full flex-col gap-0.5 py-2 text-left transition-colors hover:bg-surface-sunken/60"
              >
                <span className="flex items-center gap-2">
                  {item.readAt === null ? (
                    <span aria-label="未读" className="size-1.5 shrink-0 rounded-full bg-danger" />
                  ) : (
                    <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-transparent" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-caption text-ink-900">{item.title}</span>
                  <span className="shrink-0 text-micro text-ink-300">{formatRelative(item.createdAt)}</span>
                </span>
                <span className="pl-3.5 text-micro text-ink-400">{item.body}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-micro text-ink-300">
        每 {POLL_MS / 1000} 秒自动刷新。点击一条会跳到对应任务并标记已读。
      </p>
    </Card>
  );
}

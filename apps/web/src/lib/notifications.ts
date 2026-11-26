import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

/**
 * 应用内提醒的全局订阅。
 *
 * 提醒有三个渠道（浏览器推送 / 微信 / 应用内），前两个都不保证送达；
 * 「应用内」是唯一 100% 可靠的一条——但它只有在用户能看到红点时才成立。
 * 所以这里做一层很轻的轮询：页面可见时每 30 秒问一次未读数，切回前台立刻问。
 *
 * 为什么不放进 Zustand：这是一份「服务端状态」，不是 UI 状态；
 * 也没有必要和 Dexie 同步（通知是一次性的投递记录，不进本地库）。
 */

export interface NotificationFeedItem {
  id: string;
  taskId: string | null;
  title: string;
  body: string;
  url: string;
  createdAt: number;
  readAt: number | null;
}

const POLL_INTERVAL_MS = 30_000;

interface FeedState {
  items: NotificationFeedItem[];
  unread: number;
  loaded: boolean;
}

export function useNotificationFeed(enabled: boolean): FeedState & {
  reload: () => Promise<void>;
  markAllRead: () => Promise<void>;
} {
  const [state, setState] = useState<FeedState>({ items: [], unread: 0, loaded: false });
  const mounted = useRef(true);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const data = await api.get<{ items: NotificationFeedItem[]; unreadCount: number }>(
        "/reminders/notifications?limit=5",
      );
      if (!mounted.current) return;
      setState({ items: data.items ?? [], unread: data.unreadCount ?? 0, loaded: true });
    } catch {
      // 离线/未登录时不打扰：保持上一次的数字，等下一轮
      if (mounted.current) setState((prev) => ({ ...prev, loaded: true }));
    }
  }, [enabled]);

  const markAllRead = useCallback(async () => {
    try {
      await api.post("/reminders/notifications/read", { all: true });
    } catch {
      // 标记失败也不阻塞：下一轮轮询会把数字纠回来
    }
    await load();
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) return;

    let timer = 0;
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };

    void load();
    timer = window.setInterval(tick, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);

    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [enabled, load]);

  return { ...state, reload: load, markAllRead };
}

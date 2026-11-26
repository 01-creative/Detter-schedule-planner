import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  BellRing,
  Check,
  MessageCircle,
  RefreshCw,
  Send,
  Smartphone,
} from "lucide-react";
import { Badge, Button, Card, Input, Switch, useToast } from "@detter/ui";
import type { ReminderChannelId, ReminderConfig, WechatProvider } from "./api";
import {
  errorMessage,
  getPushPublicKey,
  getPushStatus,
  getReminderConfig,
  saveReminderConfig,
  sendTestNotification,
} from "./api";
import {
  detectPushSupport,
  disablePush,
  enablePush,
  getCurrentSubscription,
  notificationPermission,
  type PushSupport,
} from "./webpush";
import { CalendarSubscriptionCard } from "./CalendarSubscriptionCard";
import { RecentRemindersCard } from "./RecentRemindersCard";

/**
 * 设置页「提醒」区块（T14 · P4）。
 *
 * 信息层级按「可靠性从低到高」排：
 *   1) 总开关 / 默认提前量 —— 这页的入口；
 *   2) 渠道链：浏览器推送最不可控（大陆 FCM 常常收不到），微信次之；
 *   3) 系统日历订阅 —— 最可靠的一条路，单独一张卡，且给出可直接复制的地址。
 *
 * 所有写操作都回读服务端返回的配置：不在前端维护第二份「当前状态」，
 * 否则刷新/多端会立刻对不上。
 */

const OFFSET_OPTIONS = [
  { value: 0, label: "准点" },
  { value: 5, label: "提前 5 分钟" },
  { value: 10, label: "提前 10 分钟" },
  { value: 15, label: "提前 15 分钟" },
  { value: 30, label: "提前 30 分钟" },
  { value: 60, label: "提前 1 小时" },
  { value: 120, label: "提前 2 小时" },
  { value: 1440, label: "提前 1 天" },
];

const CHANNEL_META: Record<
  ReminderChannelId,
  { title: string; description: string; icon: typeof Bell }
> = {
  inapp: {
    title: "应用内通知",
    description: "写入通知箱，打开 Detter 就能看到红点；不依赖任何外部服务。",
    icon: Bell,
  },
  wechat: {
    title: "微信推送",
    description: "经 PushPlus / Server酱 发到微信，不需要 Google 服务。",
    icon: MessageCircle,
  },
  webpush: {
    title: "浏览器推送",
    description: "系统级通知，页面关掉也能收到；大陆 Android 依赖 FCM，可能收不到。",
    icon: BellRing,
  },
};

const SUPPORT_TEXT: Record<PushSupport, { tone: "success" | "warning" | "danger" | "neutral"; label: string }> = {
  unsupported: { tone: "neutral", label: "当前浏览器不支持" },
  insecure: { tone: "danger", label: "需要 HTTPS" },
  "needs-install": { tone: "warning", label: "需先添加到主屏幕" },
  "permission-denied": { tone: "danger", label: "通知权限被拒绝" },
  "permission-default": { tone: "warning", label: "尚未授权通知" },
  ready: { tone: "success", label: "可以接收通知" },
};

export function ReminderSettingsSection() {
  const { toast } = useToast();
  const [config, setConfig] = useState<ReminderConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const [provider, setProvider] = useState<WechatProvider>("auto");
  const [tokenInput, setTokenInput] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);

  const [pushSupport, setPushSupport] = useState<PushSupport>("unsupported");
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushDevices, setPushDevices] = useState(0);
  const [pushBusy, setPushBusy] = useState(false);
  const [testing, setTesting] = useState<ReminderChannelId | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getReminderConfig();
      setConfig(next);
      setProvider(next.wechatProvider);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setPushSupport(detectPushSupport());
    void getCurrentSubscription().then((subscription) => setPushSubscribed(subscription !== null));
    void getPushStatus()
      .then((status) => setPushDevices(status.devices.filter((device) => device.pushEnabled).length))
      .catch(() => setPushDevices(0));
  }, []);

  const patch = async (body: Parameters<typeof saveReminderConfig>[0], label: string) => {
    setSaving(label);
    try {
      const next = await saveReminderConfig(body);
      setConfig(next);
      setProvider(next.wechatProvider);
      return next;
    } catch (error) {
      toast({ title: "保存失败", description: errorMessage(error), tone: "danger" });
      return null;
    } finally {
      setSaving(null);
    }
  };

  const toggleChannel = (channel: ReminderChannelId) => {
    if (!config) return;
    const has = config.channels.includes(channel);
    if (has && config.channels.length === 1) {
      toast({ title: "至少保留一个渠道", description: "否则提醒就没有出口了。", tone: "info" });
      return;
    }
    const meta = CHANNEL_META[channel];
    const availability = config.availableChannels.find((item) => item.id === channel);
    if (!has && availability && !availability.available) {
      toast({
        title: `${meta.title}暂不可用`,
        description: availability.reason ?? "服务端未配置。",
        tone: "info",
      });
      return;
    }
    const nextChannels = has
      ? config.channels.filter((item) => item !== channel)
      : [...config.channels, channel];
    void patch({ channels: nextChannels }, `channel:${channel}`);
  };

  const saveWechat = async () => {
    const token = tokenInput.trim();
    if (!token && config?.wechatConfigured !== true) {
      toast({ title: "请先填写 token", description: "PushPlus Token 或 Server酱 SendKey。", tone: "info" });
      return;
    }
    setTokenBusy(true);
    try {
      const next = await saveReminderConfig(token ? { wechatProvider: provider, wechatToken: token } : { wechatProvider: provider });
      setConfig(next);
      setProvider(next.wechatProvider);
      setTokenInput("");
      toast({
        title: token ? "微信 token 已保存" : "微信推送设置已保存",
        description: "建议点「发测试消息」确认一次。",
        tone: "success",
      });
    } catch (error) {
      toast({ title: "保存失败", description: errorMessage(error), tone: "danger" });
    } finally {
      setTokenBusy(false);
    }
  };

  const clearWechat = async () => {
    setTokenBusy(true);
    try {
      const next = await saveReminderConfig({ clearWechatToken: true });
      setConfig(next);
      setTokenInput("");
      toast({ title: "已清除微信 token", tone: "success" });
    } catch (error) {
      toast({ title: "清除失败", description: errorMessage(error), tone: "danger" });
    } finally {
      setTokenBusy(false);
    }
  };

  const testChannel = async (channel: ReminderChannelId) => {
    setTesting(channel);
    try {
      const result = await sendTestNotification(channel);
      toast({
        title: result.ok ? "测试消息已发出" : "测试失败",
        description: result.ok
          ? channel === "inapp"
            ? "到下面的「最近提醒」里看看。"
            : "如果几分钟内没收到，说明这条渠道不可用。"
          : (result.error ?? "未知错误"),
        tone: result.ok ? "success" : "danger",
      });
    } catch (error) {
      toast({ title: "测试失败", description: errorMessage(error), tone: "danger" });
    } finally {
      setTesting(null);
    }
  };

  const togglePush = async () => {
    if (!config) return;
    setPushBusy(true);
    try {
      if (pushSubscribed) {
        const result = await disablePush();
        if (!result.ok) throw new Error(result.error);
        setPushSubscribed(false);
        toast({ title: "已关闭本机浏览器推送", tone: "success" });
      } else {
        const key = await getPushPublicKey();
        if (!key.enabled || !key.publicKey) {
          toast({ title: "服务端未配置 VAPID 密钥", tone: "info" });
          return;
        }
        const result = await enablePush(key.publicKey);
        if (!result.ok) throw new Error(result.error);
        setPushSubscribed(true);
        setPushSupport(detectPushSupport());
        toast({ title: "浏览器推送已开启", description: "点「发测试通知」验证一次。", tone: "success" });
      }
      const status = await getPushStatus().catch(() => null);
      if (status) setPushDevices(status.devices.filter((device) => device.pushEnabled).length);
    } catch (error) {
      toast({ title: "操作失败", description: errorMessage(error), tone: "danger" });
    } finally {
      setPushBusy(false);
    }
  };

  if (loadError) {
    return (
      <Card className="space-y-3">
        <h2 className="text-h2 text-ink-900">提醒</h2>
        <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-caption text-warning-ink">
          读取提醒配置失败：{loadError}
        </p>
        <Button size="sm" onClick={() => void refresh()} leftIcon={<RefreshCw className="size-3.5" />}>
          重试
        </Button>
      </Card>
    );
  }

  if (!config) {
    return (
      <Card className="space-y-3">
        <h2 className="text-h2 text-ink-900">提醒</h2>
        <p className="text-caption text-ink-400">正在读取提醒配置…</p>
      </Card>
    );
  }

  const support = SUPPORT_TEXT[pushSupport];
  const permission = notificationPermission();
  const wechatAvailability = config.availableChannels.find((item) => item.id === "wechat");
  const disabledChannels = config.availableChannels.filter((item) => !config.channels.includes(item.id));

  return (
    <div className="space-y-4" id="reminders">
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <BellRing className="size-4 text-accent" aria-hidden="true" />
          <h2 className="text-h2 text-ink-900">提醒</h2>
          <Badge tone={config.enabled ? "success" : "neutral"} dot className="ml-auto">
            {config.enabled ? "已开启" : "已关闭"}
          </Badge>
          <Switch
            checked={config.enabled}
            onCheckedChange={(checked) => void patch({ enabled: checked }, "enabled")}
            label="提醒总开关"
          />
        </div>

        <p className="text-caption text-ink-500">
          提醒是「止损的最后一道闸」：任务到点会自动走下面的渠道。服务端每 {config.tickSeconds} 秒检查一次，
          最多提前 {config.horizonDays} 天排程；同一渠道失败 {config.maxAttempts} 次后自动降级到下一个渠道。
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-caption text-ink-700">新任务默认提前</span>
            <select
              value={config.defaultOffsetMin}
              onChange={(event) => void patch({ defaultOffsetMin: Number(event.target.value) }, "defaultOffset")}
              className="h-9 w-full rounded-md border border-border-strong bg-surface-solid px-2.5 text-body text-ink-900"
              aria-label="新任务默认提前量"
            >
              {OFFSET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="block text-micro text-ink-300">
              保存在服务端设置里，作为新建任务的默认值。
            </span>
          </label>

          <div className="space-y-1.5">
            <span className="text-caption text-ink-700">通知权限</span>
            <div className="flex h-9 items-center gap-2">
              <Badge tone={permission === "granted" ? "success" : permission === "denied" ? "danger" : "warning"} dot>
                {permission === "granted"
                  ? "已授权"
                  : permission === "denied"
                    ? "已拒绝"
                    : permission === "default"
                      ? "未授权"
                      : "不支持"}
              </Badge>
              <span className="text-micro text-ink-300">
                {permission === "denied"
                  ? "点地址栏左侧的站点设置，把「通知」改为允许"
                  : permission === "default"
                    ? "开启浏览器推送时会请求授权"
                    : permission === "unsupported"
                      ? "当前浏览器没有 Notification API"
                      : "系统通知可以弹出"}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-caption text-ink-700">渠道（按顺序降级）</p>
            <p className="text-micro text-ink-300">
              当前：{config.channels.join(" → ")}
            </p>
          </div>
          {config.channels.map((channel, index) => {
            const meta = CHANNEL_META[channel];
            const availability = config.availableChannels.find((item) => item.id === channel);
            const Icon = meta.icon;
            return (
              <div
                key={channel}
                className="flex items-start justify-between gap-3 rounded-md bg-surface-sunken px-3 py-2"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <Icon className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-caption text-ink-900">
                      {index + 1}. {meta.title}
                      {availability && !availability.available && (
                        <Badge tone="warning" className="ml-2">
                          未配置
                        </Badge>
                      )}
                    </p>
                    <p className="text-micro text-ink-300">
                      {availability && !availability.available ? (availability.reason ?? meta.description) : meta.description}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={testing === channel}
                    disabled={testing !== null}
                    onClick={() => void testChannel(channel)}
                  >
                    测试
                  </Button>
                  <Switch
                    checked
                    onCheckedChange={() => toggleChannel(channel)}
                    label={`移除${meta.title}`}
                  />
                </div>
              </div>
            );
          })}

          {disabledChannels.length > 0 && (
            <>
              <p className="text-micro text-ink-300">未启用的渠道：</p>
              <div className="flex flex-wrap gap-2">
                {disabledChannels.map((item) => {
                  const meta = CHANNEL_META[item.id];
                  return (
                    <Button
                      key={item.id}
                      size="sm"
                      variant="secondary"
                      disabled={saving !== null || !item.available}
                      onClick={() => toggleChannel(item.id)}
                      leftIcon={<Check className="size-3.5" aria-hidden="true" />}
                    >
                      启用{meta.title}
                    </Button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <MessageCircle className="size-4 text-accent" aria-hidden="true" />
          <h2 className="text-h2 text-ink-900">微信推送</h2>
          <Badge tone={config.wechatConfigured ? "success" : "neutral"} dot className="ml-auto">
            {config.wechatConfigured ? "已配置" : "未配置"}
          </Badge>
        </div>
        <p className="text-caption text-ink-500">
          国内比 Web Push 可靠得多：PushPlus / Server酱 把消息发到微信，不经过 Google/FCM。
          token 只保存在服务端设置里，接口只回「是否已配置」，不会回显明文。
        </p>

        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <label className="block space-y-1.5">
            <span className="text-caption text-ink-700">服务商</span>
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as WechatProvider)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface-solid px-2.5 text-body text-ink-900"
              aria-label="微信推送服务商"
            >
              <option value="auto">自动识别</option>
              <option value="pushplus">PushPlus</option>
              <option value="serverchan">Server酱</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-caption text-ink-700">Token / SendKey</span>
            <Input
              type="password"
              value={tokenInput}
              autoComplete="off"
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder={config.wechatConfigured ? "已配置（留空保持不变）" : "粘贴 PushPlus Token 或 Server酱 SendKey"}
              aria-label="微信推送 token"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            loading={tokenBusy}
            onClick={() => void saveWechat()}
            leftIcon={<Send className="size-3.5" aria-hidden="true" />}
          >
            {config.wechatConfigured ? "保存设置" : "保存 token"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={testing === "wechat"}
            disabled={!config.wechatConfigured || testing !== null}
            onClick={() => void testChannel("wechat")}
          >
            发测试消息
          </Button>
          {config.wechatConfigured && (
            <Button size="sm" variant="ghost" loading={tokenBusy} onClick={() => void clearWechat()}>
              清除 token
            </Button>
          )}
          {wechatAvailability?.available === false && (
            <span className="text-micro text-ink-300">填好 token 后，「微信推送」渠道才会出现在可选链路里。</span>
          )}
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Smartphone className="size-4 text-accent" aria-hidden="true" />
          <h2 className="text-h2 text-ink-900">浏览器推送（Web Push）</h2>
          <Badge tone={pushSubscribed ? "success" : support.tone} dot className="ml-auto">
            {pushSubscribed ? "本机已订阅" : support.label}
          </Badge>
        </div>
        <p className="text-caption text-ink-500">
          页面关掉也能收到系统通知，但依赖浏览器的推送服务：Chrome/Edge 走 FCM，
          <strong className="text-ink-700">大陆网络经常连不上</strong>；
          iOS 需要 16.4+ 且必须先「添加到主屏幕」。所以它只是渠道之一，不是唯一答案。
        </p>

        <dl className="grid gap-2 rounded-md bg-surface-sunken px-3 py-2 text-micro text-ink-500 sm:grid-cols-2">
          <div>
            <dt className="text-ink-300">服务端 VAPID</dt>
            <dd>{config.vapidConfigured ? "已配置" : "未配置（webpush 渠道自动隐藏）"}</dd>
          </div>
          <div>
            <dt className="text-ink-300">已订阅设备</dt>
            <dd>{pushDevices} 台</dd>
          </div>
          <div>
            <dt className="text-ink-300">浏览器能力</dt>
            <dd>{support.label}</dd>
          </div>
          <div>
            <dt className="text-ink-300">系统通知权限</dt>
            <dd>{permission === "granted" ? "已授权" : permission === "denied" ? "已拒绝" : permission === "default" ? "未请求" : "不支持"}</dd>
          </div>
        </dl>

        {pushSupport === "needs-install" && (
          <p className="rounded-md bg-warning-soft px-3 py-2 text-caption text-warning-ink">
            iPhone / iPad：iOS 16.4 起才支持 Web Push，而且必须先在 Safari 里「分享 → 添加到主屏幕」，
            再从主屏图标打开 Detter 才能开启。国内更建议用下面的系统日历订阅。
          </p>
        )}
        {pushSupport === "permission-denied" && (
          <p className="rounded-md bg-warning-soft px-3 py-2 text-caption text-warning-ink">
            通知权限被拒绝。到浏览器地址栏左侧的站点设置 → 通知 → 允许，刷新本页后重试。
            拒绝不会影响应用其他功能，提醒仍会写进「应用内通知」。
          </p>
        )}
        {!config.vapidConfigured && (
          <p className="rounded-md bg-surface-sunken px-3 py-2 text-caption text-ink-500">
            服务端还没有 VAPID 密钥，浏览器推送无法启用。部署时设置
            <span className="mx-1 font-mono text-ink-700">VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY</span>
            即可（生成方式见报告/README）。
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            loading={pushBusy}
            disabled={
              !config.vapidConfigured ||
              (pushSupport !== "ready" && pushSupport !== "permission-default")
            }
            onClick={() => void togglePush()}
            leftIcon={<BellRing className="size-3.5" aria-hidden="true" />}
            variant={pushSubscribed ? "secondary" : "primary"}
          >
            {pushSubscribed ? "关闭本机推送" : "开启本机推送"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={testing === "webpush"}
            disabled={!pushSubscribed || testing !== null}
            onClick={() => void testChannel("webpush")}
          >
            发测试通知
          </Button>
          <span className="text-micro text-ink-300">
            需要 HTTPS 或 localhost；开发模式不注册 SW，需用生产构建验证。
          </span>
        </div>
      </Card>

      <CalendarSubscriptionCard />

      <RecentRemindersCard />
    </div>
  );
}

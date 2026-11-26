import { useEffect, useState } from "react";
import { CalendarPlus, Check, Copy, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { Badge, Button, Card, Input, useToast } from "@detter/ui";
import { copyText } from "../ai/clipboard";
import {
  createCalendarLink,
  errorMessage,
  getCalendarLink,
  revokeCalendarLink,
  type CalendarLink,
} from "./api";

/**
 * 系统日历订阅（T14 · P4 的「更可靠的路」）。
 *
 * Web Push 在 iOS 要 16.4 + 主屏安装，在大陆 Android 又要过 FCM；而系统日历的提醒
 * 是操作系统/日历服务自己排的，不依赖浏览器进程，也不需要 JS 在跑。
 * 因此这里把「订阅地址」做成可一键复制的一等公民，并明确写出 iOS/Android/Google 的入口。
 *
 * 安全：地址里的 token 是 32 字节随机串，等同于共享密钥。页面只在用户主动生成后显示，
 * 并提供「重新生成」（旧地址立即失效）与「停用」。
 */
export function CalendarSubscriptionCard() {
  const { toast } = useToast();
  const [link, setLink] = useState<CalendarLink | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"create" | "revoke" | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getCalendarLink()
      .then(setLink)
      .catch((error: unknown) => setLoadError(errorMessage(error)));
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const absoluteUrl = link?.path ? new URL(link.path, window.location.origin).href : null;

  const generate = async () => {
    setBusy("create");
    try {
      const next = await createCalendarLink();
      setLink(next);
      setLoadError(null);
      toast({
        title: link?.configured ? "订阅地址已重新生成" : "订阅地址已生成",
        description: link?.configured ? "旧地址已立即失效，记得在日历里换成新地址。" : "复制后加进系统日历即可。",
        tone: "success",
      });
    } catch (error) {
      toast({ title: "生成失败", description: errorMessage(error), tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    setBusy("revoke");
    try {
      const next = await revokeCalendarLink();
      setLink(next);
      toast({ title: "订阅地址已停用", description: "已添加的日历不会自动删除，但不会再更新。", tone: "success" });
    } catch (error) {
      toast({ title: "停用失败", description: errorMessage(error), tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async () => {
    if (!absoluteUrl) return;
    const ok = await copyText(absoluteUrl);
    if (!ok) {
      toast({ title: "复制失败", description: "请手动选中地址复制。", tone: "danger" });
      return;
    }
    setCopied(true);
    toast({ title: "订阅地址已复制", description: "下一步：粘贴到系统日历的「添加已订阅的日历」。", tone: "success" });
  };

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarPlus className="size-4 text-accent" aria-hidden="true" />
        <h2 className="text-h2 text-ink-900">系统日历订阅</h2>
        <Badge tone="accent">国内最可靠</Badge>
        <Badge tone={link?.configured ? "success" : "neutral"} dot className="ml-auto">
          {link?.configured ? "已生成" : "未生成"}
        </Badge>
      </div>

      <p className="text-caption text-ink-500">
        把下面这条地址加进手机自带日历后，提醒由<strong className="text-ink-700">操作系统</strong>在本地排程：
        不依赖浏览器是否开着、不需要 Google 服务、也不会被 FCM 挡住。这是在国内真正「一定会响」的一条路。
      </p>

      {loadError && (
        <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-caption text-warning-ink">
          读取订阅状态失败：{loadError}
        </p>
      )}

      {absoluteUrl ? (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              readOnly
              value={absoluteUrl}
              aria-label="日历订阅地址"
              onFocus={(event) => event.currentTarget.select()}
              className="font-mono text-micro"
            />
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                onClick={() => void handleCopy()}
                leftIcon={
                  copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />
                }
              >
                {copied ? "已复制" : "一键复制"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                loading={busy === "create"}
                onClick={() => void generate()}
                leftIcon={<RefreshCw className="size-3.5" aria-hidden="true" />}
              >
                重新生成
              </Button>
              <Button
                size="sm"
                variant="ghost"
                loading={busy === "revoke"}
                onClick={() => void revoke()}
                leftIcon={<Trash2 className="size-3.5" aria-hidden="true" />}
              >
                停用
              </Button>
            </div>
          </div>

          <div className="rounded-md bg-surface-sunken px-3 py-2">
            <p className="flex items-start gap-1.5 text-micro text-ink-500">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
              这条地址就是密钥：拿到它的人能看到你的全部日程。不要发到群里；怀疑泄露时点「重新生成」，
              旧地址会立即失效。
            </p>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            loading={busy === "create"}
            onClick={() => void generate()}
            leftIcon={<CalendarPlus className="size-3.5" aria-hidden="true" />}
          >
            生成订阅地址
          </Button>
          <span className="text-micro text-ink-300">生成后即可复制到系统日历；随时可以停用。</span>
        </div>
      )}

      <div className="grid gap-2 border-t border-border pt-3 text-micro text-ink-500 sm:grid-cols-3">
        <div>
          <p className="font-strong text-ink-700">iPhone / iPad</p>
          <p>设置 → 日历 → 账户 → 添加账户 → 其他 → 添加已订阅的日历，粘贴地址。</p>
        </div>
        <div>
          <p className="font-strong text-ink-700">Android</p>
          <p>系统日历 → 添加日历 → 通过网址订阅（部分机型叫「日历订阅」），粘贴地址。</p>
        </div>
        <div>
          <p className="font-strong text-ink-700">Google Calendar</p>
          <p>其他日历 → 通过网址添加 → 粘贴地址；刷新间隔由 Google 决定（通常几小时）。</p>
        </div>
      </div>
      <p className="text-micro text-ink-300">
        注意：ICS 是只读快照，日历端按自己的节奏刷新（建议 30 分钟）；在 Detter 里改时间后，
        日历不会像 Web Push 那样立刻变，但到点提醒由系统负责，反而更稳。
      </p>
    </Card>
  );
}

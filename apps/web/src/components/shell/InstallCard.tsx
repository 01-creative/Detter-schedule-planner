import { useState } from "react";
import type { ReactNode } from "react";
import {
  Check,
  Download,
  Ellipsis,
  MonitorDown,
  Share,
  Smartphone,
  SquarePlus,
} from "lucide-react";
import { Badge, Button, Card, cn, useToast } from "@detter/ui";
import { usePwaInstall } from "@/app/pwa";

/**
 * 「安装到主屏」设置卡片（T13 §2）。
 *
 * 三种设备三种说法，因为安装这件事在三个平台上是三件不同的事：
 * - Chromium（Android / 桌面）：浏览器抛 beforeinstallprompt，一个按钮调起原生安装；
 * - iOS Safari：没有安装 API，只能告诉用户「点分享 → 添加到主屏幕」，配图标一步一步讲；
 * - 其它情况（Firefox / 微信内置浏览器 / 还没满足可安装条件）：
 *   给出浏览器菜单里的手动路径，而不是给一个点了没反应的死按钮。
 *
 * 已安装（standalone 窗口）时整块退化成一句话，不再劝用户装第二次。
 */
export function InstallCard() {
  const { canPrompt, installed, platform, isIosSafari, promptInstall } = usePwaInstall();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const install = async () => {
    setBusy(true);
    try {
      const outcome = await promptInstall();
      if (outcome === "accepted") {
        toast({
          title: "正在安装 Detter",
          description: "主屏上马上会多一个图标，之后从图标打开就没有地址栏了",
          tone: "success",
        });
      } else if (outcome === "dismissed") {
        toast({ title: "安装取消了", description: "想装的时候回设置页再点一次就行" });
      } else {
        toast({
          title: "这个浏览器没给安装入口",
          description: "按下面的步骤用浏览器菜单手动添加",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const state = installed ? "installed" : canPrompt ? "promptable" : "manual";

  return (
    <Card className="space-y-3" data-pwa-state={state}>
      <div className="flex items-center gap-2">
        <Smartphone className="size-4 text-accent" aria-hidden="true" />
        <h2 className="text-h2 text-ink-900">安装到主屏</h2>
        <Badge
          tone={installed ? "success" : canPrompt ? "accent" : "neutral"}
          dot
          className="ml-auto"
        >
          {installed ? "已安装" : canPrompt ? "可一键安装" : platform === "ios" ? "需手动添加" : "浏览器菜单安装"}
        </Badge>
      </div>

      <div className="flex items-start gap-3 rounded-md bg-surface-sunken px-3 py-2.5">
        <img
          src="/icon-192.png"
          alt=""
          width={40}
          height={40}
          className="size-10 shrink-0 rounded-lg shadow-1"
          aria-hidden="true"
        />
        <p className="text-caption text-ink-500">
          {installed
            ? "这台设备已经装好了：从主屏图标打开时没有地址栏，断网也能记，数据在本地。"
            : "装好后从主屏图标直接打开：没有地址栏、全屏、离线也能记 —— 掏出来的那一下少两次点击。"}
        </p>
      </div>

      {installed ? (
        <p className="text-micro text-ink-300">
          想卸载：长按主屏图标删除即可，本地数据不会因此丢失。
        </p>
      ) : canPrompt ? (
        <div className="space-y-2">
          <Button
            size="lg"
            variant="primary"
            loading={busy}
            onClick={() => void install()}
            leftIcon={<Download className="size-4" aria-hidden="true" />}
            className="w-full sm:w-auto"
          >
            安装 Detter
          </Button>
          <p className="text-micro text-ink-300">
            浏览器会弹出系统安装确认，确认后主屏出现 Detter 图标。
          </p>
        </div>
      ) : platform === "ios" ? (
        <div className="space-y-3">
          <ol className="space-y-3">
            <Step
              index={1}
              icon={<Share className="size-4" aria-hidden="true" />}
              title="点底部的「分享」"
              description="Safari 工具栏正中间那个方框 + 向上箭头。"
            />
            <Step
              index={2}
              icon={<SquarePlus className="size-4" aria-hidden="true" />}
              title="选「添加到主屏幕」"
              description="列表往下滑一点就能看到；可顺手把名字改成 Detter。"
            />
            <Step
              index={3}
              icon={<Check className="size-4" aria-hidden="true" />}
              title="主屏出现图标，点它打开"
              description="之后每次都是全屏、无地址栏，关掉网络也能用。"
            />
          </ol>
          {!isIosSafari && (
            <p className="rounded-md bg-warning-soft px-3 py-2 text-micro text-warning-ink">
              当前是 iOS 上的非 Safari 浏览器（微信 / Chrome 等），它们不能添加主屏。
              先点「在 Safari 中打开」或复制链接到 Safari，再按上面三步操作。
            </p>
          )}
          <p className="text-micro text-ink-300">
            iOS 没有自动安装弹窗，只能这样加一次；加完就和原生 App 差不多。
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <ol className="space-y-3">
            <Step
              index={1}
              icon={
                <Ellipsis className="size-4" aria-hidden="true" />
              }
              title="打开浏览器菜单"
              description="Chrome / Edge：地址栏右侧的「⋮」或「⋯」；Safari（macOS）：文件菜单。"
            />
            <Step
              index={2}
              icon={<MonitorDown className="size-4" aria-hidden="true" />}
              title="点「安装 Detter」或「添加到主屏幕」"
              description="Chrome / Edge 在「保存并分享」或「应用」子菜单里；Safari 在「文件 → 添加到程序坞」。"
            />
            <Step
              index={3}
              icon={<Check className="size-4" aria-hidden="true" />}
              title="从独立窗口打开"
              description="装好后是一个没有标签页和地址栏的窗口，可固定到任务栏 / 程序坞。"
            />
          </ol>
          <p className="text-micro text-ink-300">
            当前浏览器没有提供自动安装入口（只有 Chromium 系会抛 beforeinstallprompt），
            用菜单手动安装效果一样。
          </p>
        </div>
      )}

      <div className="flex items-start gap-2 border-t border-border pt-3">
        <Share className="mt-0.5 size-3.5 shrink-0 text-ink-300" aria-hidden="true" />
        <p className="text-micro text-ink-300">
          装好以后，系统分享菜单里会多一个 Detter：在别的 App 里看到文字或链接，
          分享过来就直接进收件箱，不用再切回来手动记。
        </p>
      </div>
    </Card>
  );
}

function Step({
  index,
  icon,
  title,
  description,
}: {
  index: number;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <li className="flex gap-3">
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
          "bg-accent-soft text-caption font-strong text-accent",
        )}
        aria-hidden="true"
      >
        {index}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-caption font-strong text-ink-900">
          <span className="text-accent" aria-hidden="true">
            {icon}
          </span>
          {title}
        </span>
        <span className="mt-0.5 block text-micro text-ink-500">{description}</span>
      </span>
    </li>
  );
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

/**
 * 安装引导的状态来源（T13 §2）。
 *
 * 浏览器能力差异很大，这里把它们收敛成四个事实：
 * - `canPrompt`：Chromium 系抛过 `beforeinstallprompt`，可以调起原生安装气泡；
 * - `installed`：已经在 standalone 窗口里跑（装过了，或从主屏图标打开）；
 * - `platform`：ios / android / desktop —— 决定给「点一下安装」还是「图文教手动添加」；
 * - `isIosSafari`：iOS 上只有 Safari 能添加到主屏，微信/Chrome-iOS 内要先换 Safari。
 *
 * 注意 `beforeinstallprompt` 必须 `preventDefault()` 拦下来：浏览器默认会在满足条件时
 * 自己弹一条迷你横幅，而产品希望把入口放在设置页（不打断「3 秒记完」的主流程）。
 */

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: readonly string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt: () => Promise<void>;
}

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";
export type PwaPlatform = "ios" | "android" | "desktop";

interface PwaContextValue {
  canPrompt: boolean;
  installed: boolean;
  platform: PwaPlatform;
  isIosSafari: boolean;
  promptInstall: () => Promise<InstallOutcome>;
}

const PwaContext = createContext<PwaContextValue | null>(null);

function detectInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const modes = ["standalone", "fullscreen", "minimal-ui"] as const;
  const standalone = modes.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);
  // iOS Safari 至今不实现 display-mode 的一部分行为，仍以 navigator.standalone 为准
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || iosStandalone;
}

function detectPlatform(): PwaPlatform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  // iPadOS 13+ 的 UA 伪装成 Mac，靠触点数区分
  const iPadAsMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iPad|iPhone|iPod/.test(ua) || iPadAsMac) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

/** iOS 上只有 Safari 能「添加到主屏幕」；其余 iOS 浏览器（含微信）要先复制链接到 Safari。 */
function detectIosSafari(platform: PwaPlatform): boolean {
  if (platform !== "ios" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isOtherBrowser = /CriOS|FxiOS|EdgiOS|MicroMessenger|QQBrowser|Weibo/.test(ua);
  return /Safari/.test(ua) && !isOtherBrowser;
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const [platform] = useState<PwaPlatform>(detectPlatform);
  const [installed, setInstalled] = useState(detectInstalled);
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    const media = window.matchMedia("(display-mode: standalone)");
    const onDisplayModeChange = () => setInstalled(detectInstalled());
    media.addEventListener("change", onDisplayModeChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      media.removeEventListener("change", onDisplayModeChange);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<InstallOutcome> => {
    if (!promptEvent) return "unavailable";
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      // 一个事件只能 prompt 一次，用掉就丢掉；装成功时 Chrome 还会再抛 appinstalled
      setPromptEvent(null);
      if (choice.outcome === "accepted") setInstalled(true);
      return choice.outcome;
    } catch {
      setPromptEvent(null);
      return "unavailable";
    }
  }, [promptEvent]);

  const value = useMemo<PwaContextValue>(
    () => ({
      canPrompt: Boolean(promptEvent) && !installed,
      installed,
      platform,
      isIosSafari: detectIosSafari(platform),
      promptInstall,
    }),
    [promptEvent, installed, platform, promptInstall],
  );

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}

export function usePwaInstall(): PwaContextValue {
  const value = useContext(PwaContext);
  if (!value) {
    throw new Error("usePwaInstall 必须在 PwaProvider 内使用");
  }
  return value;
}

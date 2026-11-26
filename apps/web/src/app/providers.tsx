import { useEffect } from "react";
import type { ReactNode } from "react";
import { ToastProvider } from "@detter/ui";
import { CapturePanel } from "@/features/capture/CapturePanel";
import { start as startSync, stop as stopSync } from "@/sync/client";
import { AuthProvider, useAuth } from "./auth";
import { PwaProvider } from "./pwa";
import { ThemeProvider } from "./theme";
import "./mobile.css";

/**
 * 全局 Provider 装配。
 *
 * 顺序有讲究：安装能力 → 主题 → 提示 → 鉴权 → 捕获面板。
 * PwaProvider 放在最外层：设置页的「安装到主屏」要读浏览器抛的 beforeinstallprompt，
 * 而那个事件在页面加载几秒内就会到，越早监听越不容易错过。
 * 捕获面板必须在 ToastProvider 内（写入成功要 toast），
 * 也必须在鉴权之后（离线也要能写收件箱，所以它不依赖登录态，只借用离线的宽松放行）。
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <PwaProvider>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <SyncBootstrap />
            {children}
            <CapturePanel />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </PwaProvider>
  );
}

/**
 * 同步循环的启停时机。
 *
 * 之前是「挂载即启动」，结果未登录时会先打一轮 /sync/pull → 401（控制台一条红字，
 * 而且每次冷启动都白跑一轮）。现在只在「确认已登录」或「连不上服务器（离线）」时启动：
 * - 已知未登录：不同的请求本来就会被拦；先把本地用起来，登录后 effect 会再触发一次。
 * - 离线：仍然启动，好让徽标能显示「离线 · N 条待同步」，恢复网络后自动补推。
 */
function SyncBootstrap() {
  const { phase, authenticated, offline } = useAuth();

  useEffect(() => {
    if (phase !== "ready") return;
    if (authenticated || offline) {
      startSync();
      return;
    }
    stopSync();
  }, [phase, authenticated, offline]);

  return null;
}


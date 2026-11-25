import { useEffect } from "react";
import type { ReactNode } from "react";
import { ToastProvider } from "@detter/ui";
import { CapturePanel } from "@/features/capture/CapturePanel";
import { start as startSync } from "@/sync/client";
import { AuthProvider } from "./auth";
import { ThemeProvider } from "./theme";

/**
 * 全局 Provider 装配。
 *
 * 顺序有讲究：主题 → 提示 → 鉴权 → 捕获面板。
 * 捕获面板必须在 ToastProvider 内（写入成功要 toast），
 * 也必须在鉴权之后（离线也要能写收件箱，所以它不依赖登录态，只借用离线的宽松放行）。
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <SyncBootstrap />
          {children}
          <CapturePanel />
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

/** 同步循环只启动一次；StrictMode 下由 start() 内部的 started 标记兜底。 */
function SyncBootstrap() {
  useEffect(() => {
    startSync();
  }, []);
  return null;
}

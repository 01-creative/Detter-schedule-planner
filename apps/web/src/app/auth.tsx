import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AuthStatus } from "@detter/shared";
import { api, isOfflineError } from "@/lib/api";

/**
 * 鉴权状态。
 *
 * 这个产品是本地优先的：服务器连不上时**不能**把用户挡在登录页外面，
 * 否则「断网也能记一条」就成了空话。所以状态里有一个 offline 维度：
 * - phase = checking：还在问服务端，此时前端显示启动态；
 * - offline = true：问不到，直接以本地模式放行；
 * - 只有服务端明确回答「没初始化 / 没登录」才跳 setup / login。
 */

export interface AuthContextValue {
  phase: "checking" | "ready";
  offline: boolean;
  initialized: boolean;
  authenticated: boolean;
  deviceId: string | null;
  version: string | null;
  refresh: () => Promise<void>;
  markAuthenticated: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthSnapshot {
  phase: "checking" | "ready";
  offline: boolean;
  initialized: boolean;
  authenticated: boolean;
  deviceId: string | null;
  version: string | null;
}

const INITIAL: AuthSnapshot = {
  phase: "checking",
  offline: false,
  initialized: false,
  authenticated: false,
  deviceId: null,
  version: null,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(INITIAL);

  const refresh = useCallback(async () => {
    try {
      const status = await api.get<AuthStatus>("/auth/status");
      setSnapshot({
        phase: "ready",
        offline: false,
        initialized: status.initialized,
        authenticated: status.authenticated,
        deviceId: status.deviceId,
        version: status.version,
      });
    } catch (error) {
      if (isOfflineError(error)) {
        // 连不上服务器：本地数据照常可用，同步徽标会显示离线
        setSnapshot((prev) => ({ ...prev, phase: "ready", offline: true }));
      } else {
        // 4xx（例如代理白名单）也不要卡住用户
        setSnapshot((prev) => ({ ...prev, phase: "ready", offline: false }));
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const markAuthenticated = useCallback(() => {
    setSnapshot((prev) => ({
      ...prev,
      phase: "ready",
      offline: false,
      initialized: true,
      authenticated: true,
    }));
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // 离线时也要允许退出：清掉本地会话认知即可
    }
    setSnapshot((prev) => ({ ...prev, authenticated: false, phase: "ready" }));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...snapshot, refresh, markAuthenticated, logout }),
    [snapshot, refresh, markAuthenticated, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth 必须在 <AuthProvider> 内使用");
  return context;
}

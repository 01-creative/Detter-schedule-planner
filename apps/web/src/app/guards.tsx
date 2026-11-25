import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { FullPageLoading } from "@/components/common/LoadingState";
import { useAuth } from "./auth";

/**
 * 路由守卫。
 *
 * 注意「离线放行」这一条：连不上服务端时不能把用户挡在登录页，
 * 否则本地优先就成了一句空话。只有在服务端明确回答「没初始化」或「没登录」
 * 时才跳转。这个取舍在验收里会被反复验证（断网刷新后仍能写收件箱）。
 */
export function RequireAuth() {
  const { phase, offline, initialized, authenticated } = useAuth();
  const location = useLocation();

  if (phase === "checking") return <FullPageLoading />;
  if (offline) return <Outlet />;
  if (!initialized) return <Navigate to="/setup" replace />;
  if (!authenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ returnTo: `${location.pathname}${location.search}` }}
      />
    );
  }
  return <Outlet />;
}

/** 已登录用户不该再看到登录/初始化页。 */
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const { phase, offline, authenticated } = useAuth();

  if (phase === "checking") return <FullPageLoading message="正在检查登录状态…" />;
  if (!offline && authenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}

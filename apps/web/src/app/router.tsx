import { lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/shell/AppShell";
import QuadrantPage from "@/pages/QuadrantPage";
import { RedirectIfAuthenticated, RequireAuth } from "./guards";

/**
 * 路由表。
 *
 * 四象限是首页，必须同步加载（首屏不许多一次往返）。
 * 其余页面路由级 lazy：首屏 JS 才有机会压在 250KB(gzip) 以内。
 */
const InboxPage = lazy(() => import("@/pages/InboxPage"));
const CalendarPage = lazy(() => import("@/pages/CalendarPage"));
const OkrPage = lazy(() => import("@/pages/OkrPage"));
const KpiPage = lazy(() => import("@/pages/KpiPage"));
const FocusPage = lazy(() => import("@/pages/FocusPage"));
const MindMapPage = lazy(() => import("@/pages/MindMapPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const LoginPage = lazy(() => import("@/pages/LoginPage"));
const SetupPage = lazy(() => import("@/pages/SetupPage"));

export function AppRouter() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RedirectIfAuthenticated>
            <LoginPage />
          </RedirectIfAuthenticated>
        }
      />
      <Route
        path="/setup"
        element={
          <RedirectIfAuthenticated>
            <SetupPage />
          </RedirectIfAuthenticated>
        }
      />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<QuadrantPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="okr" element={<OkrPage />} />
          <Route path="kpi" element={<KpiPage />} />
          <Route path="focus" element={<FocusPage />} />
          <Route path="mindmap" element={<MindMapPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

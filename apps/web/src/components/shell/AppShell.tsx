import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { Plus } from "lucide-react";
import { AppErrorBoundary } from "@/components/common/ErrorBoundary";
import { LoadingState } from "@/components/common/LoadingState";
import { useCaptureStore } from "@/stores/capture";
import { MobileTabBar } from "./MobileTabBar";
import { SideNav } from "./SideNav";
import { MobileHeader, TopBar } from "./TopBar";

/**
 * 应用外壳。
 *
 * 三种宽度各有一套骨架（设计规范 §5）：
 * - ≥1024：76px 图标栏 + 56px 工具条 + 主内容；
 * - 768–1023：同样是图标栏 + 工具条，只是没有右侧目标栏（目标栏在该宽度变成抽屉，由页面自己控制）；
 * - <768：52px 标题栏 + 64px 底部 tab + FAB。
 *
 * 页面切换只做「淡入 + 上移 6px / 160ms」，不做共享元素转场：这个产品一天要开十几次，
 * 花哨的转场会在第 20 次打开时变成负担。
 */
export function AppShell() {
  return (
    <div className="min-h-dvh">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[80] focus:rounded-md focus:bg-surface-solid focus:px-3 focus:py-2 focus:text-body focus:text-ink-900 focus:shadow-3"
      >
        跳到主要内容
      </a>
      <SideNav />
      <div className="md:pl-[76px]">
        <TopBar />
        <MobileHeader />
        <main
          id="main-content"
          className="mx-auto w-full max-w-[1440px] px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-6 md:pt-5 md:pb-10 lg:px-8"
        >
          <AppErrorBoundary>
            <PageOutlet />
          </AppErrorBoundary>
        </main>
      </div>
      <MobileTabBar />
      <MobileFab />
    </div>
  );
}

function PageOutlet() {
  const location = useLocation();
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      // key 换成路径 → 每次导航重新挂载，入场动画因此不需要 AnimatePresence 编排，
      // 也不会出现「旧页面在退出时已经渲染了新内容」的闪烁。
      key={location.pathname}
      initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.16, ease: [0.22, 1, 0.36, 1] }}
      className="min-h-[50vh]"
    >
      <Suspense fallback={<LoadingState rows={3} className="py-6" />}>
        <Outlet />
      </Suspense>
    </motion.div>
  );
}

/** 移动端悬浮记录按钮：56px，渐变底，按下缩到 .94（设计规范 §5）。 */
function MobileFab() {
  const openCapture = useCaptureStore((state) => state.openCapture);
  return (
    <button
      type="button"
      onClick={() => openCapture()}
      aria-label="快速记录"
      className="fixed right-4 z-40 flex size-14 items-center justify-center rounded-full gradient-accent text-on-accent shadow-accent transition-transform duration-[var(--dur-1)] ease-out active:scale-[.94] md:hidden"
      style={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}
    >
      <Plus className="size-6" aria-hidden="true" />
    </button>
  );
}

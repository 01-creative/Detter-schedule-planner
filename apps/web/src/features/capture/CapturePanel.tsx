import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useToast } from "@detter/ui";
import { useCaptureStore } from "@/stores/capture";
import { CaptureComposer, type CaptureCommit } from "./CaptureComposer";
import { useKeyboardInset, useMediaQuery } from "./use-media";

/**
 * 快速记录面板（T05 整体重写）。
 *
 * 三件事在这个文件里定死：
 * 1. 入口只有键盘：Ctrl/⌘+K 打开，Ctrl/⌘+Shift+K 打开并直接进入「快速模式」
 *    （忽略上次草稿，适合当场抓一句）。桌面居中偏上，移动端是底部 sheet。
 * 2. 没登录就不给开：/login、/setup 上按快捷键只会得到一句提示。
 *    这里判断的是路由 —— 未登录用户只可能停在这两个页面；而「离线」是允许记录的
 *    （本地优先是产品底线，断网时连登录态都问不到，不能因此把人挡在门外）。
 * 3. 组件常驻挂载（由 providers 挂在路由外侧），AnimatePresence 只控制可见性，
 *    因此从按键到可以输入只有一帧动画的时间，不会有首帧白屏。
 */

/** 未登录时才可能出现的路由。命中即视为「还没登录」。 */
const AUTH_ROUTES = ["/login", "/setup"] as const;

function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function CapturePanel() {
  const open = useCaptureStore((state) => state.open);
  const seed = useCaptureStore((state) => state.seed);
  const closeCapture = useCaptureStore((state) => state.closeCapture);
  const { toast } = useToast();
  const reduceMotion = useReducedMotion();
  const isMobile = useMediaQuery("(max-width: 767px)");
  const keyboardInset = useKeyboardInset(open && isMobile);
  const { pathname } = useLocation();

  const blocked = isAuthRoute(pathname);
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  /** Ctrl+Shift+K 的「快速模式」：跳过草稿恢复，直接一条空输入。 */
  const [quickMode, setQuickMode] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);

  /* 全局快捷键。用 getState 而不是闭包里的 open：监听只绑一次，永远读到最新值。 */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== "k") return;
      event.preventDefault();

      if (blockedRef.current) {
        toast({
          title: "登录之后才能记",
          description: "登录一次，之后断网也能继续往盒子里记。",
          tone: "info",
        });
        return;
      }

      const store = useCaptureStore.getState();
      if (store.open) {
        store.closeCapture();
        return;
      }
      setQuickMode(event.shiftKey);
      store.openCapture();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toast]);

  /* 打开时清掉上一次的成功提示与计数。 */
  useEffect(() => {
    if (!open) return;
    setSavedCount(0);
    setFlash(null);
    return () => {
      window.clearTimeout(flashTimer.current);
    };
  }, [open]);

  /* 如果是在登录页被打开的（例如退出登录的瞬间），立刻收起并提示。 */
  useEffect(() => {
    if (!open || !blocked) return;
    closeCapture();
    toast({
      title: "登录之后才能记",
      description: "这条内容没有被写入，请先登录。",
      tone: "info",
    });
  }, [open, blocked, closeCapture, toast]);

  /* Esc 关闭：焦点在输入框里时由 composer 处理「有内容要按两次」，这里只兜底其它焦点。 */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest("[data-capture-surface]")) return;
      closeCapture();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, closeCapture]);

  const handleSaved = useCallback(
    (count: number, commit: CaptureCommit) => {
      setSavedCount((current) => current + count);
      setFlash(count > 1 ? `已收进盒子 ✓ ${count} 条` : "已收进盒子 ✓");
      window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(null), 1200);
      if (commit !== "save") closeCapture();
    },
    [closeCapture],
  );

  if (typeof document === "undefined") return null;

  const panelMotion = isMobile
    ? { hidden: { opacity: 0, y: reduceMotion ? 0 : 32 }, shown: { opacity: 1, y: 0 } }
    : {
        hidden: { opacity: 0, y: reduceMotion ? 0 : -8, scale: reduceMotion ? 1 : 0.99 },
        shown: { opacity: 1, y: 0, scale: 1 },
      };

  return createPortal(
    <AnimatePresence>
      {open && !blocked && (
        <div
          className={
            isMobile
              ? "fixed inset-0 z-[70] flex items-end justify-center"
              : "fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[16vh] sm:pt-[18vh]"
          }
        >
          <motion.div
            className="absolute inset-0"
            style={{ backgroundColor: "var(--scrim)", backdropFilter: "blur(3px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
            onClick={closeCapture}
            aria-hidden="true"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="快速记录"
            data-capture-surface=""
            initial={panelMotion.hidden}
            animate={panelMotion.shown}
            exit={{ opacity: 0, y: reduceMotion ? 0 : isMobile ? 12 : -4 }}
            transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
            style={isMobile ? { marginBottom: keyboardInset } : undefined}
            className={
              isMobile
                ? "relative max-h-[92dvh] w-full overflow-y-auto overscroll-contain border-t border-border bg-surface-solid pb-[env(safe-area-inset-bottom)] shadow-3"
                : "relative w-full max-w-[640px] overflow-hidden rounded-[var(--r-xl)] border border-border bg-surface-solid shadow-3"
            }
          >
            {/* 成功提示是浮层：绝对定位，不参与布局，因此不会把输入框顶下去 */}
            <AnimatePresence>
              {flash && (
                <motion.div
                  key={flash}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.14 }}
                  className="pointer-events-none absolute top-2 right-3 z-10"
                  role="status"
                  aria-live="polite"
                >
                  <span className="inline-flex items-center rounded-full bg-success-soft px-2.5 py-1 text-micro font-strong text-success-ink shadow-1">
                    {flash}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            <div data-capture-surface="">
              <CaptureComposer
                key={quickMode ? "quick" : "normal"}
                variant={isMobile ? "mobile" : "desktop"}
                seed={quickMode ? "" : seed}
                savedCount={savedCount}
                onSaved={handleSaved}
                onRequestClose={closeCapture}
              />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export default CapturePanel;

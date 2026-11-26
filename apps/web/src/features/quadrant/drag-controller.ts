import type { PointerEvent as ReactPointerEvent } from "react";
import type { Quadrant } from "@detter/shared";
import { resolveDropTarget } from "./geometry";
import type { DragPayload, DragSnapshot, DropTarget } from "./types";

/**
 * 指针拖拽引擎（不用 HTML5 Drag and Drop）。
 *
 * 为什么不用 HTML5 DnD：
 * - 它的 dragimage 无法定制成「半透明卡片 + 轻微旋转」；
 * - 移动端基本不可用（touch 下 dragstart 行为各浏览器不一致）；
 * - 拖拽过程中拿不到稳定的坐标流，做不了自由模式那种像素级落点。
 *
 * 用 Pointer Events 之后：
 * 1. 鼠标：位移 > 4px 才进入拖拽，点击不会被误判成拖动；
 * 2. 触摸：200ms 长按进入拖拽，长按前移动 > 10px 就判定为滚动并放弃；
 * 3. 进入拖拽后，非 passive 的 touchmove 监听会 preventDefault，
 *    在长按已经成立的前提下接管手势，避免页面跟着滚；
 * 4. 浮层位置用 rAF 合并，移动过程中不触发任何 React 重渲染；
 *    只有「落点换格子」这种低频状态才进 state。
 */

export interface DragControllerDeps {
  getOverlay: () => HTMLDivElement | null;
  isFreeMode: () => boolean;
  onDrop: (payload: DragPayload, target: DropTarget) => void;
  onSnapshot: (snapshot: DragSnapshot | null) => void;
}

export interface DragController {
  start: (payload: DragPayload, event: ReactPointerEvent<HTMLElement>) => void;
  applyOverlay: () => void;
  isClickSuppressed: () => boolean;
  isDragging: () => boolean;
  dispose: () => void;
}

interface Session {
  payload: DragPayload;
  pointerId: number;
  pointerType: string;
  startedAt: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  active: boolean;
  frame: number;
  raf: number;
  longPress: number;
  target: DropTarget | null;
  overQuadrant: Quadrant | null;
  scrollEl: HTMLElement | null;
  capturedEl: HTMLElement | null;
  lastHitX: number;
  lastHitY: number;
}

const MOUSE_THRESHOLD = 4;
const TOUCH_THRESHOLD = 10;
const LONG_PRESS_MS = 200;
const EDGE = 40;
const SCROLL_STEP = 8;
const CLICK_SUPPRESS_MS = 350;

export function createDragController(deps: DragControllerDeps): DragController {
  let session: Session | null = null;
  let detach: (() => void) | null = null;
  let suppressUntil = 0;

  /** 触摸拖拽开始后拦掉原生滚动；没有它，手指一动浏览器就把手势收走了。 */
  const preventTouchScroll = (event: TouchEvent) => {
    if (event.cancelable) event.preventDefault();
  };

  function overlayPosition(): { left: number; top: number } {
    const s = session;
    if (!s) return { left: 0, top: 0 };

    if (s.active && deps.isFreeMode() && s.target) {
      // 自由模式：让浮层直接投影到「松手后卡片会待的位置」，
      // 用的是和 CSS 同一套百分比语义（0..1 → 完全落在格内），松手不会跳。
      const { rect, posX, posY } = s.target;
      return {
        left: rect.left + posX * Math.max(0, rect.width - s.width),
        top: rect.top + posY * Math.max(0, rect.height - s.height),
      };
    }
    return { left: s.lastX - s.offsetX, top: s.lastY - s.offsetY };
  }

  function applyOverlay() {
    const el = deps.getOverlay();
    const s = session;
    if (!el || !s || !s.active) return;
    const { left, top } = overlayPosition();
    el.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }

  function elementAt(x: number, y: number): Element | null {
    try {
      return typeof document !== "undefined" ? document.elementFromPoint(x, y) : null;
    } catch {
      return null;
    }
  }

  /** 靠近可滚区域上下边缘 40px 时每帧滚 8px（跨格拖长列表时用得上）。 */
  function autoScroll() {
    const s = session;
    if (!s?.active) return;
    const el = s.scrollEl;
    if (el && el.scrollHeight > el.clientHeight + 1) {
      const rect = el.getBoundingClientRect();
      if (s.lastY < rect.top - 8 || s.lastY > rect.bottom + 8) return;
      const max = el.scrollHeight - el.clientHeight;
      if (s.lastY < rect.top + EDGE) {
        const next = Math.max(0, el.scrollTop - SCROLL_STEP);
        // 已经到顶就别再写 scrollTop：每帧一次无效写入会触发整段滚动重排
        if (next !== el.scrollTop) el.scrollTop = next;
      } else if (s.lastY > rect.bottom - EDGE) {
        const next = Math.min(max, el.scrollTop + SCROLL_STEP);
        if (next !== el.scrollTop) el.scrollTop = next;
      }
      return;
    }
    if (typeof window === "undefined") return;
    if (s.lastY < 72) window.scrollBy(0, -SCROLL_STEP);
    else if (s.lastY > window.innerHeight - 120) window.scrollBy(0, SCROLL_STEP);
  }

  function hitTest(force = false) {
    const s = session;
    if (!s) return;
    // 指针没怎么动就不用重新做命中测试：elementFromPoint + 读矩形是强制布局
    if (
      !force &&
      Math.abs(s.lastX - s.lastHitX) < 8 &&
      Math.abs(s.lastY - s.lastHitY) < 8
    ) {
      return;
    }
    s.lastHitX = s.lastX;
    s.lastHitY = s.lastY;

    const target = resolveDropTarget(s.lastX, s.lastY);
    s.target = target;
    const hit = target ? elementAt(s.lastX, s.lastY) : null;
    s.scrollEl = hit?.closest<HTMLElement>("[data-quadrant-body]") ?? null;

    const quadrant = target?.quadrant ?? null;
    if (quadrant !== s.overQuadrant) {
      s.overQuadrant = quadrant;
      deps.onSnapshot({
        payload: s.payload,
        width: s.width,
        height: s.height,
        overQuadrant: quadrant,
      });
    }
  }

  function tick() {
    const s = session;
    if (!s?.active) return;
    s.frame += 1;
    // 命中测试要读布局，降到约 20fps；位置每帧都跟手
    if (s.frame % 3 === 0) hitTest();
    applyOverlay();
    autoScroll();
    if (session) session.raf = requestAnimationFrame(tick);
  }

  function activate() {
    const s = session;
    if (!s || s.active) return;
    s.active = true;
    if (s.longPress) {
      clearTimeout(s.longPress);
      s.longPress = 0;
    }
    if (typeof document !== "undefined") {
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    }
    if (s.pointerType === "touch") {
      document.addEventListener("touchmove", preventTouchScroll, { passive: false });
      navigator.vibrate?.(10);
    }
    deps.onSnapshot({
      payload: s.payload,
      width: s.width,
      height: s.height,
      overQuadrant: null,
    });
    hitTest(true);
    s.raf = requestAnimationFrame(tick);
  }

  function teardown() {
    const s = session;
    detach?.();
    detach = null;
    if (s) {
      if (s.raf) cancelAnimationFrame(s.raf);
      if (s.longPress) clearTimeout(s.longPress);
      if (s.capturedEl) {
        try {
          s.capturedEl.releasePointerCapture(s.pointerId);
        } catch {
          // 某些浏览器在元素已卸载时会抛，忽略
        }
      }
    }
    if (typeof document !== "undefined") {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("touchmove", preventTouchScroll);
    }
    session = null;
  }

  function finish(commit: boolean) {
    const s = session;
    if (!s) return;
    const wasActive = s.active;
    const payload = s.payload;
    const target = commit && wasActive ? (s.target ?? resolveDropTarget(s.lastX, s.lastY)) : null;

    teardown();
    if (wasActive) {
      // 拖完那一下的 click 不该再打开详情面板
      suppressUntil = Date.now() + CLICK_SUPPRESS_MS;
      if (commit && target) deps.onDrop(payload, target);
    }
    deps.onSnapshot(null);
  }

  /** 触摸时手指先动了：判定为滚动，不进入拖拽，也不吞掉后续点击。 */
  function abandon() {
    if (!session) return;
    teardown();
    deps.onSnapshot(null);
  }

  function start(payload: DragPayload, event: ReactPointerEvent<HTMLElement>) {
    if (session) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const el = event.currentTarget;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const s: Session = {
      payload,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startedAt: Date.now(),
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      active: false,
      frame: 0,
      raf: 0,
      longPress: 0,
      target: null,
      overQuadrant: null,
      scrollEl: null,
      capturedEl: el,
      lastHitX: event.clientX,
      lastHitY: event.clientY,
    };
    session = s;

    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      // jsdom / 老浏览器没有指针捕获，退回 window 监听
    }

    const onMove = (ev: PointerEvent) => {
      if (!session || ev.pointerId !== session.pointerId) return;
      session.lastX = ev.clientX;
      session.lastY = ev.clientY;

      if (!session.active) {
        const dx = ev.clientX - session.startX;
        const dy = ev.clientY - session.startY;
        const distance = Math.hypot(dx, dy);
        if (session.pointerType === "touch") {
          if (distance > TOUCH_THRESHOLD) {
            const held = Date.now() - session.startedAt >= LONG_PRESS_MS - 60;
            // 横向滑动不会被当成页面滚动，可以直接拖；竖向则按任务书：
            // 长按之前的移动视为滚动，放弃拖拽。已经按住超过长按时长的慢速拖动也放行。
            if (held || (Math.abs(dx) > 14 && Math.abs(dy) < 10)) activate();
            else abandon();
          }
        } else if (distance > MOUSE_THRESHOLD) {
          activate();
        }
        return;
      }
      applyOverlay();
    };

    const onUp = (ev: PointerEvent) => {
      if (!session || ev.pointerId !== session.pointerId) return;
      finish(true);
    };

    const onCancel = (ev: PointerEvent) => {
      if (!session || ev.pointerId !== session.pointerId) return;
      finish(false);
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || !session) return;
      ev.preventDefault();
      finish(false);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKeyDown);

    detach = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKeyDown);
    };

    if (event.pointerType === "touch") {
      s.longPress = window.setTimeout(() => {
        if (!session) return;
        session.longPress = 0;
        activate();
      }, LONG_PRESS_MS);
    }
  }

  return {
    start,
    applyOverlay,
    isClickSuppressed: () => Date.now() < suppressUntil,
    isDragging: () => Boolean(session?.active),
    dispose: teardown,
  };
}

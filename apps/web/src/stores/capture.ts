import { create } from "zustand";

/**
 * 捕获面板的开关。
 *
 * 放在 store 而不是组件状态里：快捷键监听挂在窗口上，桌面 FAB、顶部搜索位、
 * 移动端「+」都要能打开同一个面板，需要一个跨组件的开关。
 */
interface CaptureState {
  open: boolean;
  /** 打开时可以带一段预填文本（例如从搜索框带过来的关键词） */
  seed: string;
  openCapture: (seed?: string) => void;
  closeCapture: () => void;
  toggleCapture: () => void;
}

export const useCaptureStore = create<CaptureState>((set) => ({
  open: false,
  seed: "",
  openCapture: (seed = "") => set({ open: true, seed }),
  closeCapture: () => set({ open: false }),
  toggleCapture: () => set((state) => ({ open: !state.open, seed: state.open ? "" : state.seed })),
}));

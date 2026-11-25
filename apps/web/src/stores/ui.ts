import { create } from "zustand";

/**
 * UI 状态（Zustand 只放这些）。
 *
 * 为什么主题也算 UI 状态：它是「这台设备怎么显示」，不属于可同步的领域数据；
 * 换成深色不该产生一条要推到服务端的记录。
 */

export type ThemeMode = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "detter.theme";

function readStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    // 隐私模式下读不到就用系统偏好
  }
  return "system";
}

interface UIState {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;

  /** 桌面左侧导航是否展开（hover / 键盘聚焦时） */
  navExpanded: boolean;
  setNavExpanded: (expanded: boolean) => void;

  /** 四象限右侧目标栏在桌面端是否收起 */
  goalRailCollapsed: boolean;
  toggleGoalRailCollapsed: () => void;

  /** 平板上目标栏变成抽屉 */
  goalRailDrawerOpen: boolean;
  setGoalRailDrawerOpen: (open: boolean) => void;

  /** 移动端底部「更多」 */
  mobileMoreOpen: boolean;
  setMobileMoreOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => set({ theme }),

  navExpanded: false,
  setNavExpanded: (navExpanded) => set({ navExpanded }),

  goalRailCollapsed: false,
  toggleGoalRailCollapsed: () =>
    set((state) => ({ goalRailCollapsed: !state.goalRailCollapsed })),

  goalRailDrawerOpen: false,
  setGoalRailDrawerOpen: (goalRailDrawerOpen) => set({ goalRailDrawerOpen }),

  mobileMoreOpen: false,
  setMobileMoreOpen: (mobileMoreOpen) => set({ mobileMoreOpen }),
}));

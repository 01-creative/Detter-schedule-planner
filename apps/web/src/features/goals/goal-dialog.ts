import { create } from "zustand";
import type { Goal } from "@detter/shared";

/**
 * 「新建目标」对话框的开关。
 *
 * 板子的右键菜单（关联目标 → 新建目标）和目标栏底部的按钮都要能打开它，
 * 两边不在同一棵子树里，所以用一个只装 UI 状态的小 store。
 * 注意：实体数组绝不进 store（07-FRONTEND-STRUCTURE §4）。
 */
interface GoalDialogState {
  open: boolean;
  presetTitle: string;
  /** 创建成功后回调：右键菜单用它把新目标关联到当前任务 */
  onCreated: ((goal: Goal) => void) | null;
  openDialog: (options?: { title?: string; onCreated?: (goal: Goal) => void }) => void;
  closeDialog: () => void;
}

export const useGoalDialogStore = create<GoalDialogState>((set) => ({
  open: false,
  presetTitle: "",
  onCreated: null,
  openDialog: (options) =>
    set({
      open: true,
      presetTitle: options?.title ?? "",
      onCreated: options?.onCreated ?? null,
    }),
  closeDialog: () => set({ open: false, presetTitle: "", onCreated: null }),
}));

export function openGoalDialog(options?: { title?: string; onCreated?: (goal: Goal) => void }): void {
  useGoalDialogStore.getState().openDialog(options);
}

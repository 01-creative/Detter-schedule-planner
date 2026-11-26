import { QUADRANT_META, QUADRANT_ORDER } from "@detter/shared";
import type { Goal, Quadrant, Task } from "@detter/shared";

/**
 * 右键菜单的「模型」。
 *
 * 和渲染拆开的原因：菜单里哪些项该出现、哪些该禁用、哪一项当前激活，
 * 是最容易被改坏又最难手点的地方。做成纯函数后可以直接断言（见单测）。
 * 菜单组件只负责画出来和键盘焦点，不参与业务判断。
 */

export type MenuEntry =
  | {
      type: "item";
      key: string;
      label: string;
      danger?: boolean;
      disabled?: boolean;
      active?: boolean;
      shortcut?: string;
    }
  | { type: "submenu"; key: string; label: string; items: MenuEntry[] }
  | { type: "separator"; key: string };

export interface TaskMenuContext {
  task: Task;
  goals: readonly Goal[];
  /** 卡片当前所在象限（菜单里的「移动到」用它标出当前位置） */
  quadrant: Quadrant;
}

/** 空白色右键：只需要「在此新建任务」，别把整张任务菜单搬过来。 */
export function buildCellContextMenu(): MenuEntry[] {
  return [{ type: "item", key: "new", label: "在此新建任务" }];
}

export function buildTaskContextMenu({ task, goals, quadrant }: TaskMenuContext): MenuEntry[] {
  const done = task.status === "done";

  return [
    { type: "item", key: "new", label: "新建任务" },
    { type: "separator", key: "sep-1" },
    {
      type: "item",
      key: "toggle-done",
      label: done ? "取消完成" : "完成",
      shortcut: "Space",
    },
    {
      type: "submenu",
      key: "move",
      label: "移动到",
      items: QUADRANT_ORDER.map((target) => ({
        type: "item" as const,
        key: `move:${target}`,
        label: `Q${target} ${QUADRANT_META[target].short}`,
        active: target === quadrant,
      })),
    },
    { type: "item", key: "coords", label: "设置精确坐标…" },
    {
      type: "submenu",
      key: "goal",
      label: "关联目标",
      items: [
        ...goals
          .filter((goal) => goal.status === "active")
          .map((goal) => ({
            type: "item" as const,
            key: `goal:${goal.id}`,
            label: goal.title,
            active: goal.id === task.goalId,
          })),
        ...(goals.some((goal) => goal.status === "active")
          ? []
          : [
              {
                type: "item" as const,
                key: "goal:none",
                label: "还没有进行中的目标",
                disabled: true,
              },
            ]),
        { type: "separator" as const, key: "goal-sep" },
        {
          type: "item" as const,
          key: task.goalId ? "goal:clear" : "goal:new",
          label: task.goalId ? "取消关联" : "新建目标…",
        },
      ],
    },
    { type: "separator", key: "sep-2" },
    { type: "item", key: "copy", label: "复制标题" },
    { type: "item", key: "delete", label: "删除", danger: true, shortcut: "Del" },
  ];
}

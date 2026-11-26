import type { ReactNode } from "react";
import {
  ChevronDown,
  ChevronUp,
  ListTodo,
  Palette,
  Pencil,
  Plus,
  Target,
  Trash2,
} from "lucide-react";
import type { Goal } from "@detter/shared";
import { Popover, cn } from "@detter/ui";
import type { LayoutNode } from "./layout";

/**
 * 选中节点后的浮动工具条。
 *
 * 位置由 stage 用「节点屏幕坐标」算好再传进来（left/top 已经是容器内坐标），
 * 这样工具条永远贴着节点、随缩放移动，而不用把整条工具条塞进被缩放的图层里
 * ——那样文字会跟着缩放，看起来会糊。
 */

export const TOOLBAR_WIDTH = 232;
export const TOOLBAR_HEIGHT = 40;

/** 上色用的固定色板：取设计系统里的强调色，存的是真实 hex（同步到别的设备也能用）。 */
export const NODE_COLORS = [
  { value: "#6355F6", label: "紫" },
  { value: "#0EA5E9", label: "蓝" },
  { value: "#10B981", label: "绿" },
  { value: "#F59E0B", label: "橙" },
  { value: "#EF4444", label: "红" },
  { value: "#E11D48", label: "玫红" },
  { value: "#64748B", label: "灰蓝" },
] as const;

export interface NodeToolbarProps {
  node: LayoutNode;
  /** 容器内坐标（工具条的水平中心） */
  left: number;
  /** 容器内坐标（工具条底边贴着节点的顶边） */
  top: number;
  goals: readonly Goal[];
  linkedGoalId: string | null;
  isTask: boolean;
  onEdit: () => void;
  onAddChild: () => void;
  onToggleCollapse: () => void;
  onConvertToTask: () => void;
  onLinkGoal: (goalId: string) => void;
  onColor: (color: string | null) => void;
  onDelete: () => void;
}

interface IconButtonProps {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  tone?: "default" | "danger";
}

function IconButton({ label, onClick, children, active, disabled, tone = "default" }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative inline-flex size-7 items-center justify-center rounded-sm transition-colors duration-[var(--dur-1)]",
        // 工具条宽 232 是定死的（stage 按它算贴边），所以视觉不能放大：
        // 命中区改成「上下各借 8px → 44 高」「左右各借 1px 刚好吃掉 gap-0.5」，
        // 这样按钮之间永远不重叠，也不会因为命中区交叉点错。
        "after:absolute after:-inset-y-2 after:-inset-x-px after:content-['']",
        "text-ink-500 hover:bg-surface-sunken hover:text-ink-900",
        active && "bg-accent-soft text-accent",
        tone === "danger" && "hover:bg-danger-soft hover:text-danger-ink",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      {children}
    </button>
  );
}

export function NodeToolbar({
  node,
  left,
  top,
  goals,
  linkedGoalId,
  isTask,
  onEdit,
  onAddChild,
  onToggleCollapse,
  onConvertToTask,
  onLinkGoal,
  onColor,
  onDelete,
}: NodeToolbarProps) {
  const goalTitle = linkedGoalId ? (goals.find((goal) => goal.id === linkedGoalId)?.title ?? null) : null;

  return (
    <div
      role="toolbar"
      aria-label="节点操作"
      style={{
        left,
        top,
        width: TOOLBAR_WIDTH,
        transform: "translateX(-50%)",
      }}
      className="absolute z-30 flex items-center gap-0.5 rounded-lg border border-border bg-surface-solid/95 p-1 shadow-3 backdrop-blur-[14px]"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <IconButton label="编辑文本" onClick={onEdit}>
        <Pencil className="size-3.5" aria-hidden="true" />
      </IconButton>
      <IconButton label="新建子节点" onClick={onAddChild}>
        <Plus className="size-3.5" aria-hidden="true" />
      </IconButton>

      <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />

      <Popover
        align="center"
        label="关联目标"
        trigger={
          <button
            type="button"
            aria-label="关联目标"
            title={goalTitle ? `已关联：${goalTitle}` : "关联目标"}
            className={cn(
              "relative inline-flex size-7 items-center justify-center rounded-sm text-ink-500 transition-colors duration-[var(--dur-1)] after:absolute after:-inset-y-2 after:-inset-x-px after:content-[''] hover:bg-surface-sunken hover:text-ink-900",
              linkedGoalId && "bg-accent-soft text-accent",
            )}
          >
            <Target className="size-3.5" aria-hidden="true" />
          </button>
        }
        className="max-h-64 w-52 overflow-y-auto"
      >
        <div className="flex flex-col">
          <p className="px-2 py-1 text-micro text-ink-300">挂到哪个目标</p>
          {goals.length === 0 && <p className="px-2 py-2 text-caption text-ink-500">还没有目标</p>}
          {goals.map((goal) => (
            <button
              key={goal.id}
              type="button"
              role="menuitem"
              onClick={() => onLinkGoal(goal.id)}
              className={cn(
                "flex h-11 items-center gap-2 rounded-sm px-2 text-left text-caption transition-colors duration-[var(--dur-1)] hover:bg-surface-sunken",
                linkedGoalId === goal.id ? "text-accent" : "text-ink-700",
              )}
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: goal.color }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">{goal.title}</span>
            </button>
          ))}
          {linkedGoalId && (
            <button
              type="button"
              role="menuitem"
              onClick={() => onLinkGoal("")}
              className="mt-1 flex h-11 items-center rounded-sm px-2 text-left text-caption text-ink-500 hover:bg-surface-sunken"
            >
              取消关联
            </button>
          )}
        </div>
      </Popover>

      <Popover
        align="center"
        label="节点颜色"
        trigger={
          <button
            type="button"
            aria-label="上色"
            title="上色"
            className="relative inline-flex size-7 items-center justify-center rounded-sm text-ink-500 transition-colors duration-[var(--dur-1)] after:absolute after:-inset-y-2 after:-inset-x-px after:content-[''] hover:bg-surface-sunken hover:text-ink-900"
          >
            <Palette className="size-3.5" aria-hidden="true" />
          </button>
        }
      >
        <div className="grid grid-cols-4 gap-1.5 p-1">
          <button
            type="button"
            aria-label="默认颜色"
            onClick={() => onColor(null)}
            className="relative size-5 rounded-full border border-border-strong bg-surface-solid after:absolute after:-inset-[3px] after:content-['']"
          />
          {NODE_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              aria-label={`颜色 ${color.label}`}
              onClick={() => onColor(color.value)}
              className={cn(
                "relative size-5 rounded-full ring-offset-1 transition-transform duration-[var(--dur-1)] hover:scale-110 after:absolute after:-inset-[3px] after:content-['']",
                node.node.color === color.value && "ring-2 ring-accent",
              )}
              style={{ backgroundColor: color.value }}
            />
          ))}
        </div>
      </Popover>

      {node.hasChildren && (
        <IconButton
          label={node.collapsed ? "展开子节点" : "折叠子节点"}
          onClick={onToggleCollapse}
          active={node.collapsed}
        >
          {node.collapsed ? (
            <ChevronDown className="size-3.5" aria-hidden="true" />
          ) : (
            <ChevronUp className="size-3.5" aria-hidden="true" />
          )}
        </IconButton>
      )}

      <IconButton
        label={isTask ? "已转成任务" : "转成任务"}
        onClick={onConvertToTask}
        disabled={isTask}
        active={isTask}
      >
        <ListTodo className="size-3.5" aria-hidden="true" />
      </IconButton>

      <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />

      <IconButton label="删除节点及子树" onClick={onDelete} tone="danger">
        <Trash2 className="size-3.5" aria-hidden="true" />
      </IconButton>
    </div>
  );
}

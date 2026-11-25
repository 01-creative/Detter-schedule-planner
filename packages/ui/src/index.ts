/**
 * @detter/ui —— 无业务逻辑的展示层。
 *
 * 约定：
 * - 只依赖令牌与 motion，不知道任务/目标/同步这些领域概念；
 * - 所有颜色来自 CSS 变量，深浅色切换不需要改组件；
 * - 可点击元素必须带 aria-label，焦点环交给全局 :focus-visible 规则。
 */
export { cn } from "./lib/cn";

export { Button } from "./components/Button";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./components/Button";
export { Card } from "./components/Card";
export type { CardProps } from "./components/Card";
export { Surface } from "./components/Surface";
export type { SurfaceProps } from "./components/Surface";
export { Input } from "./components/Input";
export type { InputProps } from "./components/Input";
export { Textarea } from "./components/Textarea";
export type { TextareaProps } from "./components/Textarea";
export { Badge } from "./components/Badge";
export type { BadgeProps, BadgeTone } from "./components/Badge";
export { Chip } from "./components/Chip";
export type { ChipProps } from "./components/Chip";
export { Dialog } from "./components/Dialog";
export type { DialogProps } from "./components/Dialog";
export { Sheet } from "./components/Sheet";
export type { SheetProps } from "./components/Sheet";
export { Popover } from "./components/Popover";
export type { PopoverProps } from "./components/Popover";
export { Menu } from "./components/Menu";
export type { MenuItem, MenuProps } from "./components/Menu";
export { Tooltip } from "./components/Tooltip";
export type { TooltipProps } from "./components/Tooltip";
export { Tabs } from "./components/Tabs";
export type { TabItem, TabsProps } from "./components/Tabs";
export { Progress } from "./components/Progress";
export type { ProgressProps } from "./components/Progress";
export { Switch } from "./components/Switch";
export type { SwitchProps } from "./components/Switch";
export { Skeleton } from "./components/Skeleton";
export type { SkeletonProps } from "./components/Skeleton";
export { Avatar } from "./components/Avatar";
export type { AvatarProps } from "./components/Avatar";
export { Divider } from "./components/Divider";
export type { DividerProps } from "./components/Divider";
export { EmptyState } from "./components/EmptyState";
export type { EmptyStateProps } from "./components/EmptyState";
export { ToastProvider, useToast } from "./components/Toast";
export type { ToastOptions, ToastProviderProps, ToastTone } from "./components/Toast";

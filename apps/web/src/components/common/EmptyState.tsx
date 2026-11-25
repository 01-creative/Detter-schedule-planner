import type { ReactNode } from "react";
import { EmptyState as UIEmptyState } from "@detter/ui";
import type { EmptyStateProps } from "@detter/ui";

export interface AppEmptyStateProps extends Omit<EmptyStateProps, "icon"> {
  icon?: ReactNode;
}

/**
 * 空态（应用版）。
 *
 * 与 UI 包里的纯展示组件区别：这里约定「没有内容时一定要给出下一步」，
 * 所以 action 在类型上保留、在使用处传主 CTA（通常是「记一条」）。
 */
export function EmptyState({ icon, title, description, action, size, className }: AppEmptyStateProps) {
  return (
    <UIEmptyState
      icon={icon}
      title={title}
      description={description}
      action={action}
      size={size}
      className={className}
    />
  );
}

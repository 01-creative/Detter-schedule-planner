import type { ReactNode } from "react";
import { Button, Dialog } from "@detter/ui";

/**
 * 确认对话框（破坏性动作前的最后一道闸）。
 *
 * 只做三件事：标题、一句话说清后果、明确的两个按钮。
 * 不提供「不再提示」——这个产品里没有那么多反复确认的场景，
 * 但删除这类不可逆（只能靠撤销窗）的动作必须停下来问一次。
 */
export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "确定",
  cancelLabel = "取消",
  tone = "default",
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {/* 具体影响由调用方放在 description 里；这里留空保持对话框紧凑 */}
      <span className="sr-only">{title}</span>
    </Dialog>
  );
}

export default ConfirmDialog;

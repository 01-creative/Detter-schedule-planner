import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import type { Goal, Quadrant } from "@detter/shared";
import { QUADRANT_META, QUADRANT_ORDER } from "@detter/shared";
import { Button, Dialog, cn } from "@detter/ui";
import { templateTitles } from "./rules";

/**
 * 模板「铺开」确认。
 *
 * 任务书要求「弹出确认（生成几条、分别是什么）」——所以这里不是一句
 * 「确定要铺开吗」，而是把每一条要生成的任务列出来，允许逐条取消。
 * 顺手给一个「放进哪个象限」的选择，默认 Q2（重要不紧急，计划区）。
 */
export interface TemplateDialogProps {
  goal: Goal | null;
  onClose: () => void;
  onConfirm: (goal: Goal, titles: string[], quadrant: Quadrant) => void;
}

export function TemplateDialog({ goal, onClose, onConfirm }: TemplateDialogProps) {
  const titles = useMemo(() => (goal ? templateTitles(goal) : []), [goal]);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [quadrant, setQuadrant] = useState<Quadrant>(2);

  useEffect(() => {
    if (!goal) return;
    setSelected(templateTitles(goal).map(() => true));
    setQuadrant(2);
  }, [goal]);

  if (!goal) return null;

  const chosen = titles.filter((_, index) => selected[index]);
  const filled = goal.milestones.length > 0;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`铺开「${goal.title}」`}
      description={
        filled
          ? "按里程碑拆成任务，取消勾选的不会创建。"
          : "这个模板还没有里程碑，只会生成目标本身一条任务。"
      }
      size="md"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={chosen.length === 0}
            onClick={() => onConfirm(goal, chosen, quadrant)}
          >
            生成 {chosen.length} 条
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-1.5">
          {titles.map((title, index) => {
            const checked = Boolean(selected[index]);
            return (
              <li key={`${title}-${index}`}>
                <button
                  type="button"
                  aria-pressed={checked}
                  onClick={() =>
                    setSelected((current) =>
                      titles.map((_, position) =>
                        position === index ? !current[position] : Boolean(current[position]),
                      ),
                    )
                  }
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-[var(--dur-1)]",
                    "hover:bg-surface-sunken",
                    !checked && "opacity-50",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-4 shrink-0 items-center justify-center rounded border",
                      checked
                        ? "border-transparent bg-accent text-on-accent"
                        : "border-border-strong text-transparent",
                    )}
                  >
                    <Check className="size-2.5" strokeWidth={3} aria-hidden="true" />
                  </span>
                  <span className="tabular w-4 shrink-0 text-micro text-ink-300">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-caption text-ink-700">{title}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div>
          <p className="mb-1.5 text-micro text-ink-500">放进哪个象限</p>
          <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="目标象限">
            {QUADRANT_ORDER.map((value) => {
              const active = quadrant === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setQuadrant(value)}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-md border px-2 text-caption transition-colors duration-[var(--dur-1)]",
                    active
                      ? "border-accent/40 bg-accent-soft text-accent"
                      : "border-border bg-surface-solid text-ink-500 hover:text-ink-700",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: `var(--q${value}-accent)` }}
                  />
                  <span className="truncate">
                    Q{value} {QUADRANT_META[value].short}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

export default TemplateDialog;

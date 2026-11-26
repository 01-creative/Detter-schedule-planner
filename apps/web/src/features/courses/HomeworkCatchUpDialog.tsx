import { useState } from "react";
import { Check } from "lucide-react";
import type { Course } from "@detter/shared";
import { Button, Dialog, Input } from "@detter/ui";

/**
 * 「这周有 N 门课还没记作业」→ 点进来直接补。
 *
 * 每门课一行输入框：写完按回车/点「记下」就完成，不跳页、不弹二次确认。
 * 这是整个课程模块最高频的操作（每周一次 × 课程数），值得单独做一个入口。
 */
export interface HomeworkCatchUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gaps: Array<{ course: Course; weekNo: number }>;
  onAdd: (course: Course, weekNo: number, title: string) => void;
}

export function HomeworkCatchUpDialog({ open, onOpenChange, gaps, onAdd }: HomeworkCatchUpDialogProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  const submit = (course: Course, weekNo: number) => {
    const title = (drafts[course.id] ?? "").trim();
    if (!title) return;
    onAdd(course, weekNo, title);
    setDrafts((current) => ({ ...current, [course.id]: "" }));
    setSaved((current) => ({ ...current, [course.id]: true }));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="补记本周作业"
      description="只列出「每周有作业」但这一周还没记录的课。记完就会从提醒里消失。"
      size="md"
      footer={
        <Button size="sm" variant="primary" onClick={() => onOpenChange(false)}>
          完成
        </Button>
      }
    >
      {gaps.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-caption text-ink-500">
          这周的作业都记齐了。
        </p>
      ) : (
        <ul className="space-y-2.5">
          {gaps.map(({ course, weekNo }) => (
            <li key={course.id} className="rounded-md border border-border bg-surface-solid p-2.5">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: course.color }}
                />
                <p className="min-w-0 flex-1 truncate text-body text-ink-900">{course.name}</p>
                <span className="shrink-0 text-micro text-ink-500">第 {weekNo} 周</span>
                {saved[course.id] && (
                  <span className="flex items-center gap-1 text-micro text-success-ink">
                    <Check className="size-3" aria-hidden="true" />
                    已记
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <Input
                  value={drafts[course.id] ?? ""}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [course.id]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submit(course, weekNo);
                  }}
                  placeholder="这一周布置了什么作业？"
                  aria-label={`${course.name} 本周作业`}
                />
                <Button size="sm" variant="secondary" onClick={() => submit(course, weekNo)}>
                  记下
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

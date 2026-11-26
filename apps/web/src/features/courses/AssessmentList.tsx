import { CalendarPlus, Pencil, Trash2 } from "lucide-react";
import type { Assessment } from "@detter/shared";
import { dayKey } from "@detter/shared";
import { Badge, Button, cn } from "@detter/ui";
import {
  ASSESSMENT_KIND_COLOR,
  ASSESSMENT_KIND_LABEL,
  assessmentKindTone,
  assessmentStatusLabel,
} from "./coursesModel";

/**
 * 考核项列表（用列表而不是表格：375 宽下表格必然横向滚动）。
 *
 * 每行的信息优先级：名称 > 占分 > 类型/日期 > 状态。
 * 操作放右边三个图标：编辑、生成/更新日程、删除。
 */
export interface AssessmentListProps {
  assessments: Assessment[];
  onEdit: (assessment: Assessment) => void;
  onDelete: (assessment: Assessment) => void;
  onGenerateTask: (assessment: Assessment) => void;
  busyId?: string | null;
}

export function AssessmentList({
  assessments,
  onEdit,
  onDelete,
  onGenerateTask,
  busyId,
}: AssessmentListProps) {
  if (assessments.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-caption text-ink-500">
        还没有考核项。把老师说的「平时 30%、期末 70%」一条条记下来，权重条就会自动填满。
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {assessments.map((assessment) => (
        <li key={assessment.id} className="flex items-start gap-2 py-2.5">
          <span
            aria-hidden="true"
            className="mt-1.5 size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: ASSESSMENT_KIND_COLOR[assessment.kind] }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="min-w-0 truncate text-body text-ink-900">{assessment.title}</p>
              <Badge tone={assessmentKindTone(assessment.kind)}>
                {ASSESSMENT_KIND_LABEL[assessment.kind]}
              </Badge>
              <span className="ml-auto shrink-0 tabular text-body font-strong text-ink-900">
                {assessment.weight}%
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-micro text-ink-500">
              <span className="tabular">
                {assessment.dueAt === null
                  ? assessment.startAt === null
                    ? "没有日期"
                    : dayKey(assessment.startAt)
                  : dayKey(assessment.dueAt)}
              </span>
              <span className="text-ink-300">·</span>
              <span>{assessmentStatusLabel(assessment.status)}</span>
              {assessment.score !== null && (
                <>
                  <span className="text-ink-300">·</span>
                  <span className="tabular">{assessment.score} 分</span>
                </>
              )}
              {!assessment.taskId && (
                <>
                  <span className="text-ink-300">·</span>
                  <span className="text-warning-ink">没有关联日程</span>
                </>
              )}
            </div>
            {assessment.note && (
              <p className="mt-0.5 line-clamp-2 text-micro text-ink-300">{assessment.note}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              aria-label={`生成或更新「${assessment.title}」的日程`}
              loading={busyId === assessment.id}
              onClick={() => onGenerateTask(assessment)}
            >
              <CalendarPlus className="size-4" aria-hidden="true" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`编辑「${assessment.title}」`}
              onClick={() => onEdit(assessment)}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`删除「${assessment.title}」`}
              className={cn("text-ink-300 hover:text-danger-ink")}
              onClick={() => onDelete(assessment)}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

import { useEffect, useState } from "react";
import {
  ASSESSMENT_KINDS,
  ASSESSMENT_STATUSES,
  DAY,
  dayKey,
  dayKeyToTs,
  type Assessment,
  type AssessmentKind,
  type AssessmentStatus,
} from "@detter/shared";
import { Badge, Button, Dialog, Input, Textarea, cn } from "@detter/ui";
import type { AssessmentDraft } from "./courseActions";
import { ASSESSMENT_KIND_LABEL, ASSESSMENT_KIND_COLOR } from "./coursesModel";

/**
 * 新建 / 编辑考核项。
 *
 * 一条考核项就是「类型 + 名称 + 占分 + 日期」，其余字段（状态、得分、备注）都是可选的。
 * 顶部实时提示「还能分配多少分」，因为超额是最常见的录入错误。
 */

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-border-strong bg-surface-solid px-2 text-body text-ink-900 transition-[border-color,box-shadow] duration-[var(--dur-1)] hover:border-border-strong focus:border-accent focus:ring-4 focus:ring-accent/15";

const STATUS_LABEL: Record<AssessmentStatus, string> = {
  planned: "未开始",
  submitted: "已提交",
  done: "已完成",
  graded: "已出分",
};

export interface AssessmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Assessment | null;
  /** 当前课程权重里还剩多少可分配（用于提示，不做强校验） */
  remaining: number;
  onSubmit: (draft: AssessmentDraft) => void;
}

function emptyDraft(): AssessmentDraft {
  return {
    title: "",
    kind: "homework",
    weight: 10,
    dueAt: null,
    startAt: null,
    note: "",
    status: "planned",
    score: null,
  };
}

function draftOf(assessment: Assessment): AssessmentDraft {
  return {
    title: assessment.title,
    kind: assessment.kind,
    weight: assessment.weight,
    dueAt: assessment.dueAt,
    startAt: assessment.startAt,
    note: assessment.note,
    status: assessment.status,
    score: assessment.score,
  };
}

export function AssessmentDialog({
  open,
  onOpenChange,
  editing,
  remaining,
  onSubmit,
}: AssessmentDialogProps) {
  const [draft, setDraft] = useState<AssessmentDraft>(emptyDraft);
  const [dateText, setDateText] = useState("");
  const [scoreText, setScoreText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const initial = editing ? draftOf(editing) : emptyDraft();
    setDraft(initial);
    setDateText(initial.dueAt === null ? "" : dayKey(initial.dueAt));
    setScoreText(initial.score === null ? "" : String(initial.score));
    setError("");
  }, [open, editing]);

  const patch = (part: Partial<AssessmentDraft>) => setDraft((current) => ({ ...current, ...part }));

  const submit = () => {
    const title = draft.title.trim();
    if (!title) {
      setError("给考核项起个名字，比如「大作业」「期中考试」");
      return;
    }
    if (!Number.isFinite(draft.weight) || draft.weight < 0 || draft.weight > 100) {
      setError("权重是 0~100 的百分比");
      return;
    }
    const dueAt = dateText ? dayKeyToTs(dateText) + DAY - 1 : null;
    const score = scoreText.trim() === "" ? null : Number(scoreText);
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100)) {
      setError("得分是 0~100");
      return;
    }
    onSubmit({ ...draft, title, dueAt, score });
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "编辑考核项" : "新增考核项"}
      description={`当前还能分配 ${remaining}%；不要求一次填满，剩余部分会计入「未记录」。`}
      size="md"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" variant="primary" onClick={submit}>
            {editing ? "保存" : "添加"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <span className="text-caption text-ink-700">类型</span>
          <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="考核类型">
            {ASSESSMENT_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={draft.kind === kind}
                onClick={() => patch({ kind })}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-full border px-3 text-micro transition-colors duration-[var(--dur-1)]",
                  draft.kind === kind
                    ? "border-accent/40 bg-accent-soft text-accent"
                    : "border-border bg-surface-solid text-ink-500 hover:text-ink-900",
                )}
              >
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: ASSESSMENT_KIND_COLOR[kind] }}
                />
                {ASSESSMENT_KIND_LABEL[kind]}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="text-caption text-ink-700">名称</span>
          <Input
            autoFocus
            value={draft.title}
            onChange={(event) => patch({ title: event.target.value })}
            placeholder="大作业 / 期中考试 / 第 3 章作业"
            className="mt-1"
            aria-label="考核项名称"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-caption text-ink-700">占总评（%）</span>
            <Input
              type="number"
              min={0}
              max={100}
              step={5}
              value={String(draft.weight)}
              onChange={(event) => patch({ weight: Number(event.target.value) })}
              className="tabular mt-1"
              aria-label="权重百分比"
            />
          </label>
          <label className="block">
            <span className="text-caption text-ink-700">截止日期</span>
            <Input
              type="date"
              value={dateText}
              onChange={(event) => setDateText(event.target.value)}
              className="tabular mt-1"
              aria-label="截止日期"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-caption text-ink-700">状态</span>
            <select
              className={cn(SELECT_CLASS, "mt-1")}
              value={draft.status}
              onChange={(event) => patch({ status: event.target.value as AssessmentStatus })}
              aria-label="状态"
            >
              {ASSESSMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABEL[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-caption text-ink-700">得分（可选）</span>
            <Input
              type="number"
              min={0}
              max={100}
              value={scoreText}
              onChange={(event) => setScoreText(event.target.value)}
              className="tabular mt-1"
              aria-label="得分"
              placeholder="出分后再填"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-caption text-ink-700">备注</span>
          <Textarea
            value={draft.note}
            onChange={(event) => patch({ note: event.target.value })}
            placeholder="老师的原话、提交方式、PPT 第几页…"
            className="mt-1"
            rows={2}
            aria-label="备注"
          />
        </label>

        <p className="flex items-center gap-1.5 text-micro text-ink-300">
          <Badge tone="info">自动</Badge>
          添加后会生成一条带截止时间的日程，进入日历、四象限与提醒。
        </p>

        {error && <p className="text-caption text-danger-ink">{error}</p>}
      </div>
    </Dialog>
  );
}

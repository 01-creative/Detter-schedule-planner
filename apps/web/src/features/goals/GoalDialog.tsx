import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { GoalKind, KeyResult, Okr } from "@detter/shared";
import { Button, Dialog, Input, Textarea, cn, useToast } from "@detter/ui";
import { db } from "@/db";
import { useBoardGoals } from "@/features/quadrant/queries";
import { createGoal } from "./goal-actions";
import { useGoalDialogStore } from "./goal-dialog";
import { GOAL_COLORS, GOAL_ICONS, RRULE_PRESETS } from "./goal-visuals";
import { nextGoalSortIndex } from "./rules";

/**
 * 新建目标对话框。
 *
 * 字段很多，但每一项都有默认值：颜色和图标预选好了，模式默认「一次性」，
 * 用户只需要写一个标题就能创建 —— 其余字段是「想细调时再调」。
 * 模板的「里程碑」直接当作铺开时的任务清单，所以输入框的文案也写成任务口吻。
 */
const FIELD =
  "h-9 w-full rounded-md border border-border-strong bg-surface-solid px-2.5 text-body text-ink-900 placeholder:text-ink-300 focus:border-accent focus-visible:outline-2 focus-visible:outline-accent/40";

const KIND_OPTIONS: Array<{ value: GoalKind; label: string; hint: string }> = [
  { value: "once", label: "一次性", hint: "有截止日的结果" },
  { value: "recurring", label: "周期", hint: "每周重复的习惯" },
  { value: "template", label: "模板", hint: "可复用的清单" },
];

function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function GoalDialog() {
  const open = useGoalDialogStore((state) => state.open);
  const presetTitle = useGoalDialogStore((state) => state.presetTitle);
  const onCreated = useGoalDialogStore((state) => state.onCreated);
  const closeDialog = useGoalDialogStore((state) => state.closeDialog);
  const goals = useBoardGoals();
  const { toast } = useToast();

  const okrs = useLiveQuery(async () => {
    const rows = await db.okrs.toArray();
    return rows.filter((row) => !row.deletedAt) as Okr[];
  }, []);
  const keyResults = useLiveQuery(async () => {
    const rows = await db.keyResults.toArray();
    return rows.filter((row) => !row.deletedAt) as KeyResult[];
  }, []);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<GoalKind>("once");
  const [color, setColor] = useState<string>(GOAL_COLORS[0] ?? "#6355F6");
  const [icon, setIcon] = useState("target");
  const [rrule, setRrule] = useState("FREQ=WEEKLY;BYDAY=MO");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [milestones, setMilestones] = useState("");
  const [okrId, setOkrId] = useState("");
  const [krId, setKrId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(presetTitle);
    setDescription("");
    setKind("once");
    setColor(GOAL_COLORS[0] ?? "#6355F6");
    setIcon("target");
    setRrule("FREQ=WEEKLY;BYDAY=MO");
    setStartDate("");
    setEndDate("");
    setMilestones("");
    setOkrId("");
    setKrId("");
    setSaving(false);
  }, [open, presetTitle]);

  const presetMatch = RRULE_PRESETS.some((preset) => preset.value === rrule);
  const selectValue = presetMatch ? rrule : "custom";
  const relatedKrs = (keyResults ?? []).filter((kr) => !okrId || kr.okrId === okrId);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const goal = await createGoal({
        title: trimmed,
        description: description.trim(),
        kind,
        color,
        icon,
        rrule: kind === "recurring" ? rrule.trim() || null : null,
        startDate: kind === "recurring" ? startDate || null : null,
        endDate: kind === "once" ? endDate || null : null,
        milestoneTitles: parseLines(milestones),
        okrId: okrId || null,
        krId: krId || null,
        sortIndex: nextGoalSortIndex(goals),
      });
      toast({ title: "目标已创建", description: goal.title, tone: "success" });
      onCreated?.(goal);
      closeDialog();
    } catch (error) {
      toast({
        title: "创建失败",
        description: error instanceof Error ? error.message : "请稍后再试",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDialog();
      }}
      title="新建目标"
      description="先写清楚要达成什么，再决定它是习惯、期限，还是一套可复用的流程。"
      size="md"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={closeDialog}>
            取消
          </Button>
          <Button size="sm" loading={saving} disabled={!title.trim()} onClick={() => void submit()}>
            创建目标
          </Button>
        </>
      }
    >
      <div className="max-h-[62dvh] space-y-4 overflow-y-auto pr-1">
        <div>
          <label htmlFor="goal-title" className="mb-1 block text-micro text-ink-500">
            标题
          </label>
          <Input
            id="goal-title"
            value={title}
            autoFocus
            maxLength={200}
            placeholder="例如：9 月前拿到驾照"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </div>

        <div>
          <p className="mb-1 text-micro text-ink-500">类型</p>
          <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="目标类型">
            {KIND_OPTIONS.map((option) => {
              const active = kind === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setKind(option.value)}
                  className={cn(
                    "rounded-md border px-2 py-1.5 text-left transition-colors duration-[var(--dur-1)]",
                    active
                      ? "border-accent/40 bg-accent-soft"
                      : "border-border bg-surface-solid hover:border-border-strong",
                  )}
                >
                  <span
                    className={cn(
                      "block text-caption font-strong",
                      active ? "text-accent" : "text-ink-700",
                    )}
                  >
                    {option.label}
                  </span>
                  <span className="mt-0.5 block truncate text-micro text-ink-300">
                    {option.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {kind === "once" && (
          <div>
            <label htmlFor="goal-end" className="mb-1 block text-micro text-ink-500">
              截止日
            </label>
            <input
              id="goal-end"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className={FIELD}
            />
          </div>
        )}

        {kind === "recurring" && (
          <div className="space-y-2">
            <div>
              <label htmlFor="goal-rrule" className="mb-1 block text-micro text-ink-500">
                重复规则
              </label>
              <select
                id="goal-rrule"
                value={selectValue}
                onChange={(event) => {
                  if (event.target.value !== "custom") setRrule(event.target.value);
                }}
                className={FIELD}
              >
                {RRULE_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
                <option value="custom">自定义…</option>
              </select>
            </div>
            {selectValue === "custom" && (
              <input
                value={rrule}
                aria-label="自定义 RRULE"
                placeholder="FREQ=WEEKLY;BYDAY=MO"
                onChange={(event) => setRrule(event.target.value)}
                className={cn(FIELD, "font-mono text-caption")}
              />
            )}
            <div>
              <label htmlFor="goal-start" className="mb-1 block text-micro text-ink-500">
                开始日（可选）
              </label>
              <input
                id="goal-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className={FIELD}
              />
            </div>
          </div>
        )}

        <div>
          <label htmlFor="goal-milestones" className="mb-1 block text-micro text-ink-500">
            {kind === "template" ? "步骤（每行一条，铺开时生成任务）" : "里程碑（每行一条，可选）"}
          </label>
          <Textarea
            id="goal-milestones"
            rows={3}
            value={milestones}
            placeholder={"搜集资料\n写完初稿\n复盘一次"}
            onChange={(event) => setMilestones(event.target.value)}
            className="text-caption"
          />
        </div>

        <div>
          <label htmlFor="goal-desc" className="mb-1 block text-micro text-ink-500">
            描述（可选）
          </label>
          <Textarea
            id="goal-desc"
            rows={2}
            value={description}
            placeholder="为什么这件事重要？"
            onChange={(event) => setDescription(event.target.value)}
            className="text-caption"
          />
        </div>

        <div>
          <p className="mb-1 text-micro text-ink-500">颜色</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="目标颜色">
            {GOAL_COLORS.map((value) => (
              <button
                key={value}
                type="button"
                aria-label={`颜色 ${value}`}
                aria-pressed={color === value}
                onClick={() => setColor(value)}
                className={cn(
                  "size-6 rounded-full transition-transform duration-[var(--dur-1)] hover:scale-110",
                  color === value && "ring-2 ring-ink-300 ring-offset-2 ring-offset-surface-solid",
                )}
                style={{ backgroundColor: value }}
              />
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 text-micro text-ink-500">图标</p>
          <div className="grid grid-cols-6 gap-1.5" role="group" aria-label="目标图标">
            {GOAL_ICONS.map(({ key, label, Icon }) => {
              const active = icon === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={`图标：${label}`}
                  aria-pressed={active}
                  onClick={() => setIcon(key)}
                  className={cn(
                    "inline-flex h-8 items-center justify-center rounded-md border transition-colors duration-[var(--dur-1)]",
                    active
                      ? "border-accent/40 bg-accent-soft text-accent"
                      : "border-border bg-surface-solid text-ink-500 hover:text-ink-900",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="goal-okr" className="mb-1 block text-micro text-ink-500">
              关联 OKR（可选）
            </label>
            <select
              id="goal-okr"
              value={okrId}
              onChange={(event) => {
                setOkrId(event.target.value);
                setKrId("");
              }}
              className={FIELD}
              disabled={!okrs || okrs.length === 0}
            >
              <option value="">不关联</option>
              {(okrs ?? []).map((okr) => (
                <option key={okr.id} value={okr.id}>
                  {okr.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="goal-kr" className="mb-1 block text-micro text-ink-500">
              关联 KR（可选）
            </label>
            <select
              id="goal-kr"
              value={krId}
              onChange={(event) => setKrId(event.target.value)}
              className={FIELD}
              disabled={relatedKrs.length === 0}
            >
              <option value="">不关联</option>
              {relatedKrs.map((kr) => (
                <option key={kr.id} value={kr.id}>
                  {kr.title}
                </option>
              ))}
            </select>
          </div>
        </div>
        {(!okrs || okrs.length === 0) && (
          <p className="text-micro text-ink-300">还没有 OKR，先去「OKR」页建一个再回来关联。</p>
        )}
      </div>
    </Dialog>
  );
}

export default GoalDialog;

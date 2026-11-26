import { useEffect, useId, useRef, useState } from "react";
import { CalendarClock, MapPin, Repeat, Trash2 } from "lucide-react";
import { Button, Input, Sheet, Switch, Textarea, cn } from "@detter/ui";
import { combineDateAndTime } from "./calendarMutations";
import { durationLabel, monthDayLabel } from "./calendarMath";
import { describeRRule, normalizeRRule } from "./recurrence";
import type { CalendarItem, EventDraft, EventSeed, RecurrenceScope } from "./calendarTypes";

/**
 * 日程详情 / 编辑面板。
 *
 * 按任务书的约定自己写一份轻量的 Sheet（不依赖 T03 的编辑器），
 * 可编辑字段：标题、时间（日期 + 起止时刻 + 全天）、地点、备注、重复、完成。
 * 重复实例额外提供三个作用域（任务书 §5）：
 *
 *   只改这一次 → 写一条 recurrenceId/occurrenceKey 的覆盖记录
 *   改此后所有 → 父系列用 UNTIL 截断 + 从这一次起新开系列
 *   改整个系列 → 直接改父任务
 *
 * 时间输入刻意用原生 date/time 控件：桌面有日历弹层、移动端有系统滚轮，
 * 自己画一套只会更差。
 */

const TIME_INPUT_CLASS =
  "h-9 w-full rounded-md border border-border-strong bg-surface-solid px-2 text-body text-ink-900 tabular";

type RepeatFreq = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";

const REPEAT_OPTIONS: Array<{ value: RepeatFreq; label: string }> = [
  { value: "NONE", label: "不重复" },
  { value: "DAILY", label: "每天" },
  { value: "WEEKLY", label: "每周" },
  { value: "MONTHLY", label: "每月" },
];

function freqOf(rrule: string | null): RepeatFreq {
  if (!rrule) return "NONE";
  const body = normalizeRRule(rrule).toUpperCase();
  if (body.includes("FREQ=DAILY")) return "DAILY";
  if (body.includes("FREQ=WEEKLY")) return "WEEKLY";
  if (body.includes("FREQ=MONTHLY")) return "MONTHLY";
  return "NONE";
}

function dateKeyOf(ts: number): string {
  const date = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timeValueOf(ts: number): string {
  const date = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface EventDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  /** 编辑时的目标条目（虚拟实例也能编辑） */
  item: CalendarItem | null;
  /** 新建时的预填时段 */
  seed: EventSeed | null;
  /** 换一条条目就重置表单（由父级传入，避免 live query 重跑时把正在编辑的内容冲掉） */
  sessionKey: string;
  saving?: boolean;
  onSave: (draft: EventDraft, scope: RecurrenceScope) => void;
  onDelete: (scope: RecurrenceScope) => void;
}

export function EventDetailSheet({
  open,
  onOpenChange,
  mode,
  item,
  seed,
  sessionKey,
  saving = false,
  onSave,
  onDelete,
}: EventDetailSheetProps) {
  const fieldId = useId();
  const latest = useRef({ item, seed });
  latest.current = { item, seed };

  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("10:00");
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState(false);
  const [repeat, setRepeat] = useState<RepeatFreq>("NONE");
  const [scope, setScope] = useState<RecurrenceScope>("this");
  const [error, setError] = useState<string | null>(null);

  /* 打开或切换目标时重置表单 */
  useEffect(() => {
    if (!open) return;
    const { item: source, seed: seedValue } = latest.current;
    const startAt = source?.startAt ?? seedValue?.startAt ?? Date.now();
    const endAt = source?.endAt ?? seedValue?.endAt ?? startAt + 60 * 60_000;

    setTitle(source?.title ?? seedValue?.title ?? "");
    setStartDate(dateKeyOf(startAt));
    setStartTime(timeValueOf(startAt));
    setEndDate(dateKeyOf(endAt));
    setEndTime(timeValueOf(endAt));
    setAllDay(source?.allDay ?? seedValue?.allDay ?? false);
    setLocation(source?.location ?? "");
    setNotes(source?.notes ?? "");
    setDone(source?.status === "done");
    setRepeat(freqOf(source?.rrule ?? null));
    setScope("this");
    setError(null);
  }, [open, sessionKey]);

  const startAt = startDate && startTime ? combineDateAndTime(startDate, startTime) : null;
  const endAt = endDate && endTime ? combineDateAndTime(endDate, endTime) : null;
  const invalidRange = startAt !== null && endAt !== null && endAt <= startAt;
  const durationMinutes =
    startAt !== null && endAt !== null && endAt > startAt ? (endAt - startAt) / 60_000 : 0;

  const originalRRule = item?.rrule ?? null;

  const handleSave = () => {
    if (!title.trim()) {
      setError("先给这条日程起个名字。");
      return;
    }
    if (startAt === null || endAt === null) {
      setError("开始和结束时间都要填。");
      return;
    }
    if (invalidRange) {
      setError("结束时间要晚于开始时间。");
      return;
    }
    setError(null);

    const draft: EventDraft = {
      title: title.trim(),
      startAt: allDay ? combineDateAndTime(startDate, "00:00") : startAt,
      endAt: allDay ? combineDateAndTime(endDate, "23:59") : endAt,
      allDay,
      location: location.trim(),
      notes,
      done,
      // 没有改动重复规则时保留原始串（例如 FREQ=WEEKLY;BYDAY=MO 的 BYDAY）
      rrule:
        repeat === freqOf(originalRRule)
          ? originalRRule
          : repeat === "NONE"
            ? null
            : `FREQ=${repeat}`,
    };
    onSave(draft, scope);
  };

  const isRecurring = Boolean(item?.recurring);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      // 桌面端别铺满整屏：收成一个居中偏上的宽面板，移动端仍是底部抽屉
      className="md:mx-auto md:mb-8 md:max-w-[560px] md:rounded-2xl"
      title={mode === "create" ? "新建日程" : item?.title || "日程详情"}
      description={
        isRecurring
          ? `重复系列 · ${describeRRule(originalRRule)}${
              item?.occurrenceKey && item.parentId
                ? ` · 这一次原定 ${monthDayLabel(Number(item.occurrenceKey))}`
                : ""
            }`
          : mode === "create"
            ? "填个名字和时段，剩下的可以之后补"
            : undefined
      }
      footer={
        <div className="flex items-center gap-2">
          {mode === "edit" && (
            <Button
              variant="danger"
              size="md"
              onClick={() => onDelete(scope)}
              leftIcon={<Trash2 className="size-4" aria-hidden="true" />}
            >
              删除
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button variant="primary" size="md" loading={saving} onClick={handleSave}>
              保存
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-title`} className="block text-caption text-ink-700">
            标题
          </label>
          <Input
            id={`${fieldId}-title`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：高数课 / 写周报"
            autoComplete="off"
            invalid={Boolean(error) && !title.trim()}
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-caption text-ink-700">全天</span>
          <Switch checked={allDay} onCheckedChange={setAllDay} label="全天" />
        </div>

        <div className="space-y-2 rounded-lg border border-border bg-surface-sunken/40 p-2.5">
          <div className="flex items-center gap-1.5 text-micro text-ink-500">
            <CalendarClock className="size-3" aria-hidden="true" />
            时间
            {durationMinutes > 0 && (
              <span className="tabular ml-auto text-ink-300">{durationLabel(durationMinutes)}</span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="block text-micro text-ink-300">开始日期</span>
              <Input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                aria-label="开始日期"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-micro text-ink-300">{allDay ? "结束日期" : "开始时刻"}</span>
              {allDay ? (
                <Input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  aria-label="结束日期"
                />
              ) : (
                <input
                  type="time"
                  value={startTime}
                  onChange={(event) => {
                    setStartTime(event.target.value);
                    // 结束日期跟着开始走，避免「开始改了结束还停在昨天」
                    if (endDate < startDate) setEndDate(startDate);
                  }}
                  aria-label="开始时间"
                  className={TIME_INPUT_CLASS}
                />
              )}
            </label>
            {!allDay && (
              <>
                <label className="space-y-1">
                  <span className="block text-micro text-ink-300">结束日期</span>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                    aria-label="结束日期"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-micro text-ink-300">结束时刻</span>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(event) => setEndTime(event.target.value)}
                    aria-label="结束时间"
                    className={TIME_INPUT_CLASS}
                  />
                </label>
              </>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-location`} className="flex items-center gap-1 text-caption text-ink-700">
            <MapPin className="size-3" aria-hidden="true" />
            地点
          </label>
          <Input
            id={`${fieldId}-location`}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="教三 203 / 线上"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-notes`} className="block text-caption text-ink-700">
            备注
          </label>
          <Textarea
            id={`${fieldId}-notes`}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder="要带的东西、会议议程…"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-repeat`} className="flex items-center gap-1 text-caption text-ink-700">
            <Repeat className="size-3" aria-hidden="true" />
            重复
          </label>
          <select
            id={`${fieldId}-repeat`}
            value={repeat}
            onChange={(event) => setRepeat(event.target.value as RepeatFreq)}
            className={cn(TIME_INPUT_CLASS, "pr-6")}
          >
            {REPEAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border px-2.5 py-2">
          <span className="text-caption text-ink-700">已完成</span>
          <Switch checked={done} onCheckedChange={setDone} label="已完成" />
        </div>

        {isRecurring && (
          <fieldset className="space-y-1.5 rounded-lg border border-border bg-accent-soft/30 p-2.5">
            <legend className="px-1 text-micro text-ink-500">这次改动影响范围</legend>
            {(
              [
                { value: "this", label: "只改这一次" },
                { value: "following", label: "改此后所有" },
                { value: "all", label: "改整个系列" },
              ] as const
            ).map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-caption text-ink-700 hover:bg-surface-solid"
              >
                <input
                  type="radio"
                  name={`${fieldId}-scope`}
                  value={option.value}
                  checked={scope === option.value}
                  onChange={() => setScope(option.value)}
                  className="size-3.5 accent-[color:var(--accent)]"
                />
                {option.label}
              </label>
            ))}
            <p className="px-1 text-micro text-ink-300">
              「只改这一次」会写一条例外记录，其它几次不受影响；「完成某一次」也是同样的机制。
            </p>
          </fieldset>
        )}

        {error && (
          <p role="alert" className="text-caption text-danger-ink">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

export default EventDetailSheet;

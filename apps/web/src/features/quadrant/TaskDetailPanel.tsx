import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  CalendarClock,
  Check,
  Circle,
  ListChecks,
  Plus,
  Tag as TagIcon,
  Trash2,
  X,
} from "lucide-react";
import type { Goal, Quadrant, Task } from "@detter/shared";
import { QUADRANT_META, QUADRANT_ORDER, shortId } from "@detter/shared";
import { Badge, Button, Input, Sheet, Switch, Textarea, cn } from "@detter/ui";
import { formatDateLabel, formatRelative } from "@/lib/format";

/**
 * 任务详情面板。
 *
 * 单击卡片打开；桌面从右侧滑出，窄屏从底部升起（同一个 Sheet 组件，换 side）。
 * 所有字段都是「改了就算数」：文本 500ms 防抖落库，选择类立即落库；
 * 关闭面板前会 flush 一次，避免最后 0.4 秒的字丢掉。
 */
export interface TaskDetailPanelProps {
  task: Task | null;
  goals: Goal[];
  side: "bottom" | "right";
  onClose: () => void;
  onPatch: (task: Task, patch: Partial<Task>) => void;
  onToggleDone: (task: Task) => void;
  onMoveQuadrant: (task: Task, quadrant: Quadrant) => void;
  onRequestDelete: (task: Task) => void;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 时间戳 → datetime-local 的本地字符串 */
function toInputValue(ts: number | null): string {
  if (ts === null) return "";
  const date = new Date(ts);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** datetime-local 的字符串 → 本地时间戳；空串表示清空 */
function fromInputValue(value: string): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function parseTags(value: string): string[] {
  const seen = new Set<string>();
  for (const raw of value.split(/[\s,，、]+/)) {
    const tag = raw.replace(/^#/, "").trim();
    if (tag) seen.add(tag);
  }
  return [...seen];
}

const FIELD =
  "h-9 w-full rounded-md border border-border-strong bg-surface-solid px-2.5 text-body text-ink-900 placeholder:text-ink-300 focus:border-accent focus-visible:outline-2 focus-visible:outline-accent/40";

export function TaskDetailPanel({
  task,
  goals,
  side,
  onClose,
  onPatch,
  onToggleDone,
  onMoveQuadrant,
  onRequestDelete,
}: TaskDetailPanelProps) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [checkText, setCheckText] = useState("");
  const taskRef = useRef<Task | null>(task);
  taskRef.current = task;

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setNotes(task.notes);
    setTagsText(task.tags.join(" "));
    setCheckText("");
    // 只在切换任务时重置草稿；任务本身被保存后不要覆盖用户正在输的内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  const patch = useCallback(
    (next: Partial<Task>) => {
      const current = taskRef.current;
      if (current) onPatch(current, next);
    },
    [onPatch],
  );

  /* 标题 / 备注：500ms 防抖，输入过程中不写库 */
  useEffect(() => {
    if (!task) return;
    const next = title.trim();
    if (!next || next === task.title) return;
    const timer = window.setTimeout(() => patch({ title: next }), 500);
    return () => window.clearTimeout(timer);
  }, [title, task, patch]);

  useEffect(() => {
    if (!task || notes === task.notes) return;
    const timer = window.setTimeout(() => patch({ notes }), 600);
    return () => window.clearTimeout(timer);
  }, [notes, task, patch]);

  const flush = useCallback(() => {
    const current = taskRef.current;
    if (!current) return;
    const next: Partial<Task> = {};
    const nextTitle = title.trim();
    if (nextTitle && nextTitle !== current.title) next.title = nextTitle;
    if (notes !== current.notes) next.notes = notes;
    const nextTags = parseTags(tagsText);
    if (nextTags.join("|") !== current.tags.join("|")) next.tags = nextTags;
    if (Object.keys(next).length > 0) onPatch(current, next);
  }, [title, notes, tagsText, onPatch]);

  const handleOpenChange = (open: boolean) => {
    if (open) return;
    flush();
    onClose();
  };

  if (!task) return null;
  const done = task.status === "done";
  const activeGoals = goals.filter((goal) => goal.status === "active");

  return (
    <Sheet
      open
      onOpenChange={handleOpenChange}
      side={side}
      title="任务详情"
      description="双击卡片切换完成；拖动卡片换象限与坐标。"
      footer={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={done ? "secondary" : "primary"}
            onClick={() => onToggleDone(task)}
            leftIcon={<Check className="size-3.5" aria-hidden="true" />}
          >
            {done ? "取消完成" : "标记完成"}
          </Button>
          <Button
            size="sm"
            variant="danger"
            className="ml-auto"
            onClick={() => onRequestDelete(task)}
            leftIcon={<Trash2 className="size-3.5" aria-hidden="true" />}
          >
            删除
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div>
          <Input
            value={title}
            aria-label="任务标题"
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => {
              const next = title.trim();
              if (next && next !== task.title) patch({ title: next });
            }}
            className="h-10 text-[15px] font-strong"
            maxLength={500}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-ink-300">
            <Badge tone={done ? "success" : "neutral"}>{done ? "已完成" : "进行中"}</Badge>
            <span>创建于 {formatRelative(task.createdAt)}</span>
            {task.completedAt !== null && <span>完成于 {formatDateLabel(task.completedAt)}</span>}
          </div>
        </div>

        <section aria-label="时间">
          <SectionTitle icon={<CalendarClock className="size-3.5" aria-hidden="true" />}>
            时间
          </SectionTitle>
          <div className="mt-2 flex items-center justify-between rounded-md bg-surface-sunken/60 px-2.5 py-1.5">
            <span className="text-caption text-ink-700">全天</span>
            <Switch
              checked={task.allDay}
              onCheckedChange={(checked) => patch({ allDay: checked })}
              label="全天任务"
            />
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2">
            <Field label="开始">
              <input
                type="datetime-local"
                value={toInputValue(task.startAt)}
                aria-label="开始时间"
                onChange={(event) => patch({ startAt: fromInputValue(event.target.value) })}
                className={FIELD}
              />
            </Field>
            <Field label="结束">
              <input
                type="datetime-local"
                value={toInputValue(task.endAt)}
                aria-label="结束时间"
                onChange={(event) => patch({ endAt: fromInputValue(event.target.value) })}
                className={FIELD}
              />
            </Field>
            <Field label="截止">
              <input
                type="datetime-local"
                value={toInputValue(task.dueAt)}
                aria-label="截止时间"
                onChange={(event) => patch({ dueAt: fromInputValue(event.target.value) })}
                className={FIELD}
              />
            </Field>
          </div>
        </section>

        <section aria-label="备注">
          <SectionTitle>备注</SectionTitle>
          <Textarea
            value={notes}
            aria-label="任务备注"
            rows={3}
            placeholder="补充上下文、链接、下一步…"
            onChange={(event) => setNotes(event.target.value)}
            onBlur={() => {
              if (notes !== task.notes) patch({ notes });
            }}
            className="mt-2 text-body"
          />
        </section>

        <section aria-label="分类">
          <SectionTitle>象限</SectionTitle>
          <div className="mt-2 grid grid-cols-2 gap-1.5" role="group" aria-label="所在象限">
            {QUADRANT_ORDER.map((quadrant) => {
              const active = task.quadrant === quadrant;
              return (
                <button
                  key={quadrant}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    if (!active) onMoveQuadrant(task, quadrant);
                  }}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-md border px-2 text-caption transition-colors duration-[var(--dur-1)]",
                    active
                      ? "border-transparent bg-surface-solid text-ink-900 shadow-1"
                      : "border-border bg-surface-sunken/50 text-ink-500 hover:text-ink-700",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: `var(--q${quadrant}-accent)` }}
                  />
                  <span className="truncate">
                    Q{quadrant} {QUADRANT_META[quadrant].short}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-3">
            <Field label="目标">
              <select
                value={task.goalId ?? ""}
                aria-label="关联目标"
                onChange={(event) => patch({ goalId: event.target.value || null })}
                className={FIELD}
              >
                <option value="">不关联目标</option>
                {activeGoals.map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.title}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-3">
            <Field label="标签">
              <div className="relative">
                <TagIcon
                  className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-ink-300"
                  aria-hidden="true"
                />
                <input
                  value={tagsText}
                  aria-label="标签，空格分隔"
                  placeholder="学习 健康"
                  onChange={(event) => setTagsText(event.target.value)}
                  onBlur={() => {
                    const next = parseTags(tagsText);
                    if (next.join("|") !== task.tags.join("|")) patch({ tags: next });
                  }}
                  className={cn(FIELD, "pl-8")}
                />
              </div>
            </Field>
            {task.tags.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {task.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-surface-sunken px-1.5 text-micro text-ink-500"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>

        <section aria-label="清单">
          <SectionTitle icon={<ListChecks className="size-3.5" aria-hidden="true" />}>
            清单
          </SectionTitle>
          <ul className="mt-2 space-y-1">
            {task.checklist.map((item) => (
              <li key={item.id} className="group flex items-center gap-2 rounded-md px-1 py-1">
                <button
                  type="button"
                  aria-label={item.done ? `取消完成「${item.text}」` : `完成「${item.text}」`}
                  aria-pressed={item.done}
                  onClick={() =>
                    patch({
                      checklist: task.checklist.map((entry) =>
                        entry.id === item.id ? { ...entry, done: !entry.done } : entry,
                      ),
                    })
                  }
                  className={cn(
                    "inline-flex size-4 shrink-0 items-center justify-center rounded-full border",
                    item.done
                      ? "border-transparent bg-success text-on-accent"
                      : "border-border-strong text-transparent hover:border-accent",
                  )}
                >
                  <Check className="size-2.5" strokeWidth={3} aria-hidden="true" />
                </button>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-caption",
                    item.done ? "text-ink-300 line-through" : "text-ink-700",
                  )}
                >
                  {item.text}
                </span>
                <button
                  type="button"
                  aria-label={`删除清单项「${item.text}」`}
                  onClick={() =>
                    patch({ checklist: task.checklist.filter((entry) => entry.id !== item.id) })
                  }
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded text-ink-300 opacity-0 hover:bg-surface-sunken hover:text-ink-700 group-hover:opacity-100"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-1.5 flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              const text = checkText.trim();
              if (!text) return;
              patch({
                checklist: [...task.checklist, { id: shortId(8), text, done: false }],
              });
              setCheckText("");
            }}
          >
            <Plus className="size-3.5 shrink-0 text-ink-300" aria-hidden="true" />
            <input
              value={checkText}
              aria-label="新增清单项"
              placeholder="加一步"
              onChange={(event) => setCheckText(event.target.value)}
              className="h-7 min-w-0 flex-1 bg-transparent text-caption text-ink-900 outline-none placeholder:text-ink-300"
            />
            {checkText.trim() && (
              <Button size="sm" variant="ghost" type="submit">
                添加
              </Button>
            )}
          </form>
          {task.checklist.length === 0 && (
            <p className="mt-1 text-micro text-ink-300">把任务拆成几小步，开始就没那么难。</p>
          )}
        </section>
      </div>
    </Sheet>
  );
}

function SectionTitle({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 text-micro font-strong tracking-normal text-ink-500 uppercase">
      {icon ?? <Circle className="size-2 fill-current text-ink-300" aria-hidden="true" />}
      {children}
    </h3>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-micro text-ink-500">{label}</span>
      {children}
    </label>
  );
}

export default TaskDetailPanel;

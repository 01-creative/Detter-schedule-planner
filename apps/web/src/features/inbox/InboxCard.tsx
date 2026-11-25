import { useState } from "react";
import type { ReactNode } from "react";
import { Archive, CalendarDays, Ellipsis, MapPin, Pencil, Target, Trash, Undo2 } from "lucide-react";
import type { InboxItem, Task } from "@detter/shared";
import { Badge, Button, Chip, Popover, cn } from "@detter/ui";
import { formatRelative, formatWhen } from "@/lib/format";
import { draftOf } from "./actions";

/**
 * 收件箱里的一条。
 *
 * 显示的是**原始文本**（最多两行）而不是解析后的标题：用户在收件箱里
 * 认出自己写的那句话，比认出一句被解析器改写过的标题更快。
 * 解析结果放在 chips 里，随时能看、能改。
 */

export interface InboxCardProps {
  item: InboxItem;
  duplicate: Task | null;
  conflict: Task | null;
  selectMode: boolean;
  selected: boolean;
  /** 正在处理（批量整理时禁用交互） */
  busy: boolean;
  onToggleSelect: () => void;
  onOpenTriage: () => void;
  onQuickTriage: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onSaveText: (text: string) => Promise<void>;
}

export function InboxCard({
  item,
  duplicate,
  conflict,
  selectMode,
  selected,
  busy,
  onToggleSelect,
  onOpenTriage,
  onQuickTriage,
  onArchive,
  onDelete,
  onRestore,
  onSaveText,
}: InboxCardProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.rawText);
  const [saving, setSaving] = useState(false);

  const draft = draftOf(item);
  const handled = item.status !== "pending";

  const startEdit = () => {
    setText(item.rawText);
    setEditing(true);
  };

  const commitEdit = async () => {
    const next = text.trim();
    if (!next || saving) return;
    if (next === item.rawText) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSaveText(next);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <li
      className={cn(
        "[content-visibility:auto] [contain-intrinsic-size:auto_120px]",
        handled && "opacity-80",
      )}
    >
      <article
        className={cn(
          "rounded-lg border bg-surface-solid p-3.5 shadow-1 transition-[border-color,box-shadow] duration-[var(--dur-2)]",
          "hover:border-border-strong hover:shadow-2",
          selected ? "border-accent/40 ring-2 ring-accent/15" : "border-border",
        )}
      >
        <div className="flex items-start gap-3">
          {selectMode && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              aria-label={`选择：${item.rawText.slice(0, 20)}`}
              className="mt-1 size-4 shrink-0 accent-accent"
            />
          )}

          <div className="min-w-0 flex-1">
            {editing ? (
              <div>
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  aria-label="编辑原文"
                  rows={2}
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setEditing(false);
                    }
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void commitEdit();
                    }
                  }}
                  className="w-full resize-none rounded-md border border-border bg-surface-solid px-2.5 py-2 text-body text-ink-900 focus:outline-none focus-visible:outline-2 focus-visible:outline-accent/40"
                />
                <div className="mt-1.5 flex items-center gap-2">
                  <Button size="sm" loading={saving} onClick={() => void commitEdit()}>
                    保存原文
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    取消
                  </Button>
                  <span className="text-micro text-ink-300">保存后会重新解析</span>
                </div>
              </div>
            ) : (
              <p className="text-body leading-[22px] font-strong line-clamp-2 break-words text-ink-900">
                {item.rawText}
              </p>
            )}

            {!editing && draft.title && draft.title !== item.rawText && (
              <p className="mt-0.5 truncate text-micro text-ink-300">整理为：{draft.title}</p>
            )}

            {!editing && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {draft.startAt && (
                  <Chip icon={<CalendarDays className="size-3" aria-hidden="true" />}>
                    {formatWhen({
                      startAt: draft.startAt,
                      endAt: draft.endAt,
                      allDay: draft.allDay,
                    })}
                  </Chip>
                )}
                {draft.location && (
                  <Chip icon={<MapPin className="size-3" aria-hidden="true" />}>
                    在{draft.location}
                  </Chip>
                )}
                {draft.tags.map((tag) => (
                  <Chip key={tag} tone="accent">
                    #{tag}
                  </Chip>
                ))}
                {draft.goalTitle && (
                  <Chip icon={<Target className="size-3" aria-hidden="true" />}>
                    @{draft.goalTitle}
                  </Chip>
                )}
                {draft.quadrantGuess && <Chip tone="muted">建议 Q{draft.quadrantGuess}</Chip>}
                {duplicate && (
                  <Chip tone="muted" title={`与「${duplicate.title}」很像`}>
                    可能重复
                  </Chip>
                )}
                {conflict && (
                  <Chip tone="muted" title={`与「${conflict.title}」的时间重叠`}>
                    与「{conflict.title}」冲突
                  </Chip>
                )}

                {!handled && !selectMode && (
                  <div className="ml-auto flex items-center gap-1.5">
                    <Button size="sm" variant="secondary" disabled={busy} onClick={onOpenTriage}>
                      转任务
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={onQuickTriage}>
                      一键整理
                    </Button>
                    <Popover
                      align="end"
                      side="bottom"
                      label="更多操作"
                      trigger={
                        <button
                          type="button"
                          aria-label="更多操作"
                          className="relative inline-flex size-7 items-center justify-center rounded-md text-ink-500 transition-colors duration-[var(--dur-1)] after:absolute after:-inset-1 after:content-[''] hover:bg-surface-sunken hover:text-ink-900"
                        >
                          <Ellipsis className="size-4" aria-hidden="true" />
                        </button>
                      }
                    >
                      {(close) => (
                        <div className="flex flex-col py-0.5">
                          <MenuItem
                            icon={<Pencil className="size-3.5" aria-hidden="true" />}
                            label="编辑原文"
                            onClick={() => {
                              close();
                              startEdit();
                            }}
                          />
                          <MenuItem
                            icon={<Archive className="size-3.5" aria-hidden="true" />}
                            label="归档"
                            onClick={() => {
                              close();
                              onArchive();
                            }}
                          />
                          <MenuItem
                            icon={<Trash className="size-3.5" aria-hidden="true" />}
                            label="删除"
                            tone="danger"
                            onClick={() => {
                              close();
                              onDelete();
                            }}
                          />
                        </div>
                      )}
                    </Popover>
                  </div>
                )}

                {handled && (
                  <div className="ml-auto flex items-center gap-1.5">
                    <Badge tone={item.status === "triaged" ? "success" : "neutral"}>
                      {item.status === "triaged" ? "已分诊" : "已归档"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      leftIcon={<Undo2 className="size-3" aria-hidden="true" />}
                      onClick={onRestore}
                    >
                      恢复
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={onDelete}>
                      删除
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          <span className="hidden shrink-0 text-micro text-ink-300 sm:block">
            {formatRelative(item.capturedAt)}
          </span>
        </div>
      </article>
    </li>
  );
}

function MenuItem({
  icon,
  label,
  tone = "default",
  onClick,
}: {
  icon: ReactNode;
  label: string;
  tone?: "default" | "danger";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-2 rounded-md px-2 text-left text-caption transition-colors duration-[var(--dur-1)]",
        tone === "danger"
          ? "text-danger-ink hover:bg-danger-soft"
          : "text-ink-700 hover:bg-surface-sunken hover:text-ink-900",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

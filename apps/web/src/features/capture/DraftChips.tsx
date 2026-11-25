import { useState } from "react";
import type { ReactNode } from "react";
import {
  CalendarDays,
  MapPin,
  Repeat,
  Target,
  Timer,
  X,
} from "lucide-react";
import type { Goal, ParsedDraft, Quadrant } from "@detter/shared";
import { Chip, cn } from "@detter/ui";
import { formatDurationMinutes, formatWhen } from "@/lib/format";
import { normalizeTags, type CaptureTweaks, type TweakTarget } from "./overrides";

/**
 * 解析预览 chips + 点击微调。
 *
 * 设计目标：解析器永远只是「建议」，每个建议都得能用一次点击改掉。
 * chips 放在固定高度的预览区里（高度由 CaptureComposer 预留），
 * 所以文字从「无」到「有解析结果」时面板不会长高。
 */

export interface DraftChipsProps {
  draft: ParsedDraft;
  tweaks: CaptureTweaks;
  onTweaksChange: (next: CaptureTweaks) => void;
  goals: Goal[];
  variant: "desktop" | "mobile";
  /** 当前展开的微调项由父组件持有：↑/↓ 与 Tab 要在输入框里就能操作 */
  active: TweakTarget | null;
  onActiveChange: (target: TweakTarget | null) => void;
}

const QUADRANTS: Quadrant[] = [1, 2, 3, 4];
const DURATIONS = [15, 25, 40, 60, 90];

function toLocalInput(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function ChipButton({
  icon,
  label,
  active,
  onClick,
  ariaLabel,
  tone = "neutral",
}: {
  icon?: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  ariaLabel: string;
  tone?: "neutral" | "accent" | "muted";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={cn(
        "rounded-full transition-transform duration-[var(--dur-1)] ease-out active:scale-[.97]",
        active && "ring-2 ring-accent/30",
      )}
    >
      <Chip tone={active ? "accent" : tone} icon={icon}>
        {label}
      </Chip>
    </button>
  );
}

export function DraftChips({
  draft,
  tweaks,
  onTweaksChange,
  goals,
  variant,
  active,
  onActiveChange,
}: DraftChipsProps) {
  const [tagInput, setTagInput] = useState("");

  const startAt = tweaks.startAt !== undefined ? tweaks.startAt : draft.startAt;
  const allDay = tweaks.allDay ?? draft.allDay;
  const durationMin = tweaks.durationMin !== undefined ? tweaks.durationMin : draft.durationMin;
  const location = tweaks.location ?? draft.location;
  const tags = tweaks.tags ?? draft.tags;
  const goalTitle = tweaks.goalTitle !== undefined ? tweaks.goalTitle : draft.goalTitle;
  const quadrant = tweaks.quadrant !== undefined ? tweaks.quadrant : draft.quadrantGuess;
  const rrule = tweaks.rrule !== undefined ? tweaks.rrule : draft.rrule;

  const toggle = (target: TweakTarget) => onActiveChange(active === target ? null : target);

  const patch = (next: CaptureTweaks) => onTweaksChange({ ...tweaks, ...next });

  const chips: Array<{ key: string; target: TweakTarget; node: ReactNode }> = [];
  if (startAt) {
    chips.push({
      key: "time",
      target: "time",
      node: (
        <ChipButton
          key="time"
          icon={<CalendarDays className="size-3" aria-hidden="true" />}
          label={formatWhen({ startAt, endAt: null, allDay })}
          active={active === "time"}
          ariaLabel="微调时间"
          onClick={() => toggle("time")}
        />
      ),
    });
  }
  if (durationMin) {
    chips.push({
      key: "duration",
      target: "duration",
      node: (
        <ChipButton
          key="duration"
          icon={<Timer className="size-3" aria-hidden="true" />}
          label={`${formatDurationMinutes(durationMin)}`}
          active={active === "duration"}
          ariaLabel="微调预计时长"
          onClick={() => toggle("duration")}
        />
      ),
    });
  }
  if (rrule) {
    chips.push({
      key: "recurrence",
      target: "recurrence",
      node: (
        <ChipButton
          key="recurrence"
          icon={<Repeat className="size-3" aria-hidden="true" />}
          label="重复"
          active={active === "recurrence"}
          ariaLabel="微调重复规则"
          onClick={() => toggle("recurrence")}
          tone="muted"
        />
      ),
    });
  }
  if (location) {
    chips.push({
      key: "location",
      target: "location",
      node: (
        <ChipButton
          key="location"
          icon={<MapPin className="size-3" aria-hidden="true" />}
          label={`在${location}`}
          active={active === "location"}
          ariaLabel="微调地点"
          onClick={() => toggle("location")}
        />
      ),
    });
  }
  for (const tag of tags) {
    chips.push({
      key: `tag-${tag}`,
      target: "tags",
      node: (
        <ChipButton
          key={`tag-${tag}`}
          label={`#${tag}`}
          active={false}
          ariaLabel={`微调标签 ${tag}`}
          onClick={() => toggle("tags")}
          tone="accent"
        />
      ),
    });
  }
  if (goalTitle) {
    chips.push({
      key: "goal",
      target: "goal",
      node: (
        <ChipButton
          key="goal"
          icon={<Target className="size-3" aria-hidden="true" />}
          label={`@${goalTitle}`}
          active={active === "goal"}
          ariaLabel="微调目标"
          onClick={() => toggle("goal")}
        />
      ),
    });
  }
  if (quadrant) {
    chips.push({
      key: "quadrant",
      target: "quadrant",
      node: (
        <ChipButton
          key="quadrant"
          label={`建议 Q${quadrant}`}
          active={active === "quadrant"}
          ariaLabel="微调象限"
          onClick={() => toggle("quadrant")}
          tone="muted"
        />
      ),
    });
  }

  const lowConfidence = draft.confidence < 0.5;

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.length > 0 ? (
          chips.map((chip) => chip.node)
        ) : (
          <span className="text-micro text-ink-300">
            还没识别到时间或标签 · 试试「明天下午3点 交作业 #学习 在图书馆」
          </span>
        )}
        {lowConfidence && (
          <span className="text-micro text-ink-300/90">· 已按原文记录，可稍后整理</span>
        )}
      </div>

      {active && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-sunken/50 px-2.5 py-2">
          {active === "time" && (
            <>
              <input
                type="datetime-local"
                aria-label="选择时间"
                value={startAt ? toLocalInput(startAt) : ""}
                onChange={(event) => patch({ startAt: fromLocalInput(event.target.value) })}
                className="h-8 rounded-md border border-border bg-surface-solid px-2 text-caption text-ink-900"
              />
              <label className="flex items-center gap-1.5 text-micro text-ink-700">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(event) => patch({ allDay: event.target.checked })}
                  className="size-3.5 accent-accent"
                />
                全天
              </label>
              <button
                type="button"
                onClick={() => patch({ startAt: null, allDay: false })}
                className="text-micro text-ink-500 underline-offset-2 hover:text-ink-900 hover:underline"
              >
                清除时间
              </button>
            </>
          )}

          {active === "duration" && (
            <>
              {DURATIONS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => patch({ durationMin: minutes })}
                  aria-pressed={durationMin === minutes}
                  className={cn(
                    "h-7 rounded-full px-2.5 text-micro transition-colors duration-[var(--dur-1)]",
                    durationMin === minutes
                      ? "bg-accent-soft text-accent"
                      : "text-ink-500 hover:bg-surface-solid hover:text-ink-900",
                  )}
                >
                  {formatDurationMinutes(minutes)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => patch({ durationMin: null })}
                className="text-micro text-ink-500 underline-offset-2 hover:text-ink-900 hover:underline"
              >
                清除
              </button>
            </>
          )}

          {active === "location" && (
            <input
              type="text"
              aria-label="地点"
              value={location}
              placeholder="在哪儿？"
              onChange={(event) => patch({ location: event.target.value })}
              className="h-8 w-40 rounded-md border border-border bg-surface-solid px-2 text-caption text-ink-900"
            />
          )}

          {active === "tags" && (
            <>
              {tags.map((tag) => (
                <Chip
                  key={tag}
                  tone="accent"
                  onRemove={() =>
                    patch({ tags: normalizeTags(tags.filter((item) => item !== tag)) })
                  }
                  removeLabel={`移除标签 ${tag}`}
                >
                  #{tag}
                </Chip>
              ))}
              <input
                type="text"
                aria-label="新增标签"
                value={tagInput}
                placeholder="加标签"
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  const tag = tagInput.trim();
                  if (!tag) return;
                  patch({ tags: normalizeTags([...tags, tag]) });
                  setTagInput("");
                }}
                className="h-8 w-24 rounded-md border border-border bg-surface-solid px-2 text-caption text-ink-900"
              />
            </>
          )}

          {active === "goal" && (
            <>
              {goals.length === 0 && (
                <span className="text-micro text-ink-300">还没有进行中的目标，可在目标页新建</span>
              )}
              {goals.map((goal) => (
                <button
                  key={goal.id}
                  type="button"
                  aria-pressed={draft.goalId === goal.id}
                  onClick={() => patch({ goalId: goal.id, goalTitle: goal.title })}
                  className={cn(
                    "h-7 max-w-[12rem] truncate rounded-full px-2.5 text-micro transition-colors duration-[var(--dur-1)]",
                    draft.goalId === goal.id
                      ? "bg-accent-soft text-accent"
                      : "text-ink-500 hover:bg-surface-solid hover:text-ink-900",
                  )}
                >
                  @{goal.title}
                </button>
              ))}
              <button
                type="button"
                onClick={() => patch({ goalId: null, goalTitle: null })}
                className="text-micro text-ink-500 underline-offset-2 hover:text-ink-900 hover:underline"
              >
                不挂目标
              </button>
            </>
          )}

          {active === "quadrant" && (
            <>
              {QUADRANTS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={quadrant === value}
                  onClick={() => patch({ quadrant: value })}
                  className={cn(
                    "h-7 rounded-full px-2.5 text-micro transition-colors duration-[var(--dur-1)]",
                    quadrant === value
                      ? "bg-accent-soft text-accent"
                      : "text-ink-500 hover:bg-surface-solid hover:text-ink-900",
                  )}
                >
                  Q{value}
                </button>
              ))}
            </>
          )}

          {active === "recurrence" && (
            <>
              <span className="text-micro text-ink-500">重复已识别：{rrule}</span>
              <button
                type="button"
                onClick={() => patch({ rrule: null })}
                className="text-micro text-ink-500 underline-offset-2 hover:text-ink-900 hover:underline"
              >
                取消重复
              </button>
            </>
          )}

          <span className="ml-auto hidden text-micro text-ink-300 sm:inline">
            ↑↓ 切换 · Tab 接受
          </span>
          <button
            type="button"
            onClick={() => onActiveChange(null)}
            aria-label="收起微调"
            className={cn(
              "inline-flex size-6 items-center justify-center rounded-md text-ink-300",
              "hover:bg-surface-solid hover:text-ink-700",
              variant === "mobile" && "size-8",
            )}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

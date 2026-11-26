import { useEffect, useState } from "react";
import { Button, Dialog, Input } from "@detter/ui";
import { DEFAULT_FOCUS_SETTINGS, sanitizeSettings } from "./pomodoroModel";
import type { FocusSettings } from "./pomodoroModel";

/**
 * 番茄钟设置面板（页面右上角齿轮）。
 *
 * 写进 settings 表（`focus.pomodoro`），因此会跟着同步；
 * 改动对「还没开始的轮次」立即生效，正在跑的那一轮不受影响 ——
 * 否则时间会在中途被改，和 endsAt 的单一真相冲突。
 */
export interface PomodoroSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: FocusSettings;
  running: boolean;
  onSave: (next: FocusSettings) => void;
}

interface FieldProps {
  id: string;
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

function Field({ id, label, hint, value, min, max, onChange }: FieldProps) {
  return (
    <label htmlFor={id} className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-caption text-ink-700">{label}</span>
        <span className="text-micro text-ink-300">{hint}</span>
      </span>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={String(value)}
        className="mt-1 h-9 tabular"
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function PomodoroSettingsDialog({
  open,
  onOpenChange,
  value,
  running,
  onSave,
}: PomodoroSettingsDialogProps) {
  const [draft, setDraft] = useState<FocusSettings>(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const patch = (part: Partial<FocusSettings>) =>
    setDraft((current) => sanitizeSettings({ ...current, ...part }));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="番茄钟设置"
      description="默认 25 / 5 / 15，每 4 个番茄进入一次长休息。"
      size="sm"
      footer={
        <>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDraft(DEFAULT_FOCUS_SETTINGS)}
            className="mr-auto"
          >
            恢复默认
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              onSave(sanitizeSettings(draft));
              onOpenChange(false);
            }}
          >
            保存
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field
          id="focus-min"
          label="专注时长"
          hint="分钟"
          value={draft.focusMin}
          min={1}
          max={180}
          onChange={(focusMin) => patch({ focusMin })}
        />
        <Field
          id="short-break-min"
          label="短休息"
          hint="分钟"
          value={draft.shortBreakMin}
          min={1}
          max={60}
          onChange={(shortBreakMin) => patch({ shortBreakMin })}
        />
        <Field
          id="long-break-min"
          label="长休息"
          hint="分钟"
          value={draft.longBreakMin}
          min={1}
          max={120}
          onChange={(longBreakMin) => patch({ longBreakMin })}
        />
        <Field
          id="long-break-every"
          label="长休息间隔"
          hint="每 N 个番茄"
          value={draft.longBreakEvery}
          min={1}
          max={12}
          onChange={(longBreakEvery) => patch({ longBreakEvery })}
        />
      </div>

      <p className="mt-3 text-micro text-ink-500">
        {running ? "正在计时的那一轮不会被打断，新设置从下一轮开始生效。" : "设置会同步到其它设备。"}
      </p>
    </Dialog>
  );
}

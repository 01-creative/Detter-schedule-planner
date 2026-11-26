import { useEffect, useState } from "react";
import {
  DEFAULT_PERIOD_TIMES,
  type HomeworkReminderConfig,
  type PeriodTime,
  type ReminderWeekday,
} from "@detter/shared";
import { Button, Input, Switch, cn } from "@detter/ui";

/**
 * 课程设置面板（/courses 的弹窗与设置页共用同一个组件）。
 *
 * 三组值全部存 settings 表（跟着账号同步）：
 *   courses.semesterStart   → 第 1 周周一
 *   courses.periodTimes     → 节次作息（默认川大江安）
 *   courses.homeworkReminder→ 每周作业遗漏提醒的时刻（默认周日 20:00）
 */
export interface CourseSettingsPanelProps {
  semesterStart: string | null;
  periodTimes: PeriodTime[];
  homeworkReminder: HomeworkReminderConfig;
  onSave: (input: {
    semesterStart: string | null;
    periodTimes: PeriodTime[];
    homeworkReminder: HomeworkReminderConfig;
  }) => Promise<void>;
}

const WEEKDAY_OPTIONS: Array<{ value: ReminderWeekday; label: string }> = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 7, label: "周日" },
];

export function CourseSettingsPanel({
  semesterStart,
  periodTimes,
  homeworkReminder,
  onSave,
}: CourseSettingsPanelProps) {
  const [semesterText, setSemesterText] = useState(semesterStart ?? "");
  const [times, setTimes] = useState<PeriodTime[]>(periodTimes);
  const [reminder, setReminder] = useState<HomeworkReminderConfig>(homeworkReminder);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSemesterText(semesterStart ?? "");
    setTimes(periodTimes);
    setReminder(homeworkReminder);
  }, [semesterStart, periodTimes, homeworkReminder]);

  const patchTime = (index: number, edge: "start" | "end", value: string) => {
    setTimes((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, [edge]: value } : item)),
    );
  };

  const save = async () => {
    if (semesterText && !/^\d{4}-\d{2}-\d{2}$/.test(semesterText)) {
      setError("学期起点用 2026-09-07 这种格式");
      return;
    }
    if (times.some((item) => !/^\d{2}:\d{2}$/.test(item.start) || !/^\d{2}:\d{2}$/.test(item.end))) {
      setError("节次时间用 08:00 这种 24 小时格式");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await onSave({
        semesterStart: semesterText || null,
        periodTimes: times,
        homeworkReminder: reminder,
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("保存失败，稍后再试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-caption text-ink-700">学期第 1 周周一</span>
        <Input
          type="date"
          value={semesterText}
          onChange={(event) => setSemesterText(event.target.value)}
          className="tabular mt-1 max-w-[200px]"
          aria-label="学期第 1 周周一"
        />
        <span className="mt-1 block text-micro text-ink-300">
          用来把「第 N 周」换算成真实日期；课程自己填了学期起点时以课程为准。
        </span>
      </label>

      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption text-ink-700">节次作息</span>
          <Button size="sm" variant="ghost" onClick={() => setTimes([...DEFAULT_PERIOD_TIMES])}>
            恢复江安默认
          </Button>
        </div>
        <div className="mt-1.5 space-y-1">
          {times.map((item, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-micro text-ink-500">第 {index + 1} 节</span>
              <Input
                type="time"
                value={item.start}
                onChange={(event) => patchTime(index, "start", event.target.value)}
                className="tabular h-8 max-w-[110px]"
                aria-label={`第 ${index + 1} 节开始时间`}
              />
              <span className="text-micro text-ink-300">~</span>
              <Input
                type="time"
                value={item.end}
                onChange={(event) => patchTime(index, "end", event.target.value)}
                className="tabular h-8 max-w-[110px]"
                aria-label={`第 ${index + 1} 节结束时间`}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface-sunken/50 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-caption text-ink-900">每周作业遗漏提醒</p>
            <p className="text-micro text-ink-300">
              到点后生成一条应用内提醒：「本周还有 N 门课没记作业」
            </p>
          </div>
          <Switch
            checked={reminder.enabled}
            onCheckedChange={(checked) => setReminder((current) => ({ ...current, enabled: checked }))}
            label="每周作业遗漏提醒"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            className="h-8 rounded-md border border-border-strong bg-surface-solid px-2 text-caption text-ink-900"
            value={reminder.weekday}
            onChange={(event) =>
              setReminder((current) => ({ ...current, weekday: Number(event.target.value) as ReminderWeekday }))
            }
            aria-label="提醒的星期"
          >
            {WEEKDAY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Input
            type="time"
            value={reminder.time}
            onChange={(event) => setReminder((current) => ({ ...current, time: event.target.value }))}
            className="tabular h-8 max-w-[110px]"
            aria-label="提醒时间"
          />
          <span className="text-micro text-ink-300">默认周日 20:00（这一周的最后时机）</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" loading={saving} onClick={() => void save()}>
          保存课程设置
        </Button>
        {saved && <span className="text-micro text-success-ink">已保存</span>}
        {error && <span className={cn("text-micro text-danger-ink")}>{error}</span>}
      </div>
    </div>
  );
}

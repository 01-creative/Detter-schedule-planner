import { useEffect, useMemo, useState } from "react";
import { FileUp, TriangleAlert } from "lucide-react";
import {
  buildTimetablePlan,
  describePeriods,
  describeWeeks,
  parseTimetableHtml,
  type ParsedTimetable,
  type PeriodTime,
} from "@detter/shared";
import { Badge, Button, Dialog, Input } from "@detter/ui";
import { importTimetablePlan, type ImportResult } from "./courseActions";

/**
 * 「导入课表」：选 HTML → 预览 → 填学期起点 → 导入。
 *
 * 解析在 shared 里（纯函数），这里只做三件 UI 的事：
 * 1. 把「课程 + 每门课的上课时段」摆出来让人核对；
 * 2. 让用户确认学期第 1 周周一（决定第 N 周落在哪一天）；
 * 3. 导入后给出「新建了几门课 / 几条重复日程 / 跳过了几条」的明细。
 *
 * 重复导入是安全的：同课程名 + 同时段会被跳过（见 courseActions#importTimetablePlan）。
 */
export interface ImportTimetableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultSemesterStart: string;
  periodTimes: PeriodTime[];
  /** 导入成功回调：带回结果与本次使用的学期起点（调用方通常顺手把它存成全局设置） */
  onImported?: (result: ImportResult, semesterStart: string) => void;
}

const WEEKDAY_LABEL = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABEL[weekday - 1] ?? `周${weekday}`;
}

export function ImportTimetableDialog({
  open,
  onOpenChange,
  defaultSemesterStart,
  periodTimes,
  onImported,
}: ImportTimetableDialogProps) {
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedTimetable | null>(null);
  const [semesterStart, setSemesterStart] = useState(defaultSemesterStart);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  /**
   * 学期起点是异步同步回来的（换设备时尤其明显）：对话框一直挂载着，
   * 首次渲染拿到的 defaultSemesterStart 可能还是空的。关闭状态下跟随 prop 刷新，
   * 打开时就一定是最新值。
   */
  useEffect(() => {
    if (!open) setSemesterStart(defaultSemesterStart);
  }, [defaultSemesterStart, open]);

  const plan = useMemo(
    () => (parsed ? buildTimetablePlan(parsed, { semesterStart, periodTimes }) : null),
    [parsed, semesterStart, periodTimes],
  );

  const reset = () => {
    setFileName("");
    setParsed(null);
    setResult(null);
    setError("");
    setSemesterStart(defaultSemesterStart);
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setError("");
    setResult(null);
    setFileName(file.name);
    try {
      const html = await file.text();
      const next = parseTimetableHtml(html);
      setParsed(next);
      if (next.courses.length === 0) {
        setError("没有在文件里找到课程。确认是教务系统「本学期课程表」页面另存为的 HTML。");
      }
    } catch {
      setError("读取文件失败");
    }
  };

  const runImport = async () => {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      const imported = await importTimetablePlan(plan);
      setResult(imported);
      onImported?.(imported, semesterStart);
    } catch {
      setError("导入失败，稍后再试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={result ? "导入完成" : "导入课表"}
      description={
        result
          ? "重复导入不会产生重复日程：同名课程 + 同时段会被跳过。"
          : "在教务系统打开「本学期课程表」→ 另存为网页（HTML）→ 选这个文件。"
      }
      size="lg"
      footer={
        result ? (
          <Button size="sm" variant="primary" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              disabled={!plan || plan.courses.length === 0}
              onClick={() => void runImport()}
            >
              导入 {plan?.totals.courses ?? 0} 门课 · {plan?.totals.series ?? 0} 条重复日程
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "新建课程", value: result.coursesCreated },
              { label: "复用课程", value: result.coursesReused },
              { label: "新建日程", value: result.seriesCreated },
              { label: "跳过的时段", value: result.seriesSkipped },
            ].map((item) => (
              <div key={item.label} className="rounded-md border border-border bg-surface-sunken px-3 py-2">
                <dt className="text-micro text-ink-500">{item.label}</dt>
                <dd className="tabular text-h2 text-ink-900">{item.value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-caption text-ink-500">
            日程已按「周重复」写进日历，并默认提前 10 分钟提醒。课程默认标记为「每周有作业」，
            没有作业的课可以在课程详情里关掉。
          </p>
          {result.warnings.length > 0 && (
            <ul className="space-y-1 rounded-md bg-warning-soft px-3 py-2 text-micro text-warning-ink">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border-strong bg-surface-sunken/50 px-3 py-3 text-caption text-ink-700 hover:border-accent/40">
            <FileUp className="size-4 text-accent" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">
              {fileName || "选择课表 HTML 文件（本学期课程表.html）"}
            </span>
            <input
              type="file"
              accept=".html,.htm,text/html"
              className="sr-only"
              aria-label="选择课表 HTML 文件"
              onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
            />
            <span className="text-micro text-accent">选择文件</span>
          </label>

          {parsed && parsed.courses.length > 0 && (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="text-caption text-ink-700">学期第 1 周周一</span>
                  <Input
                    type="date"
                    value={semesterStart}
                    onChange={(event) => setSemesterStart(event.target.value)}
                    className="tabular mt-1 max-w-[200px]"
                    aria-label="学期第 1 周周一"
                  />
                </label>
                <p className="text-micro text-ink-300">
                  解析到 {parsed.courses.length} 门课 / {parsed.stats.slots} 个时段，将生成{" "}
                  {plan?.totals.series ?? 0} 条周重复日程
                </p>
              </div>

              <ul className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
                {plan?.courses.map((course) => (
                  <li key={course.name} className="rounded-md border border-border bg-surface-solid p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: course.color }}
                      />
                      <p className="min-w-0 max-w-full truncate text-body font-strong text-ink-900">
                        {course.name}
                      </p>
                      {course.code && <Badge tone="neutral">课号 {course.code}</Badge>}
                      <span className="w-full shrink-0 text-micro text-ink-500 sm:ml-auto sm:w-auto">
                        {course.slots.length} 个时段 · 到第 {course.maxWeek} 周
                      </span>
                    </div>
                    <ul className="mt-1.5 space-y-0.5">
                      {course.slots.map((slot, index) => (
                        <li key={`${slot.weekday}-${slot.startPeriod}-${index}`} className="text-micro text-ink-500">
                          <span className="text-ink-700">{weekdayLabel(slot.weekday)}</span>
                          {" "}
                          {describePeriods(slot.startPeriod, slot.endPeriod)}
                          {" · "}
                          {describeWeeks(slot.weeks)}
                          {slot.location ? ` · ${slot.location}` : ""}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>

              {plan && plan.warnings.length > 0 && (
                <ul className="space-y-1 rounded-md bg-warning-soft px-3 py-2 text-micro text-warning-ink">
                  {plan.warnings.map((warning) => (
                    <li key={warning} className="flex items-start gap-1.5">
                      <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                      {warning}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {error && <p className="text-caption text-danger-ink">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}

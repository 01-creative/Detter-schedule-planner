import { BookOpen } from "lucide-react";
import { Card, useToast } from "@detter/ui";
import { CourseSettingsPanel } from "./CourseSettingsPanel";
import { LoadingState } from "@/components/common/LoadingState";
import { saveCourseSettings } from "./courseActions";
import { useCoursesData } from "./queries";

/**
 * 设置页里的「课程与课表」分区。
 *
 * 与 /courses 里的设置弹窗共用 `CourseSettingsPanel`，避免两处表单各自漂移。
 */
export function CourseSettingsSection() {
  const { semesterStart, periodTimes, homeworkReminder, loading } = useCoursesData();
  const { toast } = useToast();

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <BookOpen className="size-4 text-accent" aria-hidden="true" />
        <h2 className="text-h2 text-ink-900">课程与课表</h2>
      </div>
      <p className="text-caption text-ink-500">
        学期起点把「第 N 周」换算成真实日期；节次作息决定导入课表后每节课的起止时间；每周作业提醒决定周日什么时候催你补记。
      </p>
      {loading ? (
        <LoadingState rows={2} />
      ) : (
        <CourseSettingsPanel
          semesterStart={semesterStart}
          periodTimes={periodTimes}
          homeworkReminder={homeworkReminder}
          onSave={async (input) => {
            await saveCourseSettings(input);
            toast({ title: "课程设置已保存", tone: "success" });
          }}
        />
      )}
    </Card>
  );
}

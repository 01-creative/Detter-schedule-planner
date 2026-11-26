import { Link } from "react-router-dom";
import { AlertTriangle, ChevronRight, ClipboardList } from "lucide-react";
import { Badge, Card, cn } from "@detter/ui";
import type { CourseCardModel } from "./coursesModel";
import { courseSubtitle, weightStatusLabel } from "./coursesModel";
import { WeightBar } from "./WeightBar";
import { dayKey } from "@detter/shared";

/**
 * 课程卡：一门课一张卡，信息密度按「一眼能回答三个问题」来定：
 * 1. 这门课占多少分？（权重合计 + 考核项数）
 * 2. 我这周记作业了吗？（本周作业徽标）
 * 3. 下一个死线是什么？（下一项考核）
 *
 * 移动端一列、桌面端两列（由父级 grid 控制），卡片本身不写死宽度。
 */
export function CourseCard({ card }: { card: CourseCardModel }) {
  const { course, weight } = card;
  const over = weight.total > 100;
  const hasThisWeek = card.thisWeekAssignments.length > 0;

  return (
    <Link
      to={`/courses/${course.id}`}
      className="group block rounded-lg focus-visible:outline-none"
      aria-label={`打开课程 ${course.name}`}
    >
      <Card interactive padding="md" className="relative h-full overflow-hidden">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1"
          style={{ backgroundColor: course.color }}
        />
        <div className="flex items-start gap-2 pl-1.5">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-h2 text-ink-900">{course.name}</h3>
            <p className="mt-0.5 truncate text-micro text-ink-500">{courseSubtitle(card)}</p>
          </div>
          <ChevronRight
            className="mt-1 size-4 shrink-0 text-ink-300 transition-transform duration-[var(--dur-1)] group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </div>

        <div className="mt-3 pl-1.5">
          <WeightBar summary={weight} compact />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 pl-1.5">
          <Badge tone={hasThisWeek ? "success" : course.weeklyHomework ? "warning" : "neutral"} dot>
            {hasThisWeek
              ? `本周已记 ${card.thisWeekAssignments.length} 条作业`
              : course.weeklyHomework
                ? "本周还没记作业"
                : "这周没有作业"}
          </Badge>
          <Badge tone="neutral" icon={<ClipboardList className="size-3" aria-hidden="true" />}>
            {card.assessmentCount} 项考核
          </Badge>
          {over && (
            <Badge tone="warning" icon={<AlertTriangle className="size-3" aria-hidden="true" />}>
              {weightStatusLabel(weight)}
            </Badge>
          )}
        </div>

        {card.nextAssessment && (
          <p className="mt-2.5 truncate pl-1.5 text-micro text-ink-300">
            下一项：
            <span className="text-ink-500">{card.nextAssessment.title}</span>
            <span className="tabular text-ink-500">
              {card.nextAssessment.at === null ? "" : ` · ${dayKey(card.nextAssessment.at)}`}
            </span>
          </p>
        )}
        {course.note && (
          <p className={cn("mt-1 truncate pl-1.5 text-micro text-ink-300")} title={course.note}>
            {course.note}
          </p>
        )}
      </Card>
    </Link>
  );
}

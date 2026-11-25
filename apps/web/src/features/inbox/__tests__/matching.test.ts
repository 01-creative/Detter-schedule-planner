import { describe, expect, it } from "vitest";
import { TaskSchema, type Goal, type Task } from "@detter/shared";
import {
  DUPLICATE_THRESHOLD,
  findConflict,
  findDuplicate,
  normalizeTitle,
  suggestGoal,
  titleSimilarity,
} from "@/features/inbox/matching";

/**
 * 去重与冲突判定的边界（任务书 §4.3 与 §8 第 7 条）。
 *
 * 阈值这种东西必须钉死在测试里：调一下阈值就可能让「交高数作业」和
 * 「交高数作业（第 12 周）」要么全被判重复、要么完全不提醒。
 */

const NOW = new Date(2026, 10, 26, 10, 0, 0).getTime();

function makeTask(overrides: Partial<Task> & { title: string }): Task {
  return TaskSchema.parse({
    id: `task-${overrides.title}`,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

function makeGoal(title: string, id = `goal-${title}`): Goal {
  return {
    id,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    rev: 1,
    deviceId: "test",
    title,
    description: "",
    kind: "once",
    status: "active",
    horizon: "none",
    color: "#6355F6",
    icon: "target",
    rrule: null,
    startDate: null,
    endDate: null,
    milestones: [],
    okrId: null,
    krId: null,
    usageCount: 0,
    lastUsedAt: null,
    sortIndex: 0,
    archivedAt: null,
  };
}

describe("标题相似度", () => {
  it("归一化会去掉空白、标点与 # @ 标记", () => {
    expect(normalizeTitle(" #作业 明天！")).toBe("作业明天");
    expect(normalizeTitle("交高数作业")).toBe("交高数作业");
  });

  it("只差标点算完全一样", () => {
    expect(titleSimilarity("交高数作业", "交高数作业！")).toBe(1);
    expect(titleSimilarity("交高数作业", "交 高数 作业")).toBe(1);
  });

  it("差一个字仍然高于阈值，差两个以上明显下降", () => {
    const near = titleSimilarity("复习线性代数第三章", "复习线性代数第3章");
    expect(near).toBeGreaterThan(DUPLICATE_THRESHOLD);

    const far = titleSimilarity("复习线性代数", "去超市买菜");
    expect(far).toBeLessThan(0.5);
  });

  it("阈值边界：低于 0.85 不再提示重复", () => {
    // 6 个字符差 1 个 → 1 - 1/6 ≈ 0.833
    expect(titleSimilarity("abcdef", "abcdeX")).toBeCloseTo(1 - 1 / 6, 5);
    expect(titleSimilarity("abcdef", "abcdeX")).toBeLessThan(DUPLICATE_THRESHOLD);

    const tasks = [makeTask({ title: "abcdef" })];
    expect(findDuplicate("abcdeX", tasks, NOW)).toBeNull();
    expect(findDuplicate("abcdef", tasks, NOW)?.task.title).toBe("abcdef");
  });
});

describe("7 天去重窗口", () => {
  it("只比对最近 7 天创建的任务", () => {
    const recent = makeTask({
      title: "交高数作业",
      createdAt: NOW - 6 * 86_400_000,
      updatedAt: NOW - 6 * 86_400_000,
    });
    const stale = makeTask({
      title: "交高数作业",
      createdAt: NOW - 8 * 86_400_000,
      updatedAt: NOW - 8 * 86_400_000,
    });

    expect(findDuplicate("交高数作业", [recent], NOW)?.task.title).toBe("交高数作业");
    expect(findDuplicate("交高数作业", [stale], NOW)).toBeNull();
  });

  it("已删除的任务不参与比对", () => {
    const task = makeTask({ title: "交高数作业", deletedAt: NOW });
    expect(findDuplicate("交高数作业", [task], NOW)).toBeNull();
  });
});

describe("时间冲突", () => {
  it("有重叠就命中，首尾相接不算冲突", () => {
    const base = NOW;
    const task = makeTask({
      title: "写周报",
      startAt: base,
      endAt: base + 3_600_000,
    });

    expect(findConflict(base + 1_800_000, null, [task])?.task.title).toBe("写周报");
    // 正好接在结束点上：不重叠
    expect(findConflict(base + 3_600_000, null, [task])).toBeNull();
    // 没有时间的记录永远不会冲突
    expect(findConflict(null, null, [task])).toBeNull();
  });

  it("全天任务按整天算", () => {
    const dayStart = new Date(2026, 10, 27, 0, 0, 0).getTime();
    const task = makeTask({
      title: "出差",
      startAt: dayStart,
      endAt: null,
      allDay: true,
    });
    expect(findConflict(dayStart + 15 * 3_600_000, null, [task])?.task.title).toBe("出差");
  });
});

describe("目标自动建议", () => {
  it("文本里出现目标标题就建议，多个命中取更具体的那个", () => {
    const goals = [makeGoal("高数"), makeGoal("高数不挂科")];
    expect(suggestGoal("明天复习高数", goals)?.title).toBe("高数");
    expect(suggestGoal("明天复习高数不挂科", goals)?.title).toBe("高数不挂科");
    expect(suggestGoal("去超市", goals)).toBeNull();
  });

  it("已暂停的目标不参与建议", () => {
    const goal = { ...makeGoal("高数"), status: "paused" as const };
    expect(suggestGoal("复习高数", [goal])).toBeNull();
  });
});

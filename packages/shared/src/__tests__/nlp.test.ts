import { describe, expect, it } from "vitest";
import { parseQuickCapture } from "../nlp";

/**
 * 固定基准时间：2026-11-25（周三）10:00 本地时间。
 * 用 new Date(y, m, d, h) 构造，避免测试对机器时区敏感。
 */
const NOW = new Date(2026, 10, 25, 10, 0, 0).getTime();
const parse = (text: string, extra: Parameters<typeof parseQuickCapture>[1] = {}) =>
  parseQuickCapture(text, { now: NOW, ...extra });

function at(y: number, m: number, d: number, h: number, min = 0): number {
  return new Date(y, m - 1, d, h, min, 0, 0).getTime();
}

describe("parseQuickCapture · 标题与结构化标记", () => {
  it("只写文字时，整句都是标题", () => {
    const d = parse("买猫粮");
    expect(d.title).toBe("买猫粮");
    expect(d.startAt).toBeNull();
    expect(d.tags).toEqual([]);
  });

  it("剥离 #标签，标签不进入标题", () => {
    const d = parse("交高数作业 #作业 #紧急");
    expect(d.title).toBe("交高数作业");
    expect(d.tags).toEqual(["作业", "紧急"]);
  });

  it("!1 显式指定象限", () => {
    const d = parse("!1 修服务器");
    expect(d.quadrantGuess).toBe(1);
    expect(d.title).toBe("修服务器");
  });

  it("@目标 命中已有目标时回填 id", () => {
    const d = parse("复习线代 @高数", {
      goals: [{ id: "g1", title: "高数不挂科" }],
    });
    expect(d.goalId).toBe("g1");
    expect(d.goalTitle).toBe("高数不挂科");
    expect(d.title).toBe("复习线代");
  });
});

describe("parseQuickCapture · 时间", () => {
  it("明天下午3点 → 明天 15:00", () => {
    const d = parse("明天下午3点 交高数作业");
    expect(d.title).toBe("交高数作业");
    expect(d.startAt).toBe(at(2026, 11, 26, 15, 0));
    expect(d.allDay).toBe(false);
  });

  it("不带时段时 1~6 点按下午理解", () => {
    const d = parse("明天3点 开会");
    expect(d.startAt).toBe(at(2026, 11, 26, 15, 0));
  });

  it("明天（无时刻）→ 全天，截止到当天结束", () => {
    const d = parse("明天 交周报");
    expect(d.allDay).toBe(true);
    expect(d.startAt).toBe(at(2026, 11, 26, 0, 0));
    expect(d.dueAt).toBe(at(2026, 11, 26, 0, 0) + 86_400_000 - 1);
  });

  it("时间段 9:00-11:00", () => {
    const d = parse("明天 9:00-11:00 组会 在教三");
    expect(d.startAt).toBe(at(2026, 11, 26, 9, 0));
    expect(d.endAt).toBe(at(2026, 11, 26, 11, 0));
    expect(d.location).toBe("教三");
    expect(d.title).toBe("组会");
  });

  it("相对时间：两小时后", () => {
    const d = parse("两小时后 回邮件");
    expect(d.startAt).toBe(NOW + 2 * 3600_000);
    expect(d.title).toBe("回邮件");
  });

  it("时长：40分钟", () => {
    const d = parse("明天 10点 写代码 40分钟");
    expect(d.durationMin).toBe(40);
    expect(d.endAt).toBe(at(2026, 11, 26, 10, 40));
  });

  it("下周三 → 下周同一天", () => {
    const d = parse("下周三 交材料");
    expect(d.startAt).toBe(at(2026, 12, 2, 0, 0));
  });

  it("9月1日 已过去则算明年", () => {
    const d = parse("9月1日 开学");
    expect(new Date(d.startAt!).getFullYear()).toBe(2027);
  });
});

describe("parseQuickCapture · 重复与推测", () => {
  it("每周一 → RRULE BYDAY=MO", () => {
    const d = parse("每周一 健身 1小时");
    expect(d.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(d.durationMin).toBe(60);
    expect(d.title).toBe("健身");
  });

  it("每天 → FREQ=DAILY", () => {
    expect(parse("每天 背单词").rrule).toBe("FREQ=DAILY");
  });

  it("关键词兜底猜象限：学习类进 Q2", () => {
    expect(parse("复习线代").quadrantGuess).toBe(2);
  });

  it("关键词兜底猜象限：紧急琐事进 Q3", () => {
    expect(parse("尽快 回消息").quadrantGuess).toBe(3);
  });

  it("置信度随命中字段增加", () => {
    expect(parse("买猫粮").confidence).toBeLessThan(
      parse("明天下午3点 在教三 交作业 #作业 30分钟").confidence,
    );
  });

  it("matches 记录命中片段，供 UI 高亮", () => {
    const d = parse("明天下午3点 交作业 #作业");
    const kinds = d.matches.map((m) => m.kind);
    expect(kinds).toContain("date");
    expect(kinds).toContain("time");
    expect(kinds).toContain("tag");
  });
});

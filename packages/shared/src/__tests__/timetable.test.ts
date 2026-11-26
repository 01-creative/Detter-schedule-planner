import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cleanCourseName,
  cleanTeacher,
  decodeHtmlEntities,
  parsePeriodRange,
  parseTimetableHtml,
  parseWeeks,
} from "../timetable.ts";

/**
 * 课表解析器的回归测试。
 *
 * 夹具是从真实教务系统保存页裁出来的（3 门课 / 6 个时段），覆盖了：
 * 课程号后缀、教师星号、连续周、单周、双周、多段周次、带空格周次、
 * 一个 td 两个课程块、表头 0_x 忽略、空单元格忽略。
 *
 * 这些断言的意义：教务系统换版式时，失败信息能直接指出「哪条假设被打破了」，
 * 而不是抛一个看不出原因的 undefined。
 */

const FIXTURE = readFileSync(
  new URL("../__fixtures__/timetable.sample.html", import.meta.url),
  "utf8",
);

describe("课表解析：真实夹具", () => {
  const parsed = parseTimetableHtml(FIXTURE);

  it("识别 3 门课 / 6 个时段，且没有解析告警", () => {
    expect(parsed.courses).toHaveLength(3);
    expect(parsed.stats.slots).toBe(6);
    expect(parsed.stats.courseCells).toBe(5);
    expect(parsed.warnings).toEqual([]);
  });

  it("课程名去掉 _NN 课程号后缀，并保留课程号", () => {
    const names = parsed.courses.map((course) => course.name).sort();
    expect(names).toEqual(["学术英语写作", "数字电子技术基础实验（Ⅱ）", "概率统计（理工）"].sort());
    const probability = parsed.courses.find((course) => course.name === "概率统计（理工）");
    expect(probability?.code).toBe("42");
    expect(probability?.teacher).toBe("祝亭玉");
  });

  it("教师名去掉代表主讲的星号", () => {
    for (const course of parsed.courses) {
      expect(course.teacher).not.toContain("*");
    }
  });

  it("同一门课的两处上课被合并成多个时段（不是两条课程）", () => {
    const probability = parsed.courses.find((course) => course.name === "概率统计（理工）");
    expect(probability?.slots).toHaveLength(3);
    expect(probability?.slots.map((slot) => slot.weekday)).toEqual([2, 4, 4]);
    expect(probability?.slots.map((slot) => [slot.startPeriod, slot.endPeriod])).toEqual([
      [1, 2],
      [3, 4],
      [5, 7],
    ]);
  });

  it("1-17周 → 17 个连续周", () => {
    const probability = parsed.courses.find((course) => course.name === "概率统计（理工）");
    expect(probability?.slots[0]?.weeks).toEqual(Array.from({ length: 17 }, (_, index) => index + 1));
  });

  it("`1-8周,10-16周` → 两段（第 9 周没有课）", () => {
    const probability = parsed.courses.find((course) => course.name === "概率统计（理工）");
    const slot = probability?.slots[2];
    expect(slot?.weeks).toHaveLength(15);
    expect(slot?.weeks).toContain(8);
    expect(slot?.weeks).not.toContain(9);
    expect(slot?.weeks).toContain(10);
    expect(slot?.weeks.at(-1)).toBe(16);
  });

  it("单周后缀 `3-9周单周` → 3,5,7,9", () => {
    const english = parsed.courses.find((course) => course.name === "学术英语写作");
    const odd = english?.slots.find((slot) => slot.weeks.length === 4);
    expect(odd?.weeks).toEqual([3, 5, 7, 9]);
    expect(odd?.weekday).toBe(5);
    expect(odd?.location).toContain("B507");
  });

  it("双周后缀 `4-18周双周` → 4,6,8,…,18", () => {
    const course = parsed.courses.find((course) => course.name.startsWith("数字电子技术基础实验"));
    expect(course?.slots[0]?.weeks).toEqual([4, 6, 8, 10, 12, 14, 16, 18]);
    expect(course?.slots[0]?.startPeriod).toBe(5);
    expect(course?.slots[0]?.endPeriod).toBe(8);
  });

  it("带空格的 `1-16 周` 也能解析", () => {
    const english = parsed.courses.find((course) => course.name === "学术英语写作");
    const regular = english?.slots.find((slot) => slot.weekday === 2);
    expect(regular?.weeks).toEqual(Array.from({ length: 16 }, (_, index) => index + 1));
  });

  it("一个 td 里两个 class_div → 解析成两门不同的课", () => {
    const fridayFifth = parsed.courses.filter((course) =>
      course.slots.some((slot) => slot.weekday === 5 && slot.startPeriod === 5),
    );
    expect(fridayFifth.map((course) => course.name).sort()).toEqual(
      ["学术英语写作", "数字电子技术基础实验（Ⅱ）"].sort(),
    );
  });

  it("嵌套的 tools div 不会把课程块切成两半", () => {
    // 概率统计的第一个块里有一个带 onclick 的 tools div，若被误切会多出 0 周的课程
    const probability = parsed.courses.find((course) => course.name === "概率统计（理工）");
    expect(probability?.slots.every((slot) => slot.weeks.length > 0)).toBe(true);
  });
});

describe("课表解析：容错", () => {
  it("没有 courseTableBody 时退化为扫描整页表格并给出告警", () => {
    const fragment =
      '<table><tr><td id="1_1"><div class="class_div"><p class="p-kcm-1">测试课_01</p>' +
      '<p class="kcb_p_gray">张老师*</p><p class="kcb_p_gray">1-2周</p>' +
      '<p class="kcb_p_gray">1-2节</p><p class="p-jxl-1">一教</p></div></td></tr></table>';
    const parsed = parseTimetableHtml(fragment);
    expect(parsed.courses).toHaveLength(1);
    expect(parsed.warnings.join()).toContain("courseTableBody");
  });

  it("空文件 / 非 HTML 不抛异常，只返回空结果", () => {
    expect(parseTimetableHtml("").courses).toEqual([]);
    expect(parseTimetableHtml("<html><body>没有课表</body></html>").courses).toEqual([]);
  });

  it("表头 0_x 的单元格不会被当成课程", () => {
    const html =
      '<tbody id="courseTableBody"><tr><th id="0_1">第一节</th>' +
      '<td id="1_1"><div class="class_div"><p class="p-kcm-1">课A_1</p>' +
      '<p class="kcb_p_gray">李老师*</p><p class="kcb_p_gray">1周</p>' +
      '<p class="kcb_p_gray">1节</p></div></td></tr></tbody>';
    const parsed = parseTimetableHtml(html);
    expect(parsed.courses).toHaveLength(1);
    expect(parsed.courses[0]?.slots[0]?.weeks).toEqual([1]);
  });
});

describe("周次解析：直接测函数", () => {
  it.each([
    ["1-17周", 17],
    ["1-8周,10-16周", 15],
    ["1-17周(单)", 9],
    ["1-16周(双)", 8],
    ["3-9周单周", 4],
    ["4-18周双周", 8],
    ["1-16 周", 16],
    ["3周", 1],
  ])("%s → %i 周", (raw, expected) => {
    expect(parseWeeks(raw)).toHaveLength(expected);
  });

  it("单周标记的两种写法结果一致", () => {
    expect(parseWeeks("1-9周(单)")).toEqual(parseWeeks("1-9周单周"));
    expect(parseWeeks("1-9周(单)")).toEqual([1, 3, 5, 7, 9]);
  });

  it("无法识别的文本返回空数组而不是抛错", () => {
    expect(parseWeeks("周次待定")).toEqual([]);
    expect(parseWeeks("")).toEqual([]);
  });
});

describe("节次 / 名称 / 实体", () => {
  it("节次范围：三种写法", () => {
    expect(parsePeriodRange("1-2节")).toEqual({ startPeriod: 1, endPeriod: 2 });
    expect(parsePeriodRange("10-12节")).toEqual({ startPeriod: 10, endPeriod: 12 });
    expect(parsePeriodRange("5节")).toEqual({ startPeriod: 5, endPeriod: 5 });
    expect(parsePeriodRange("第5节")).toBeNull();
  });

  it("课程名后缀只在像编号时才剥掉", () => {
    expect(cleanCourseName("概率统计（理工）_42")).toEqual({ name: "概率统计（理工）", code: "42" });
    expect(cleanCourseName("Python_数据分析")).toEqual({ name: "Python_数据分析", code: "" });
    expect(cleanCourseName("体育-3匹克球_06")).toEqual({ name: "体育-3匹克球", code: "06" });
  });

  it("教师名去星号、保留多位教师", () => {
    expect(cleanTeacher("祝亭玉*")).toBe("祝亭玉");
    expect(cleanTeacher("刘颖*,文晓刚")).toBe("刘颖,文晓刚");
  });

  it("HTML 实体解码", () => {
    expect(decodeHtmlEntities("A&amp;B&#65;&#x42;")).toBe("A&BAB");
  });
});

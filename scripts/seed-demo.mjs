/**
 * 灌一批能看懂的示例数据（不覆盖你已有的数据，全部是新记录）。
 *
 *   node scripts/seed-demo.mjs --url=http://127.0.0.1:5173 --password=你的密码
 *
 * 会创建：2 个目标、1 个 OKR（3 个 KR）、3 个 KPI、一条周目标下的任务若干、几条收件箱待整理。
 * 想反悔：设置页「清空本地数据」，或直接删掉数据库文件。
 */
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || "true"];
  }),
);

const base = (args.url ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const password = args.password;
if (!password) {
  console.error("缺少 --password（就是你登录用的主密码）");
  process.exit(1);
}

let cookie = "";

async function call(path, init = {}) {
  const res = await fetch(base + "/api/v1" + path, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-detter-csrf": "1",
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path} 返回的不是 JSON：${text.slice(0, 120)}`);
  }
  if (!json.ok) throw new Error(`${path} 失败：${json.error?.message ?? text.slice(0, 120)}`);
  return json.data;
}

const DAY = 86_400_000;
const now = Date.now();
const today = new Date();
today.setHours(0, 0, 0, 0);
const at = (dayOffset, hour, minute = 0) =>
  new Date(today.getTime() + dayOffset * DAY + hour * 3_600_000 + minute * 60_000).getTime();

async function main() {
  console.log(`→ 登录 ${base}`);
  await call("/auth/login", { method: "POST", body: JSON.stringify({ password, deviceName: "seed" }) });

  const goals = [];
  const goalSpecs = [
    {
      title: "高数不挂科",
      description: "期末前把三章补完",
      kind: "once",
      horizon: "month",
      color: "#6366F1",
      endDate: new Date(today.getTime() + 45 * DAY).toISOString().slice(0, 10),
      milestones: [
        { id: "m1", title: "第三章 多元微分", done: false },
        { id: "m2", title: "第四章 重积分", done: false },
        { id: "m3", title: "真题两套", done: false },
      ],
    },
    {
      title: "每周三次健身",
      description: "长期的东西，别让它总排在最急的事后面",
      kind: "recurring",
      horizon: "week",
      color: "#10B981",
      rrule: "FREQ=WEEKLY;BYDAY=MO,WE,SA",
      milestones: [],
    },
    {
      title: "把英语听力拉上来",
      description: "六级之前",
      kind: "once",
      horizon: "quarter",
      color: "#F59E0B",
      milestones: [],
    },
  ];

  for (const g of goalSpecs) {
    const goal = await call("/goals", { method: "POST", body: JSON.stringify(g) });
    goals.push(goal);
    console.log(`  ✓ 目标 ${goal.title}`);
  }

  const okr = await call("/okrs", {
    method: "POST",
    body: JSON.stringify({
      title: "把英语听力拉上来",
      period: "month",
      periodStart: new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10),
      periodEnd: new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10),
      status: "active",
      color: "#8B5CF6",
    }),
  });
  console.log(`  ✓ OKR ${okr.title}`);

  const krSpecs = [
    { title: "每周精听 3 次", metricType: "number", startValue: 0, targetValue: 12, currentValue: 3, unit: "次" },
    { title: "完成 20 篇 TED 精听", metricType: "number", startValue: 0, targetValue: 20, currentValue: 5, unit: "篇" },
    { title: "六级模考 ≥ 550", metricType: "number", startValue: 480, targetValue: 550, currentValue: 505, unit: "分" },
  ];
  for (const [i, kr] of krSpecs.entries()) {
    await call("/key-results", {
      method: "POST",
      body: JSON.stringify({ ...kr, okrId: okr.id, sortIndex: i }),
    });
  }
  console.log(`  ✓ ${krSpecs.length} 个 KR`);

  const kpiSpecs = [
    { name: "深度工作时长", unit: "分钟", direction: "up", targetValue: 900, period: "week", aggregation: "sum", autoSource: "pomodoro_min", color: "#0EA5E9" },
    { name: "健身次数", unit: "次", direction: "up", targetValue: 3, period: "week", aggregation: "sum", color: "#10B981" },
    { name: "刷手机时长", unit: "分钟", direction: "down", targetValue: 120, period: "day", aggregation: "sum", color: "#F59E0B" },
  ];
  const kpis = [];
  for (const [i, k] of kpiSpecs.entries()) {
    const kpi = await call("/kpis", { method: "POST", body: JSON.stringify({ ...k, sortIndex: i }) });
    kpis.push(kpi);
    console.log(`  ✓ KPI ${kpi.name}`);
  }

  const taskSpecs = [
    { title: "交高数作业（第 12 周）", quadrant: 1, dueAt: at(1, 15), tags: ["作业"], goalId: goals[0].id, estimateMin: 40 },
    { title: "复习线代第 3 章", quadrant: 2, startAt: at(2, 9), endAt: at(2, 10, 30), tags: ["学习"], goalId: goals[0].id },
    { title: "跑步 5 公里", quadrant: 2, startAt: at(4, 19, 30), endAt: at(4, 20, 30), tags: ["健康"], goalId: goals[1].id, rrule: "FREQ=WEEKLY;BYDAY=TH" },
    { title: "写这周的复盘", quadrant: 2, startAt: at(6, 20), endAt: at(6, 20, 40), tags: ["复盘"] },
    { title: "取快递", quadrant: 3, dueAt: at(0, 17), tags: ["生活"] },
    { title: "帮室友带饭", quadrant: 3, dueAt: at(0, 19), tags: ["生活"] },
    { title: "刷一会儿短视频", quadrant: 4, tags: ["娱乐"] },
    { title: "准备英语听力（精听 20 分钟）", quadrant: 2, startAt: at(1, 20), endAt: at(1, 20, 20), tags: ["英语"], goalId: goals[2].id, okrId: okr.id },
  ];
  for (const t of taskSpecs) {
    await call("/tasks", { method: "POST", body: JSON.stringify({ kind: "task", status: "todo", ...t }) });
  }
  console.log(`  ✓ ${taskSpecs.length} 条任务（含重复任务）`);

  const inboxSpecs = [
    "明天下午3点 交高数作业 #作业 在教三 40分钟",
    "周五前把借的书还了 #杂事",
    "9月1日 开学 需要带的东西列个清单",
  ];
  for (const text of inboxSpecs) {
    await call("/capture", { method: "POST", body: JSON.stringify({ text, source: "manual" }) });
  }
  console.log(`  ✓ ${inboxSpecs.length} 条收件箱待整理`);

  // 给"深度工作时长"造几天数据，让 KPI 曲线不是平的
  const dayKeys = [1, 2, 3].map((d) => new Date(now - d * DAY).toISOString().slice(0, 10));
  for (const [i, date] of dayKeys.entries()) {
    await call("/kpi-entries", {
      method: "POST",
      body: JSON.stringify({ kpiId: kpis[0].id, date, value: 90 + i * 25, source: "manual" }),
    });
  }
  console.log("  ✓ 3 天 KPI 打卡");

  console.log("\n完成。刷新页面就能看到数据了。");
}

main().catch((error) => {
  console.error("\n失败：", error.message);
  process.exit(1);
});

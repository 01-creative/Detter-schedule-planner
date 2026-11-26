/**
 * 全站走查：登录一次，然后逐路由 × 逐视口 截图 + 检查横向溢出 / 控制台错误。
 *
 * 用法：
 *   node scripts/qa-audit.mjs --url=http://127.0.0.1:4173 --password=xxx --out=.qa/audit
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || "true"];
  }),
);
const base = (args.url ?? "http://127.0.0.1:4173").replace(/\/$/, "");
const password = args.password ?? "";
const setupToken = args.token ?? "";
const out = args.out ?? ".qa/audit";
const waitMs = Number(args.wait ?? 1000);

const ROUTES = [
  ["/", "home"],
  ["/inbox", "inbox"],
  ["/calendar", "calendar"],
  ["/okr", "okr"],
  ["/review", "review"],
  ["/kpi", "kpi"],
  ["/focus", "focus"],
  ["/mindmap", "mindmap"],
  ["/settings", "settings"],
];

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "375", width: 375, height: 812 },
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch();

/* 先登录一次，复用 storageState */
let storageState;
if (password) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "zh-CN" });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  if (page.url().includes("/setup")) {
    const inputs = page.locator("input");
    await inputs.nth(0).fill(setupToken);
    await inputs.nth(1).fill(password);
    if ((await inputs.nth(2).count()) > 0) await inputs.nth(2).fill(password);
    await page.getByRole("button").filter({ hasText: /创建|初始化|开始/ }).first().click();
    await page.waitForTimeout(1600);
  } else if (page.url().includes("/login")) {
    await page.locator("input[type=password]").first().fill(password);
    await page.getByRole("button").filter({ hasText: /登录|进入/ }).first().click();
    await page.waitForTimeout(1600);
  }
  storageState = await ctx.storageState();
  await ctx.close();
}

const report = { base, at: new Date().toISOString(), pages: [] };

for (const vp of VIEWPORTS) {
  for (const [route, name] of ROUTES) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      ...(storageState ? { storageState } : {}),
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 160)}`));
    page.on("console", (m) => {
      if (m.type() === "error" && !/401|Failed to load resource/.test(m.text())) {
        errors.push(m.text().slice(0, 160));
      }
    });

    const started = Date.now();
    await page.goto(base + route, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(waitMs);
    const domMs = Date.now() - started;

    const metrics = await page.evaluate(() => {
      const el = document.documentElement;
      const nav = performance.getEntriesByType("navigation")[0];
      return {
        title: document.title,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        text: (document.body?.innerText ?? "").slice(0, 160),
        dcl: nav?.domContentLoadedEventEnd ?? null,
      };
    });

    const file = path.join(out, `${name}-${vp.name}.png`);
    await page.screenshot({ path: file, fullPage: vp.name === "375" });

    report.pages.push({
      route,
      name,
      viewport: vp.name,
      file,
      domMs,
      overflowX: metrics.scrollWidth > metrics.clientWidth + 1,
      blank: metrics.text.trim().length < 10,
      errors,
    });

    await ctx.close();
  }
}

await browser.close();
await writeFile(path.join(out, "audit.json"), JSON.stringify(report, null, 2), "utf8");

for (const p of report.pages) {
  const flags = [p.overflowX ? "OVERFLOW" : "", p.blank ? "BLANK" : "", p.errors.length ? "ERR" : ""]
    .filter(Boolean)
    .join(",");
  console.log(`${p.viewport.padEnd(5)} ${p.route.padEnd(11)} ${String(p.domMs).padStart(5)}ms ${flags || "ok"}`);
  if (p.errors.length) for (const e of p.errors.slice(0, 2)) console.log(`        ${e}`);
}

const bad = report.pages.filter((p) => p.overflowX || p.blank || p.errors.length);
console.log(`\n${report.pages.length - bad.length}/${report.pages.length} clean`);
process.exit(bad.length ? 1 : 0);

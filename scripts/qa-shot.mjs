/**
 * 视觉验收脚本：按三种典型宽度截图，并收集控制台错误与失败请求。
 *
 * 用法：
 *   node scripts/qa-shot.mjs --url=http://127.0.0.1:5173 --out=.qa --tag=home
 *
 * 产出：
 *   .qa/<tag>-1440.png / -768.png / -375.png
 *   .qa/<tag>-report.json   （console errors / page errors / failed requests / 首屏耗时）
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

const url = args.url ?? "http://127.0.0.1:5173";
const out = args.out ?? ".qa";
const tag = args.tag ?? "home";
const waitMs = Number(args.wait ?? 1200);

const viewports = [
  { name: "1440", width: 1440, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
];

await mkdir(out, { recursive: true });

const browser = await chromium.launch();
const report = { url, tag, at: new Date().toISOString(), pages: [] };

for (const vp of viewports) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 500));
  });
  page.on("pageerror", (err) => pageErrors.push(String(err).slice(0, 500)));
  page.on("requestfailed", (req) => {
    const f = req.failure()?.errorText ?? "";
    // 离线/后端未启动时的预期失败，单独归类，不算致命
    failedRequests.push({ url: req.url().slice(0, 200), error: f });
  });

  const started = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  const domMs = Date.now() - started;
  await page.waitForTimeout(waitMs);

  const file = path.join(out, `${tag}-${vp.name}.png`);
  await page.screenshot({ path: file, fullPage: false });

  const metrics = await page
    .evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      return {
        title: document.title,
        bodyText: (document.body?.innerText ?? "").slice(0, 200),
        dcl: nav?.domContentLoadedEventEnd ?? null,
        load: nav?.loadEventEnd ?? null,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })
    .catch(() => ({}));

  report.pages.push({
    viewport: vp.name,
    screenshot: file,
    domReadyMs: domMs,
    metrics,
    overflowX: (metrics.scrollWidth ?? 0) > (metrics.clientWidth ?? 0) + 1,
    consoleErrors,
    pageErrors,
    failedRequests: failedRequests.filter((r) => !/ERR_CONNECTION_REFUSED|Failed to fetch/i.test(r.error)),
  });

  await context.close();
}

await browser.close();
await writeFile(path.join(out, `${tag}-report.json`), JSON.stringify(report, null, 2), "utf8");

const problems = report.pages.flatMap((p) => [
  ...p.pageErrors.map((e) => `[${p.viewport}] pageerror: ${e}`),
  ...p.consoleErrors.map((e) => `[${p.viewport}] console: ${e}`),
  ...(p.overflowX ? [`[${p.viewport}] 横向溢出`] : []),
]);
console.log(`saved ${report.pages.length} screenshots to ${out}/`);
console.log(problems.length ? `problems:\n - ${problems.join("\n - ")}` : "no console/page errors");

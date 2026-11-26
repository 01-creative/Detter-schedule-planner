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
const password = args.password ?? "";
const setupToken = args.token ?? "";
const path0 = args.path ?? "/";

const viewports = [
  { name: "1440", width: 1440, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
];

await mkdir(out, { recursive: true });

const browser = await chromium.launch();
const report = { url, tag, at: new Date().toISOString(), pages: [] };

/**
 * 需要看登录后的页面时传 --password（首次用 --token 初始化）。
 * 单独一个 context 做登录，再把 storageState 复用到三个视口，避免重复登录。
 */
let storageState;
if (password) {
  const authCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "zh-CN" });
  const authPage = await authCtx.newPage();
  await authPage.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  await authPage.waitForTimeout(600);

  if (authPage.url().includes("/setup")) {
    if (!setupToken) throw new Error("站点尚未初始化：请传 --token=<setupToken>");
    const inputs = authPage.locator("input");
    await inputs.nth(0).fill(setupToken);
    await inputs.nth(1).fill(password);
    const third = inputs.nth(2);
    if ((await third.count()) > 0) await third.fill(password);
    await authPage.getByRole("button").filter({ hasText: /创建|初始化|设置|开始/ }).first().click();
    await authPage.waitForTimeout(1500);
  } else if (authPage.url().includes("/login")) {
    await authPage.locator("input[type=password]").first().fill(password);
    await authPage.getByRole("button").filter({ hasText: /登录|进入|继续/ }).first().click();
    await authPage.waitForTimeout(1500);
  }

  storageState = await authCtx.storageState();
  await authCtx.close();
}

for (const vp of viewports) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    ...(storageState ? { storageState } : {}),
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
  await page.goto(url.replace(/\/$/, "") + path0, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
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

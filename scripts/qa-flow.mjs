/**
 * 交互验收：走一遍「初始化 → 四象限 → 快速捕获 → 收件箱」，每步截图。
 *
 * 用法：
 *   node scripts/qa-flow.mjs --url=http://127.0.0.1:5180 --token=<setupToken> --out=.qa
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

const base = args.url ?? "http://127.0.0.1:5180";
const token = args.token ?? "qa-setup-token";
const out = args.out ?? ".qa";
const password = args.password ?? "qa-password-123456";

await mkdir(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`);
});

const steps = [];

async function shot(name) {
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file });
  steps.push({ name, url: page.url(), file });
  return file;
}

/* 1) 初始化 */
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await shot("01-entry");

const onSetup = page.url().includes("/setup");
if (onSetup) {
  const inputs = page.locator("input");
  await inputs.nth(0).fill(token);
  await inputs.nth(1).fill(password);
  const third = inputs.nth(2);
  if ((await third.count()) > 0) await third.fill(password);
  await page.getByRole("button").filter({ hasText: /创建|初始化|设置|开始/ }).first().click();
  await page.waitForTimeout(1500);
  await shot("02-after-setup");
}

/* 1b) 已初始化过则直接登录 */
if (page.url().includes("/login")) {
  await page.locator("input[type=password]").first().fill(password);
  await page.getByRole("button").filter({ hasText: /登录|进入|继续/ }).first().click();
  await page.waitForTimeout(1500);
  await shot("02-after-login");
}

/* 2) 首页 */
await page.goto(base + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await shot("03-home");

/* 3) 快速捕获 */
await page.keyboard.press("Control+K");
await page.waitForTimeout(400);
await shot("04-capture-open");
const editor = page.getByRole("textbox").first();
await editor.click();
await editor.fill("明天下午3点 交高数作业 #作业 在教三 40分钟");
await page.waitForTimeout(700);
await shot("05-capture-parsed");
await page.keyboard.press("Enter");
await page.waitForTimeout(900);
await shot("06-capture-saved");
await page.keyboard.press("Escape");

/* 4) 收件箱 */
await page.goto(base + "/inbox", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await shot("07-inbox");

/* 5) 移动端 */
const mobile = await browser.newContext({
  viewport: { width: 375, height: 812 },
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai",
  storageState: await ctx.storageState(),
});
const mp = await mobile.newPage();
await mp.goto(base + "/", { waitUntil: "networkidle" });
await mp.waitForTimeout(900);
await mp.screenshot({ path: path.join(out, "08-mobile-home.png") });
await mp.keyboard.press("Control+K").catch(() => {});
await mp.waitForTimeout(300);
await mp.screenshot({ path: path.join(out, "09-mobile-capture.png") });
await mobile.close();

const report = { base, onSetup, steps, errors };
await writeFile(path.join(out, "flow-report.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify({ onSetup, steps: steps.map((s) => s.name), errors }, null, 2));

await ctx.close();
await browser.close();

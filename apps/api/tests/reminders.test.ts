import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { runMigrations } from "../src/db/migrate";
import { createNodeDb } from "../src/db/node";
import { createConfig, type AppConfig } from "../src/env";
import {
  computeFireTimes,
  formatInTimezone,
  runReminderTick,
  type ReminderTask,
} from "../src/services/reminders/schedule";
import { base64UrlDecode, base64UrlEncode, utf8 } from "../src/services/reminders/webpush/encoding";
import { encryptPushPayload } from "../src/services/reminders/webpush/encrypt";
import {
  exportRawPublicKey,
  generateEcdhKeyPair,
  importEcdhPrivateKeyJwk,
} from "../src/services/reminders/webpush/webcrypto";
import { createVapidAuthorization, parseVapidCredentials } from "../src/services/reminders/webpush/vapid";
import type { VapidCredentials } from "../src/services/reminders/types";
import {
  MIGRATIONS_DIR,
  TEST_SETUP_TOKEN,
  call,
  createTestServer,
  setupUser,
  type TestServer,
} from "./helpers";

/**
 * T14 提醒与推送的验收测试。
 *
 * 覆盖四类：
 * 1. 时间点计算（startAt ?? dueAt、offset、去重、7 天窗口）；
 * 2. 调度与幂等（重复 tick 只有一行；改时间会取消旧提醒；完成的立即取消）；
 * 3. 渠道（inapp 到点发送；微信失败 2 次降级；永久失败立即降级；410 清订阅）；
 * 4. Web Push 的密码学正确性（RFC 8291 测试向量 + VAPID JWT 签名可验证）。
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const BASE = Date.UTC(2026, 10, 26, 2, 0, 0); // 2026-11-26 10:00 Asia/Shanghai

interface TaskPayload extends Record<string, unknown> {
  id: string;
  rev: number;
  remindedAt: number[];
}

let clock = BASE;
let server: TestServer;
let cookie = "";

async function boot(): Promise<void> {
  clock = BASE;
  server = await createTestServer({ now: () => clock });
  cookie = await setupUser(server);
}

async function createTask(body: Record<string, unknown>): Promise<TaskPayload> {
  const created = await call<TaskPayload>(server, "POST", "/api/v1/tasks", { cookie, body });
  expect(created.status).toBe(201);
  return created.body.data as TaskPayload;
}

async function putConfig(body: Record<string, unknown>): Promise<void> {
  const response = await call(server, "PUT", "/api/v1/reminders/config", { cookie, body });
  expect(response.status).toBe(200);
}

interface ReminderRecord {
  id: string;
  task_id: string;
  fire_at: number;
  channel: string;
  status: string;
  attempts: number;
  sent_at: number | null;
  error: string | null;
}

async function remindersFor(taskId: string): Promise<ReminderRecord[]> {
  return server.db.all<ReminderRecord>(
    "SELECT id, task_id, fire_at, channel, status, attempts, sent_at, error FROM reminders WHERE task_id = ? ORDER BY fire_at ASC, channel ASC",
    [taskId],
  );
}

async function notifications(): Promise<Array<{ id: string; title: string; body: string; reminder_id: string }>> {
  return server.db.all("SELECT id, title, body, reminder_id FROM notifications ORDER BY created_at ASC");
}

function fakeFetch(
  handler: (url: string, init: RequestInit | undefined) => Response,
  calls: string[] = [],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return handler(url, init);
  }) as unknown as typeof fetch;
}

/**
 * 测试自己的 WebCrypto 薄封装：和 production 的 webcrypto.ts 同样的原因
 * （workers-types 与 @types/node 的 ECDSA 重载不一致），只在这里生成 VAPID 测试密钥。
 */
interface TestSubtle {
  generateKey(algorithm: object, extractable: boolean, keyUsages: string[]): Promise<CryptoKeyPair>;
  exportKey(format: string, key: CryptoKey): Promise<ArrayBuffer | JsonWebKey>;
  importKey(
    format: string,
    data: unknown,
    algorithm: object,
    extractable: boolean,
    usages: string[],
  ): Promise<CryptoKey>;
  verify(algorithm: object, key: CryptoKey, signature: Uint8Array, data: Uint8Array): Promise<boolean>;
}

const testSubtle = crypto.subtle as unknown as TestSubtle;

async function generateSubscriptionKeys(): Promise<{ p256dh: string; auth: string }> {
  const pair = await generateEcdhKeyPair();
  const raw = await exportRawPublicKey(pair.publicKey);
  return { p256dh: base64UrlEncode(raw), auth: base64UrlEncode(crypto.getRandomValues(new Uint8Array(16))) };
}

async function generateVapid(): Promise<VapidCredentials> {
  const pair = await testSubtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const raw = new Uint8Array((await testSubtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const jwk = (await testSubtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  return {
    publicKey: base64UrlEncode(raw),
    privateKey: String(jwk.d),
    subject: "mailto:test@example.com",
  };
}

/** 带 VAPID/push 注入的本地测试服务（helpers.createTestServer 不暴露 push 参数）。 */
async function bootWithPush(vapid: VapidCredentials, fetchImpl: typeof fetch): Promise<void> {
  clock = BASE;
  const db = createNodeDb(":memory:");
  await runMigrations(db, MIGRATIONS_DIR);
  const config: AppConfig = createConfig({
    setupToken: TEST_SETUP_TOKEN,
    secureCookies: false,
  });
  const app = createApp({
    db,
    config,
    runtime: "node",
    now: () => clock,
    push: { vapid, fetch: fetchImpl },
  });
  server = { app, db, config, close: () => undefined };
  cookie = await setupUser(server);
}

beforeEach(async () => {
  await boot();
});

describe("提醒时间点计算", () => {
  const task = (patch: Partial<ReminderTask>): ReminderTask => ({
    id: "t1",
    status: "todo",
    startAt: null,
    dueAt: null,
    remindOffsets: [0],
    title: "任务",
    quadrant: 2,
    notes: "",
    location: "",
    kind: "task",
    ...patch,
  });

  it("优先用 startAt；offset 去重并升序；过去的时间点与 8 天后的都不取", () => {
    const base = BASE + 60 * MINUTE;
    const fireTimes = computeFireTimes(
      task({ startAt: base, dueAt: base + 5 * HOUR, remindOffsets: [10, 5, 5, 0, 70] }),
      BASE,
    );
    // 70 分钟前的时间点已经过去（< now），必须被丢掉
    expect(fireTimes).toEqual([base - 10 * MINUTE, base - 5 * MINUTE, base]);

    expect(computeFireTimes(task({ startAt: BASE + 8 * DAY }), BASE)).toEqual([]);
    expect(computeFireTimes(task({ startAt: null, dueAt: BASE + HOUR }), BASE)).toEqual([BASE + HOUR]);
    expect(computeFireTimes(task({ remindOffsets: [5] }), BASE)).toEqual([]);
  });

  it("等于 now 的提醒点要保留（「现在就到期」的任务必须能提醒）", () => {
    expect(computeFireTimes(task({ startAt: BASE, remindOffsets: [0] }), BASE)).toEqual([BASE]);
  });

  it("按用户时区格式化时间，而不是服务器本地时区", () => {
    expect(formatInTimezone(BASE, "Asia/Shanghai")).toContain("11-26");
    expect(formatInTimezone(BASE, "Asia/Shanghai")).toContain("10:00");
    expect(formatInTimezone(BASE, "UTC")).toContain("02:00");
  });
});

describe("提醒调度：物化、幂等、取消", () => {
  it("未完成任务生成 pending 行；完成/删除/无时间的任务不生成", async () => {
    const active = await createTask({ title: "开会", startAt: BASE + 30 * MINUTE, remindOffsets: [10] });
    const done = await createTask({ title: "已完成", startAt: BASE + 30 * MINUTE, status: "done" });
    const noTime = await createTask({ title: "没时间", remindOffsets: [5] });
    const removed = await createTask({ title: "要删的", startAt: BASE + 30 * MINUTE });
    await call(server, "DELETE", `/api/v1/tasks/${removed.id}`, { cookie });

    const summary = await runReminderTick(server.db, BASE);
    expect(summary.materialized).toBe(1);

    const rows = await remindersFor(active.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: "inapp", status: "pending", attempts: 0 });
    expect(rows[0]?.fire_at).toBe(BASE + 20 * MINUTE);

    expect(await remindersFor(done.id)).toHaveLength(0);
    expect(await remindersFor(noTime.id)).toHaveLength(0);
    expect(await remindersFor(removed.id)).toHaveLength(0);
  });

  it("重复 tick 不会产生重复行（幂等靠 (task_id, fire_at, channel) 唯一键）", async () => {
    const task = await createTask({ title: "写周报", startAt: BASE + HOUR, remindOffsets: [5, 0] });
    await runReminderTick(server.db, BASE);
    await runReminderTick(server.db, BASE + MINUTE);
    await runReminderTick(server.db, BASE + 2 * MINUTE);

    const rows = await remindersFor(task.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.fire_at)).toEqual([BASE + 55 * MINUTE, BASE + HOUR]);
  });

  it("改时间后取消旧提醒、生成新提醒", async () => {
    const task = await createTask({ title: "改期", startAt: BASE + HOUR, remindOffsets: [0] });
    await runReminderTick(server.db, BASE);
    expect(await remindersFor(task.id)).toHaveLength(1);

    await call(server, "PATCH", `/api/v1/tasks/${task.id}`, { cookie, body: { startAt: BASE + 3 * HOUR } });
    await runReminderTick(server.db, BASE + MINUTE);

    const rows = await remindersFor(task.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.fire_at === BASE + HOUR)?.status).toBe("cancelled");
    expect(rows.find((row) => row.fire_at === BASE + 3 * HOUR)?.status).toBe("pending");
  });

  it("任务完成后，未发出的提醒被取消", async () => {
    const task = await createTask({ title: "会被完成", startAt: BASE + HOUR, remindOffsets: [0] });
    await runReminderTick(server.db, BASE);
    expect((await remindersFor(task.id))[0]?.status).toBe("pending");

    await call(server, "PATCH", `/api/v1/tasks/${task.id}`, {
      cookie,
      body: { status: "done", completedAt: BASE },
    });
    await runReminderTick(server.db, BASE + MINUTE);
    expect((await remindersFor(task.id))[0]?.status).toBe("cancelled");
  });
});

describe("inapp 渠道：到点发送与幂等", () => {
  it("到点后 status=sent、写一条 notification、task.remindedAt 更新", async () => {
    const task = await createTask({ title: "喝水", startAt: BASE + MINUTE, remindOffsets: [0] });

    await runReminderTick(server.db, BASE);
    expect((await remindersFor(task.id))[0]?.status).toBe("pending");
    expect(await notifications()).toHaveLength(0);

    const summary = await runReminderTick(server.db, BASE + MINUTE);
    expect(summary.sent).toBe(1);

    const rows = await remindersFor(task.id);
    expect(rows[0]).toMatchObject({ status: "sent", attempts: 1 });
    expect(rows[0]?.sent_at).toBe(BASE + MINUTE);

    const notes = await notifications();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.title).toContain("喝水");
    expect(notes[0]?.reminder_id).toBe(rows[0]?.id);

    // 再 tick 一次不应该重复发
    await runReminderTick(server.db, BASE + 2 * MINUTE);
    expect(await notifications()).toHaveLength(1);

    const refreshed = await call<TaskPayload>(server, "GET", `/api/v1/tasks/${task.id}`, { cookie });
    expect(refreshed.body.data?.remindedAt).toEqual([BASE + MINUTE]);
    expect(refreshed.body.data?.rev).toBeGreaterThan(task.rev);
  });

  it("不到点不发送", async () => {
    const task = await createTask({ title: "还早", startAt: BASE + HOUR, remindOffsets: [10] });
    await runReminderTick(server.db, BASE);
    const summary = await runReminderTick(server.db, BASE + 20 * MINUTE);
    expect(summary.sent).toBe(0);
    expect(await notifications()).toHaveLength(0);
    expect((await remindersFor(task.id))[0]?.status).toBe("pending");
  });

  it("迟到超过 24 小时的提醒标记 expired，不制造噪音", async () => {
    const task = await createTask({ title: "错过了", startAt: BASE + DAY, remindOffsets: [0] });
    await runReminderTick(server.db, BASE);

    const summary = await runReminderTick(server.db, BASE + DAY + 25 * HOUR);
    expect(summary.expired).toBe(1);
    expect((await remindersFor(task.id))[0]?.status).toBe("expired");
    expect(await notifications()).toHaveLength(0);
  });
});

describe("渠道降级", () => {
  it("微信临时失败 2 次后降级到 inapp；降级行同 tick 内完成投递", async () => {
    await putConfig({ channels: ["wechat", "inapp"], wechatToken: "tok_test_1234567890" });
    const task = await createTask({ title: "微信不通", startAt: BASE + MINUTE, remindOffsets: [0] });

    const calls: string[] = [];
    const failing = fakeFetch(() => new Response("boom", { status: 500 }), calls);

    await runReminderTick(server.db, BASE);
    // 第 1 次失败：保留 pending，等下个 tick 重试
    await runReminderTick(server.db, BASE + MINUTE, { fetch: failing });

    let rows = await remindersFor(task.id);
    const wechat = rows.find((row) => row.channel === "wechat");
    expect(wechat).toMatchObject({ status: "pending", attempts: 1 });
    expect(wechat?.error).toContain("HTTP 500");
    expect(calls).toHaveLength(1);

    // 第 2 次失败：标 failed 并降级；inapp 在同一 tick 的下一轮被处理
    const summary = await runReminderTick(server.db, BASE + MINUTE, { fetch: failing });
    expect(summary.failed).toBe(1);
    expect(summary.downgraded).toBe(1);
    expect(summary.sent).toBe(1);

    rows = await remindersFor(task.id);
    expect(rows.find((row) => row.channel === "wechat")).toMatchObject({ status: "failed", attempts: 2 });
    expect(rows.find((row) => row.channel === "inapp")).toMatchObject({ status: "sent" });
    expect(await notifications()).toHaveLength(1);
  });

  it("永久失败（未配置 token）立即降级，不浪费两次重试", async () => {
    await putConfig({ channels: ["wechat", "inapp"], clearWechatToken: true });
    const task = await createTask({ title: "没 token", startAt: BASE + MINUTE, remindOffsets: [0] });

    await runReminderTick(server.db, BASE);
    const summary = await runReminderTick(server.db, BASE + MINUTE);

    expect(summary.failed).toBe(1);
    expect(summary.downgraded).toBe(1);
    const rows = await remindersFor(task.id);
    expect(rows.find((row) => row.channel === "wechat")?.status).toBe("failed");
    expect(rows.find((row) => row.channel === "wechat")?.error).toContain("未配置");
    expect(rows.find((row) => row.channel === "inapp")?.status).toBe("sent");
  });

  it("微信成功时不降级：服务返回 code=200 即视为送达", async () => {
    await putConfig({ channels: ["wechat", "inapp"], wechatToken: "tok_test_1234567890" });
    const task = await createTask({ title: "微信可达", startAt: BASE + MINUTE, remindOffsets: [0] });

    const seen: Array<{ url: string; body: string }> = [];
    const ok = fakeFetch((url, init) => {
      seen.push({ url, body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ code: 200, msg: "ok" }), { status: 200 });
    });

    await runReminderTick(server.db, BASE);
    const summary = await runReminderTick(server.db, BASE + MINUTE, { fetch: ok });

    expect(summary.sent).toBe(1);
    expect(seen[0]?.url).toBe("https://www.pushplus.plus/send");
    expect(seen[0]?.body).toContain("tok_test_1234567890");
    const rows = await remindersFor(task.id);
    expect(rows.find((row) => row.channel === "wechat")?.status).toBe("sent");
    expect(rows.some((row) => row.channel === "inapp")).toBe(false);
  });
});

describe("Web Push 订阅清理", () => {
  it("410 表示订阅失效：清 devices.push_subscription，并继续降级", async () => {
    const vapid = await generateVapid();
    const failingPush = fakeFetch(() => new Response("gone", { status: 410 }));
    await bootWithPush(vapid, failingPush);

    await putConfig({ channels: ["webpush", "inapp"] });
    const keys = await generateSubscriptionKeys();
    const device = await server.db.first<{ id: string }>("SELECT id FROM devices LIMIT 1");
    expect(device?.id).toBeTruthy();

    const subscribed = await call(server, "POST", "/api/v1/push/subscribe", {
      cookie,
      body: { endpoint: "https://fcm.googleapis.com/fcm/send/fake-endpoint", keys },
    });
    expect(subscribed.status).toBe(200);

    const task = await createTask({ title: "推送失效", startAt: BASE + MINUTE, remindOffsets: [0] });
    await runReminderTick(server.db, BASE, { vapid });
    const summary = await runReminderTick(server.db, BASE + MINUTE, {
      vapid,
      fetch: failingPush,
    });

    expect(summary.failed).toBe(1);
    expect(summary.downgraded).toBe(1);

    const after = await server.db.first<{ push_enabled: number; push_subscription: string | null }>(
      "SELECT push_enabled, push_subscription FROM devices WHERE id = ?",
      [device?.id],
    );
    expect(after?.push_enabled).toBe(0);
    expect(after?.push_subscription).toBeNull();

    const rows = await remindersFor(task.id);
    expect(rows.find((row) => row.channel === "webpush")?.status).toBe("failed");
    expect(rows.find((row) => row.channel === "inapp")?.status).toBe("sent");
  });

  it("订阅 endpoint 必须在白名单内，否则 400（防 SSRF）", async () => {
    const keys = await generateSubscriptionKeys();
    const rejected = await call(server, "POST", "/api/v1/push/subscribe", {
      cookie,
      body: { endpoint: "https://127.0.0.1:8080/push", keys },
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error?.code).toBe("validation_error");

    const accepted = await call(server, "POST", "/api/v1/push/subscribe", {
      cookie,
      body: { endpoint: "https://updates.push.services.mozilla.com/wpush/v2/abc", keys },
    });
    expect(accepted.status).toBe(200);
  });

  it("没配 VAPID 时 /push/public-key 返回 enabled=false", async () => {
    const response = await call<{ enabled: boolean; publicKey: string | null }>(
      server,
      "GET",
      "/api/v1/push/public-key",
      { cookie },
    );
    expect(response.status).toBe(200);
    expect(response.body.data?.enabled).toBe(false);
    expect(response.body.data?.publicKey).toBeNull();
  });
});

describe("配置与通知箱", () => {
  it("微信 token 不回显：/settings 返回掩码，/reminders/config 只给布尔", async () => {
    await putConfig({ channels: ["wechat", "inapp"], wechatToken: "tok_secret_987654321" });

    const settings = await call<Record<string, unknown>>(server, "GET", "/api/v1/settings", { cookie });
    expect(settings.body.data?.["wechat.token"]).toBe("••••••••");

    const config = await call<Record<string, unknown>>(server, "GET", "/api/v1/reminders/config", {
      cookie,
    });
    expect(config.body.data?.wechatConfigured).toBe(true);
    expect(config.body.data).not.toHaveProperty("wechatToken");
    expect(JSON.stringify(config.body)).not.toContain("tok_secret_987654321");
  });

  it("通知箱：未读计数、全部已读", async () => {
    await createTask({ title: "会提醒我", startAt: BASE + MINUTE, remindOffsets: [0] });
    await runReminderTick(server.db, BASE);
    await runReminderTick(server.db, BASE + MINUTE);

    const list = await call<{ items: Array<{ id: string; readAt: number | null }>; unreadCount: number }>(
      server,
      "GET",
      "/api/v1/reminders/notifications",
      { cookie },
    );
    expect(list.status).toBe(200);
    expect(list.body.data?.items).toHaveLength(1);
    expect(list.body.data?.unreadCount).toBe(1);

    const read = await call<{ updated: number }>(server, "POST", "/api/v1/reminders/notifications/read", {
      cookie,
      body: { all: true },
    });
    expect(read.body.data?.updated).toBe(1);

    const after = await call<{ unreadCount: number }>(server, "GET", "/api/v1/reminders/notifications", {
      cookie,
    });
    expect(after.body.data?.unreadCount).toBe(0);
  });

  it("手动 tick 端点需要 admin scope", async () => {
    const created = await call<{ plaintext: string }>(server, "POST", "/api/v1/api-keys", {
      cookie,
      body: { name: "只读", scopes: ["read"] },
    });
    const readKey = created.body.data?.plaintext as string;

    const denied = await call(server, "POST", "/api/v1/reminders/tick", {
      headers: { authorization: `Bearer ${readKey}` },
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error?.code).toBe("scope_insufficient");

    const allowed = await call<{ users: number }>(server, "POST", "/api/v1/reminders/tick", { cookie });
    expect(allowed.status).toBe(200);
    expect(allowed.body.data?.users).toBe(1);
  });

  it("设置页默认提前量保存后可以读回", async () => {
    await putConfig({ defaultOffsetMin: 15, enabled: false });
    const config = await call<{ defaultOffsetMin: number; enabled: boolean }>(
      server,
      "GET",
      "/api/v1/reminders/config",
      { cookie },
    );
    expect(config.body.data?.defaultOffsetMin).toBe(15);
    expect(config.body.data?.enabled).toBe(false);
  });

  it("微信 token 不进入同步面：snapshot / pull 都拿不到，单条读取也只有掩码", async () => {
    await putConfig({ channels: ["wechat", "inapp"], wechatToken: "tok_sync_secret_123456" });

    const snapshot = await call<{ entities: Record<string, Array<Record<string, unknown>>> }>(
      server,
      "GET",
      "/api/v1/sync/snapshot",
      { cookie },
    );
    const settings = snapshot.body.data?.entities.settings ?? [];
    expect(settings.some((item) => item.key === "wechat.token")).toBe(false);

    const pulled = await call(server, "GET", "/api/v1/sync/pull?cursor=0&limit=200", { cookie });
    expect(JSON.stringify(pulled.body)).not.toContain("tok_sync_secret_123456");

    const row = await server.db.first<{ id: string }>(
      "SELECT id FROM settings WHERE key = 'wechat.token' AND deleted_at IS NULL",
    );
    expect(row?.id).toBeTruthy();
    const single = await call<{ key: string; value: unknown }>(
      server,
      "GET",
      `/api/v1/settings/${row?.id}`,
      { cookie },
    );
    expect(single.status).toBe(200);
    expect(single.body.data?.value).toBe("••••••••");

    // 服务端仍然知道自己已配置
    const config = await call<{ wechatConfigured: boolean }>(
      server,
      "GET",
      "/api/v1/reminders/config",
      { cookie },
    );
    expect(config.body.data?.wechatConfigured).toBe(true);
  });
});

describe("日历订阅（ICS 兜底）", () => {
  it("生成订阅链接后用 token 免登录拿到日历；错误 token 401；重置后立即失效", async () => {
    await createTask({ title: "写周报", startAt: BASE + HOUR });

    const created = await call<{ configured: boolean; path: string | null }>(
      server,
      "POST",
      "/api/v1/reminders/calendar-link",
      { cookie },
    );
    expect(created.status).toBe(200);
    expect(created.body.data?.configured).toBe(true);
    const path = created.body.data?.path as string;
    expect(path).toContain("/api/v1/calendar/ics?token=");

    const feed = await server.app.request(path);
    expect(feed.status).toBe(200);
    expect(feed.headers.get("content-type")).toContain("text/calendar");
    const text = await feed.text();
    expect(text).toContain("BEGIN:VCALENDAR");
    expect(text).toContain("SUMMARY:写周报");

    const wrong = await server.app.request("/api/v1/calendar/ics?token=" + "A".repeat(43));
    expect(wrong.status).toBe(401);

    const revoked = await call(server, "DELETE", "/api/v1/reminders/calendar-link", { cookie });
    expect(revoked.status).toBe(200);
    const after = await server.app.request(path);
    expect(after.status).toBe(401);
  });
});

describe("Web Push 加密正确性", () => {
  it("RFC 8291 Appendix A 测试向量：密文逐字节一致", async () => {
    const uaPublic = base64UrlDecode(
      "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    );
    const asPublic = base64UrlDecode(
      "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
    );
    const asPrivate = base64UrlDecode("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw");
    const salt = base64UrlDecode("DGv6ra1nlYgDCS1FRnbzlw");
    const auth = base64UrlDecode("BTBZMqHH6r4Tts7J_aSIgg");

    const privateKey = await importEcdhPrivateKeyJwk({
      kty: "EC",
      crv: "P-256",
      d: base64UrlEncode(asPrivate),
      x: base64UrlEncode(asPublic.subarray(1, 33)),
      y: base64UrlEncode(asPublic.subarray(33, 65)),
      ext: true,
    });

    const encrypted = await encryptPushPayload(
      {
        endpoint: "https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV",
        keys: { p256dh: base64UrlEncode(uaPublic), auth: base64UrlEncode(auth) },
      },
      "When I grow up, I want to be a watermelon",
      { salt, ephemeral: { privateKey, publicKey: asPublic } },
    );

    // RFC 8291 §5 的完整消息体（header + ciphertext）
    const expected =
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
      "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
      "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";
    expect(base64UrlEncode(encrypted.body)).toBe(expected);
  });

  it("VAPID JWT：ES256 签名可以用公钥验证，aud/exp/sub 正确", async () => {
    const vapid = await generateVapid();
    const keys = parseVapidCredentials(vapid);
    expect(keys).not.toBeNull();

    const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
    const authorization = await createVapidAuthorization(keys!, endpoint, BASE);
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(authorization);
    expect(match).not.toBeNull();

    const [header, claims, signature] = match![1]!.split(".");
    expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(header!)))).toMatchObject({
      alg: "ES256",
      typ: "JWT",
    });
    const parsedClaims = JSON.parse(new TextDecoder().decode(base64UrlDecode(claims!))) as Record<string, unknown>;
    expect(parsedClaims.aud).toBe("https://fcm.googleapis.com");
    expect(parsedClaims.sub).toBe("mailto:test@example.com");
    expect(Number(parsedClaims.exp)).toBeGreaterThan(Math.floor(BASE / 1000));

    // 用公钥验签，确认签名不是随便拼的字节
    const publicKey = await testSubtle.importKey(
      "raw",
      base64UrlDecode(vapid.publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const valid = await testSubtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      base64UrlDecode(signature!),
      utf8(`${header}.${claims}`),
    );
    expect(valid).toBe(true);
    expect(match![2]).toBe(vapid.publicKey);
  });
});

import { describe, expect, it } from "vitest";
import { call, createTestServer, login, setupUser, TEST_PASSWORD, TEST_SETUP_TOKEN } from "./helpers";

/**
 * 验收场景 1-4、10：
 * setup 只能一次 / 登录失败与限流 / 无 Cookie 401 / 缺 CSRF 403 / API Key scope。
 */
describe("鉴权", () => {
  it("setup 只能成功一次（第二次 409 already_initialized）", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);
    expect(cookie).toMatch(/^detter_session=/);

    const again = await call(server, "POST", "/api/v1/auth/setup", {
      body: { setupToken: TEST_SETUP_TOKEN, password: TEST_PASSWORD, deviceName: "重复设备" },
    });
    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe("already_initialized");
  });

  it("setup 口令错误返回 403，口令策略拒绝纯数字", async () => {
    const server = await createTestServer();

    const wrongToken = await call(server, "POST", "/api/v1/auth/setup", {
      body: { setupToken: "wrong-token-xxxx", password: TEST_PASSWORD, deviceName: "d1" },
    });
    expect(wrongToken.status).toBe(403);
    expect(wrongToken.body.error?.code).toBe("forbidden");

    const weak = await call(server, "POST", "/api/v1/auth/setup", {
      body: { setupToken: TEST_SETUP_TOKEN, password: "1234567890123", deviceName: "d1" },
    });
    expect(weak.status).toBe(400);
    expect(weak.body.error?.code).toBe("validation_error");
  });

  it("密码错误返回 401；同 IP 失败 10 次后返回 429", async () => {
    const server = await createTestServer();
    await setupUser(server);

    for (let attempt = 1; attempt <= 10; attempt++) {
      const failed = await login(server, { password: "definitely-wrong-password" });
      expect(failed.status, `第 ${attempt} 次登录应返回 401`).toBe(401);
      expect(failed.body.error?.code).toBe("unauthorized");
    }

    const blocked = await login(server, { password: TEST_PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error?.code).toBe("rate_limited");
  });

  it("无 Cookie 访问 /api/v1/tasks 返回 401", async () => {
    const server = await createTestServer();
    await setupUser(server);

    const result = await call(server, "GET", "/api/v1/tasks");
    expect(result.status).toBe(401);
    expect(result.body.error?.code).toBe("unauthorized");
  });

  it("Cookie 会话的 POST 缺 x-detter-csrf 返回 403", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    const missing = await call(server, "POST", "/api/v1/tasks", {
      cookie,
      csrf: false,
      body: { title: "没有 CSRF 头" },
    });
    expect(missing.status).toBe(403);
    expect(missing.body.error?.code).toBe("csrf_failed");

    // 补上请求头就能写成功
    const good = await call(server, "POST", "/api/v1/tasks", { cookie, body: { title: "带 CSRF 头" } });
    expect(good.status).toBe(201);
  });

  it("Origin 不在允许列表时也拒绝写入", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    const result = await call(server, "POST", "/api/v1/tasks", {
      cookie,
      origin: "https://evil.example.com",
      body: { title: "跨站请求" },
    });
    expect(result.status).toBe(403);
    expect(result.body.error?.code).toBe("csrf_failed");

    const allowed = await call(server, "POST", "/api/v1/tasks", {
      cookie,
      origin: server.config.appOrigin,
      body: { title: "同源请求" },
    });
    expect(allowed.status).toBe(201);
  });

  it("退出登录后 Cookie 立即失效", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    const before = await call(server, "GET", "/api/v1/tasks", { cookie });
    expect(before.status).toBe(200);

    const logout = await call(server, "POST", "/api/v1/auth/logout", { cookie });
    expect(logout.status).toBe(200);

    const after = await call(server, "GET", "/api/v1/tasks", { cookie });
    expect(after.status).toBe(401);
  });

  it("status 未登录返回 200/authenticated=false，登录后返回设备与会话信息", async () => {
    const server = await createTestServer();

    const anonymous = await call(server, "GET", "/api/v1/auth/status");
    expect(anonymous.status).toBe(200);
    expect(anonymous.body.data).toMatchObject({ initialized: false, authenticated: false, deviceId: null });

    const cookie = await setupUser(server, { deviceName: "工作站" });
    const authed = await call(server, "GET", "/api/v1/auth/status", { cookie });
    expect(authed.body.data).toMatchObject({ initialized: true, authenticated: true });
    expect((authed.body.data as { scopes: string[] }).scopes).toEqual(["read", "write", "admin"]);
  });

  it("me 返回用户资料与设备数", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server, { deviceName: "工作站" });
    const second = await login(server, { deviceName: "手机" });
    expect(second.status).toBe(200);

    const me = await call(server, "GET", "/api/v1/auth/me", { cookie });
    expect(me.status).toBe(200);
    const data = me.body.data as { user: { id: string; displayName: string; timezone: string }; devices: number };
    expect(data.user.displayName).toBeTruthy();
    expect(data.user.timezone).toBe("Asia/Shanghai");
    expect(data.devices).toBe(2);
  });

  it("修改密码后旧 Cookie 失效、新 Cookie 可用", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    const changed = await call(server, "PATCH", "/api/v1/auth/password", {
      cookie,
      body: { currentPassword: TEST_PASSWORD, newPassword: "another-strong-passphrase" },
    });
    expect(changed.status).toBe(200);
    expect(changed.cookie).toBeTruthy();

    const oldCookie = await call(server, "GET", "/api/v1/tasks", { cookie });
    expect(oldCookie.status).toBe(401);

    const newCookie = await call(server, "GET", "/api/v1/tasks", { cookie: changed.cookie as string });
    expect(newCookie.status).toBe(200);

    const reLogin = await login(server, { password: "another-strong-passphrase" });
    expect(reLogin.status).toBe(200);
  });

  it("API Key：只有 read scope 时不能 POST；吊销后立即 401", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    const created = await call(server, "POST", "/api/v1/api-keys", {
      cookie,
      body: { name: "只读 agent", scopes: ["read"] },
    });
    expect(created.status).toBe(201);
    const createdData = created.body.data as { id: string; plaintext: string; prefix: string };
    expect(createdData.plaintext).toMatch(/^dtk_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$/);

    const read = await call(server, "GET", "/api/v1/tasks", {
      headers: { authorization: `Bearer ${createdData.plaintext}` },
    });
    expect(read.status).toBe(200);

    const write = await call(server, "POST", "/api/v1/tasks", {
      headers: { authorization: `Bearer ${createdData.plaintext}` },
      body: { title: "只读 key 不能写" },
    });
    expect(write.status).toBe(403);
    expect(write.body.error?.code).toBe("scope_insufficient");

    const revoked = await call(server, "DELETE", `/api/v1/api-keys/${createdData.id}`, { cookie });
    expect(revoked.status).toBe(200);

    const afterRevoke = await call(server, "GET", "/api/v1/tasks", {
      headers: { authorization: `Bearer ${createdData.plaintext}` },
    });
    expect(afterRevoke.status).toBe(401);
  });

  it("API Key 明文只返回一次，列表里只有 prefix", async () => {
    const server = await createTestServer();
    const cookie = await setupUser(server);

    const created = await call(server, "POST", "/api/v1/api-keys", {
      cookie,
      body: { name: "写权限 agent", scopes: ["write"], expiresInDays: 30 },
    });
    const createdData = created.body.data as { id: string; plaintext: string; expiresAt: number | null };
    expect(createdData.expiresAt).toBeTypeOf("number");

    const list = await call(server, "GET", "/api/v1/api-keys", { cookie });
    const items = (list.body.data as { items: Array<Record<string, unknown>> }).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.prefix).toBe(createdData.plaintext.split("_")[1]);
    expect(JSON.stringify(items[0])).not.toContain(createdData.plaintext.split("_")[2] as string);

    const writeAllowed = await call(server, "POST", "/api/v1/tasks", {
      headers: { authorization: `Bearer ${createdData.plaintext}` },
      body: { title: "write scope 可以写" },
    });
    expect(writeAllowed.status).toBe(201);
  });

  it("会话 30 天有效；剩余不足 7 天时滑动续期；过期后 401", async () => {
    const DAY = 24 * 60 * 60 * 1000;
    let clock = Date.UTC(2026, 0, 1);
    const server = await createTestServer({ now: () => clock });
    const cookie = await setupUser(server);

    clock += 24 * DAY; // 剩余 6 天 → 触发续期
    const stillValid = await call(server, "GET", "/api/v1/tasks", { cookie });
    expect(stillValid.status).toBe(200);

    const session = await server.db.first<{ expires_at: number }>(
      "SELECT expires_at FROM sessions ORDER BY created_at DESC LIMIT 1",
    );
    expect(Number(session?.expires_at)).toBe(clock + 30 * DAY);

    clock += 31 * DAY; // 超过 30 天
    const expired = await call(server, "GET", "/api/v1/tasks", { cookie });
    expect(expired.status).toBe(401);
  });

  it("API Key 到期后立即失效", async () => {
    const DAY = 24 * 60 * 60 * 1000;
    let clock = Date.UTC(2026, 0, 1);
    const server = await createTestServer({ now: () => clock });
    const cookie = await setupUser(server);

    const created = await call(server, "POST", "/api/v1/api-keys", {
      cookie,
      body: { name: "一天后过期", scopes: ["read"], expiresInDays: 1 },
    });
    const token = (created.body.data as { plaintext: string }).plaintext;

    const before = await call(server, "GET", "/api/v1/tasks", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(before.status).toBe(200);

    clock += 2 * DAY;
    const after = await call(server, "GET", "/api/v1/tasks", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(401);
  });
});

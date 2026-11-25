# 安全设计

> 这是个**单人**产品，但它会挂在公网域名上，且持有你未来 5 年的全部日程。
> 安全基线按「会被人扫到」来定，而不是「没人会攻击我」。

---

## 1. 资产

| 资产 | 泄漏后果 | 保护手段 |
| --- | --- | --- |
| 主密码 | 全量数据失守 | PBKDF2-SHA256 310k 迭代、16B 盐、常数时间比较 |
| 会话 Cookie | 冒充登录 | HttpOnly / Secure / SameSite=Lax / 30 天过期 / 服务端可吊销 |
| API Key（给 AI 用） | 任意读写日程 | 只存 SHA-256、按前缀检索、scope 最小化、可吊销、有过期时间、使用留痕 |
| 推送订阅 endpoint | 推送骚扰 | 随设备删除一并清理；endpoint 域名白名单 |
| 日程正文 | 隐私 | TLS 全链路 + 服务端静态加密（D1 自身加密）+ 导出需登录 |

---

## 2. 威胁模型与对策

### 2.1 暴力破解

- `/auth/login`：同 IP 15 分钟失败 ≥ 10 次 → 429，并记录 `login_attempts`。
- 密码策略：≥ 10 位，禁止纯数字（`/^\d+$/` 拒绝）。
- 失败响应统一 401 + `unauthorized`，不区分「用户不存在」与「密码错误」。
- 预留 TOTP：`users.totp_secret`（后续迁移加），接口 `/auth/totp`。

### 2.2 会话安全

```
Set-Cookie: detter_session=<48B base64url>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000
```
- 库内只存 `sha256(token)`；比对用常量时间。
- 滑动续期：剩余 < 7 天时延长到 30 天。
- 修改密码 / 吊销设备 → 立即删除对应会话。
- Cookie 名为 `__Host-detter_session`（生产）/ `detter_session`（本地 http 调试），前缀版本要求 `Secure` + `Path=/` + 无 `Domain`。

### 2.3 CSRF

三层：
1. `SameSite=Lax` 挡住绝大多数跨站表单/跳转；
2. 所有非 GET 请求必须带 `x-detter-csrf: 1`（跨站页面无法自定义头）；
3. 有 `Origin` 头时必须在白名单内。

API Key 请求不带 Cookie，不参与 CSRF 校验。

### 2.4 XSS

- React 默认转义；**禁止** `dangerouslySetInnerHTML`。
- 用户输入（标题、地点、备注、标签）只做纯文本渲染。
- Markdown 渲染（周报导出）若必须支持，走白名单渲染器并禁用 HTML。
- CSP（生产）：

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self';
frame-ancestors 'none';
base-uri 'none';
form-action 'self';
object-src 'none';
```

> Tailwind v4 与 Motion 都会注入内联样式，所以 `style-src` 允许 `'unsafe-inline'`；脚本不允许。

### 2.5 越权

所有查询强制 `WHERE user_id = ?`，包括按 id 查询。
即使当前是单用户，也不允许出现「按 id 查任意行」的写法——否则将来加用户就是灾难。

### 2.6 API Key 生命周期

| 阶段 | 规则 |
| --- | --- |
| 生成 | `dtk_<8 位随机>_<32 位随机>`，只在响应里返回一次 |
| 存储 | `prefix` 明文 + `sha256(整串)` |
| 使用 | 按 prefix 查 → 常量时间比对 → 检查过期/吊销 → 更新 `last_used_at`（5 分钟节流） |
| scope | `read`（查询）、`write`（增删改）、`admin`（密钥/密码/设备） |
| 吊销 | 立即生效；`audit_log` 留痕 |
| 建议 | 给 AI 用的 key 选 `write`，不要给 `admin`；命名标明用途（如 `claude-desktop-2026`） |

### 2.7 传输

- 强制 HTTPS；`Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`。
- Cloudflare 侧 SSL 模式必须是 **Full (strict)**，不能用 Flexible。
- 自托管时用 Cloudflare Tunnel（`cloudflared`），不直接暴露端口。

### 2.8 其它响应头

```
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: geolocation=(), microphone=(), camera=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

### 2.9 输入与体积

- 请求体上限 1MB（同步 op 上限 500 条）。
- 所有写入走 zod；字符串长度上限在 schema 里（标题 500、备注 20k）。
- SQL 全参数化；`q` 模糊查询对 `%` `_` 转义。

### 2.10 供应链

- 只用 `pnpm-lock.yaml` 安装（`--frozen-lockfile`）。
- 新增依赖需在 PR/任务报告里说明理由；不引入来路不明的包。
- 定期 `pnpm audit`。

### 2.11 日志

- 不记录：密码、Cookie、Authorization 头、完整 payload。
- 记录：请求 id、方法、路径、状态码、耗时、IP（截断最后一段）、错误码。
- `audit_log` 只记「谁（session/apikey 前缀）在什么时候对哪个实体做了什么」。

---

## 3. 数据备份与恢复

| 方式 | 频率 | 说明 |
| --- | --- | --- |
| D1 Time Travel | 自动 30 天 | `wrangler d1 time-travel restore` |
| 自动导出 | 每日 Cron | `GET /export/json` 写进 R2/本地，保留 14 份 |
| 手动导出 | 随时 | 设置页「导出全部数据」 |

恢复流程写进 `docs/ops/RUNBOOK.md`（T16 产出）。

---

## 4. 部署检查清单

- [ ] `SETUP_TOKEN` 是 32 位以上随机串，初始化后立刻从环境变量移除
- [ ] `APP_ORIGIN` 只包含真实域名
- [ ] Cloudflare SSL = Full (strict)，开启 HSTS
- [ ] 关闭 `*.workers.dev` 默认域名（只留自定义域名）
- [ ] D1 备份策略已配置
- [ ] API Key 只有必要的几个，且都能说出用途
- [ ] 手机/电脑都能正常登录，退出登录后 Cookie 失效
- [ ] 用未登录浏览器访问 `/api/v1/tasks` 返回 401

---

## 5. 明确的安全边界（写给未来的自己）

1. **不做端到端加密**：服务端需要能看到明文才能做 AI 上下文、提醒、导出。折中是「强鉴权 + 传输加密 + 云厂商静态加密 + 可导出可迁移」。
2. **不信任客户端时间**：`updatedAt` 偏差 > 24h 时以服务端时间为准。
3. **不把 AI 当可信方**：AI 的写操作与人类一样过 zod 校验与 scope 检查，并全部记审计。

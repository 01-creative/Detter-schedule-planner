# 部署指南

两条路，二选一。**代码完全一样**，只是数据库适配器与入口不同。

| | 方案 A · Cloudflare | 方案 B · 自有服务器 |
| --- | --- | --- |
| 优点 | 零运维、自动 HTTPS、全球边缘、免费额度足够单人使用 | 数据在自己机器上、国内访问可控、成本为 0（已有服务器） |
| 缺点 | 中国大陆访问不稳定（需自定义域名 + 优选） | 要自己维护进程、备份、升级 |
| 数据库 | D1 | 本地 SQLite 文件 |
| 入口 | `wrangler deploy` | `node dist/server.js` 或 Docker |

> 建议：**先 A 后 B**。A 能最快跑起来验证产品；等自己用得顺手了，再迁到 B（导出 JSON → 导入即可，`/export/json` 与 `POST /sync/push` 都支持）。

---

## 方案 A · Cloudflare

### 1. 前置

- 一个 Cloudflare 账号 + 已接入的域名（你已有）
- 本机装好依赖（`pnpm install`）

### 2. 建库

```bash
cd apps/api
npx wrangler login
npx wrangler d1 create detter
# 把输出里的 database_id 填进 wrangler.toml
npx wrangler d1 execute detter --remote --file=./migrations/0001_init.sql
```

### 3. 配密钥

```bash
npx wrangler secret put SETUP_TOKEN        # 32 位随机串，初始化后删掉
npx wrangler secret put APP_ORIGIN         # https://你的域名
npx wrangler secret put VAPID_PUBLIC_KEY   # 推送用，T14 生成
npx wrangler secret put VAPID_PRIVATE_KEY
```

### 4. 部署

```bash
pnpm --filter @detter/web build
npx wrangler deploy
```

### 5. 绑域名

Cloudflare 控制台 → Workers → detter-api → Settings → Domains & Routes → Add custom domain。
**SSL/TLS 模式必须是 Full (strict)**；打开 HSTS。

### 6. 大陆访问优化

- 关闭 `*.workers.dev` 默认域名，只留自定义域名。
- 如果经常连不上：在 DNS 里给该域名配「优选 IP」（社区方案），或直接切方案 B。
- 静态资源走 Workers Assets，天然带边缘缓存。

---

## 方案 B · 自有服务器（Docker，推荐）

> **更简单的选择：单端口模式。**
> Node 入口会自动查找前端构建产物（`apps/web/dist`），找到就由**同一个进程**同时提供页面与 API：
>
> ```powershell
> .\scripts\serve-local.ps1            # 默认 http://127.0.0.1:10101
> ```
>
> 一个进程、一个端口、一个 SQLite 文件，不需要 Nginx / Vite / Docker。
> 本机验收就用这个模式；放到公网时前面套一层 cloudflared 或 Nginx 即可。
>
> 安全上做了路径分流：`/api/*` 用最严格的 `default-src 'none'` CSP，
> 页面用 `default-src 'self'` 的文档 CSP（详见 `05-SECURITY.md` §2.4）。

### 1. 打包

```bash
git clone <repo> && cd detter-schedule-planner
pnpm install
pnpm --filter @detter/api build:node      # 产出 apps/api/dist/server.js
```

### 2. 起服务

```bash
export SETUP_TOKEN=$(openssl rand -hex 24)
export DETTER_DB=./data/detter.sqlite
export APP_ORIGIN=https://detter.你的域名
node apps/api/dist/server.js
```

或用 Docker：

```bash
cd deploy
SETUP_TOKEN=$(openssl rand -hex 24) docker compose up -d --build
```

### 3. 反向代理（Cloudflare Tunnel，免公网 IP）

```bash
cloudflared tunnel create detter
cloudflared tunnel route dns detter detter.你的域名
cloudflared tunnel run --url http://127.0.0.1:8787 detter
```

（或 Nginx：`proxy_pass http://127.0.0.1:8787;` + 强制 HTTPS + HSTS。）

### 4. 开机自启

- Linux：systemd unit（`deploy/detter.service.example`）
- Windows：任务计划程序 → 开机运行 `node dist/server.js`

### 5. 备份

```bash
# 每日 03:00 导出（cron）
0 3 * * * curl -s -H "Authorization: Bearer $DETTER_KEY" \
  https://你的域名/api/v1/export/json \
  -o /backup/detter-$(date +\%F).json
```

保留 14 份；SQLite 文件本身也建议一起备份（`data/detter.sqlite`）。

---

## 首次初始化

1. 打开站点 → 自动跳 `/setup`
2. 输入服务端日志/环境变量里的 `SETUP_TOKEN` + 设置主密码（≥10 位）
3. 进入首页 → 设置 → AI 接入 → 创建 API Key（给 AI 用，选 `read` + `write`）
4. 手机浏览器打开 → 添加到主屏（iOS 用 Safari，Android 用 Chrome）

---

## 升级

```bash
git pull
pnpm install
pnpm --filter @detter/api build:node
# 有数据库迁移时：
node apps/api/dist/server.js   # 启动时自动执行 migrations/*.sql
```

前端静态资源随 Workers 一起部署（方案 A），或由反代指向 `apps/web/dist`（方案 B）。

---

## 排障

| 现象 | 排查 |
| --- | --- |
| 401 循环 | Cookie 被浏览器拦截（Secure + http 访问）；本地开发用 http 时服务端会降级为无 Secure |
| 同步一直 pending | 看 `/api/v1/health`；看浏览器 Network 里 `/sync/push` 的状态码 |
| 手机无法安装 PWA | 必须 HTTPS；iOS 需 Safari「添加到主屏幕」 |
| 推送收不到 | 通知权限是否授予；iOS 需 16.4+ 且已添加到主屏 |
| 数据错乱 | 先导出 JSON 备份，再在设置里「强制全量同步」 |

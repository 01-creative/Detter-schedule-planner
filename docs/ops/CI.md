# CI 流水线

> **当前状态：未启用。**
> 仓库里的 GitHub Token 没有 `workflow` scope，GitHub 会拒绝包含 `.github/workflows/*` 的推送。
> 想启用 CI，用 GitHub 网页新建一个带 `workflow` 权限的细粒度 token，或在网页端直接粘贴下面的配置即可。

---

## 要在 GitHub Actions 上跑的东西

保存为 `.github/workflows/ci.yml`：

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10.15.0

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm typecheck

      - name: Lint
        run: pnpm lint

      - name: Test
        run: pnpm test

      - name: Build web
        run: pnpm --filter @detter/web build

      - name: Typecheck API
        run: pnpm --filter @detter/api typecheck
```

---

## 本地等价命令

CI 跑的和本地完全一致，出问题先本地复现：

```bash
pnpm install --frozen-lockfile
pnpm typecheck      # 4 个 workspace
pnpm lint           # ESLint：0 error 通过（warning 不阻塞）
pnpm test           # shared 28 + api 88 + web 259
pnpm build          # 前端生产构建
```

一条命令搞定：`pnpm verify`。

---

## 为什么 CI 只跑这些

| 没放进 CI 的东西 | 原因 |
| --- | --- |
| Playwright 端到端 | 需要起 API + 前端 + 造数据，跑一次 3 分钟以上；且断言里有时序。等有真机/正式部署环境后再加。 |
| `wrangler deploy` | 需要 Cloudflare 凭据与 D1 实例；属于部署流水线，不是 PR 校验。 |
| Docker 构建 | 同上，发布时再跑。 |
| 视觉回归 | 目前用 `scripts/qa-audit.mjs` 手动跑（9 路由 × 2 视口，检查溢出/白屏/控制台错误）。 |

---

## 建议的补充流水线（启用 CI 之后）

1. **视觉走查**：nightly 跑 `qa-audit.mjs`，失败时上传截图 artifact。
2. **部署**：`main` 合并后自动 `wrangler deploy` + `pnpm build` 上传静态资源。
3. **依赖审计**：每周 `pnpm audit --prod`。

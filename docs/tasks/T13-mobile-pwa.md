# T13 · 移动端与 PWA（含分享入口）

> 移动端不是"缩小版桌面"。手机上只有一件事重要：**掏出来 3 秒内记完**。

## 0. 目标

1. 可安装到主屏（iOS / Android），离线可开。
2. 系统分享菜单能把文字/链接直接丢进 Detter。
3. 所有主流程在 375 宽下可用，触控目标 ≥ 44px。

## 1. 前置

- T02~T12 已完成，主流程在桌面跑通。
- 设计规范：`04-DESIGN-SYSTEM.md` §5。

## 2. 文件所有权

`apps/web/vite.config.ts`（PWA 插件配置）、`apps/web/public/**`、`apps/web/src/sw.ts`（需要自定义策略时）、`src/features/mobile/**`、`src/app/router.tsx`（由总工接线）、各页面内的响应式调整（**只改自己模块内的**）。

## 3. PWA

- `vite-plugin-pwa`：`registerType: "autoUpdate"`、`injectRegister: "auto"`。
- Manifest：
  ```json
  {
    "name": "Detter",
    "short_name": "Detter",
    "start_url": "/",
    "display": "standalone",
    "theme_color": "#FAFAF9",
    "background_color": "#FAFAF9",
    "icons": [ { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
               { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
               { "src": "/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" } ],
    "share_target": {
      "action": "/share",
      "method": "GET",
      "params": { "title": "title", "text": "text", "url": "url" }
    }
  }
  ```
- 图标用代码生成（纯色渐变 + 字母 D），不要外链图片。
- Workbox 策略：
  - 预缓存 app shell
  - `/api/v1/sync/pull` 不缓存（NetworkOnly）
  - 静态资源 `StaleWhileRevalidate`

## 4. 分享入口

- 新增 `/share` 路由：读 `?title=&text=&url=`，拼成一段文本 → 写入 inbox → 显示「已收下」并可跳首页。
- 若未登录：先存 `localStorage` 待处理，登录后自动写入。
- 文档里补一段「iOS 快捷指令」配置说明（用 `POST /api/v1/capture` + API Key）。

## 5. 响应式打磨（逐页）

| 页面 | 移动端要求 |
| --- | --- |
| 四象限 | 纵向分区 + 顶部吸顶分段控件；卡片单列 |
| 收件箱 | 全宽列表，操作按钮收起为 `⋯` |
| 日历 | 默认议程视图 |
| OKR/KPI | 卡片单列，图表自适应宽度 |
| 专注 | 圆环 220，按钮 56 高 |
| 导图 | 双指缩放，节点文字可换行 |
| 设置 | 分组列表，长按复制 |

通用：
- 安全区：`padding-bottom: env(safe-area-inset-bottom)`（底部 tab / FAB）。
- 100vh 问题：用 `100dvh`。
- 输入框 `font-size: 16px` 以上，避免 iOS 自动缩放。
- 触摸反馈：`active:scale-[.97]`，120ms。

## 6. 验收

1. iOS Safari 添加到主屏 → 打开无地址栏 → 离线仍可用。
2. Android Chrome 安装 → 同上。
3. 从系统分享菜单分享一段文字到 Detter → inbox 出现该条。
4. 375 / 390 / 430 三个宽度逐页检查：无横向滚动、无遮挡、按钮可点。
5. Lighthouse（移动）PWA 项全绿，Performance ≥ 85。
6. 交互 3 秒记录：主屏图标 → FAB → 输入 → 保存，实测 ≤ 3 次点击。

## 7. 报告

1. 文件清单；2. `build` 输出；3. 真机/模拟器验证记录；4. Lighthouse 截图或数据；5. 遗留问题。

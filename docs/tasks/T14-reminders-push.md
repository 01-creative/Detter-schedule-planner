# T14 · 提醒与推送

> 用户的痛点原话：「当时几分钟记得，后面一忙就忘」。提醒是止损的最后一道闸。

## 0. 目标

- 任务到点能收到系统通知（PWA Web Push），即使页面没开着。
- 中国大陆环境下，Web Push 在 Android Chrome 上依赖 FCM，可能收不到 —— 因此**渠道要可插拔**，并给出降级方案。

## 1. 前置

- T01（服务端）、T13（PWA 已可安装）。
- 契约：`Task.remindOffsets`、`Task.remindedAt`、`ReminderChannel`。

## 2. 渠道设计

```ts
interface Notifier {
  id: "webpush" | "wechat" | "email";
  send(payload: ReminderPayload): Promise<{ ok: boolean; error?: string }>;
}
```

- v1 只实现 `webpush`；`wechat`（PushPlus/Server酱）与 `email` 留接口 + 配置项，默认关闭。
- 设置页可选择启用的渠道；多渠道路由规则：主渠道失败 2 次后自动降级到次渠道（若配置）。

## 3. Web Push

### 3.1 密钥

```bash
npx web-push generate-vapid-keys
```
写入服务端环境变量（`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT=mailto:you@example.com`）。
前端从 `GET /api/v1/push/public-key` 拿公钥。

### 3.2 订阅

- 设置页「开启提醒」→ `Notification.requestPermission()` → `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` → `POST /api/v1/push/subscribe`（存到 `devices.push_subscription`）。
- 关闭 → `pushManager.getSubscription()` → `unsubscribe()` → `DELETE /api/v1/push/subscribe`。
- iOS 必须已添加到主屏 + 16.4+；未满足时给出明确文案，不要静默失败。

### 3.3 调度

- 服务端 Cron（Workers `scheduled` / Node `setInterval` 60s）：
  1. 找出 `remindAt <= now` 且未发送的提醒
  2. 组装 payload：`{ title, body, taskId, url: "/?task=<id>", tag }`
  3. 逐个设备推送；失败（410/404）→ 清理订阅
  4. 写 `reminders` 表状态与 `task.remindedAt`
- 计算规则：对每个未完成任务，取 `startAt ?? dueAt`，减去 `remindOffsets` 里的每个偏移，生成提醒时间点（去重、只取未来 7 天内）。
- 幂等：同一 `(taskId, fireAt, channel)` 只发一次。

### 3.4 前端

- `src/sw.ts`（自定义 Service Worker 片段）：`push` 事件 → `showNotification`；`notificationclick` → 聚焦/打开对应任务。
- 页面内也做兜底：应用在前台时用 `setTimeout` + 本地 Notification（网络断了也能提醒）。

## 4. 设置页

```
提醒
├─ 浏览器通知      [开关]  状态：已授权 / 被拒绝（附「如何开启」）
├─ 微信推送        [开关]  填 PushPlus Token（可选）
├─ 邮件提醒        [开关]  填邮箱（可选）
└─ 默认提前        [5 分钟 ▾]  （新任务默认值）
```

## 5. 验收

1. 建一个 2 分钟后到点的任务，关闭页面 → 2 分钟后收到系统通知。
2. 点通知 → 打开应用并定位到该任务。
3. 同一任务不会重复收到同一时间的通知。
4. 拒绝通知权限 → UI 有明确引导，不报错。
5. 服务端 Cron 在 Node 与 Workers 两种运行时都能跑（用一次手动触发验证）。
6. 渠道降级：把 webpush 的 endpoint 改成无效值 → 不崩溃、记录失败、尝试下一个渠道（若配置）。

## 6. 报告

1. 文件清单；2. 测试输出；3. 真机推送验证记录（哪台设备、什么时间、收到与否）；4. 大陆网络下的实际表现；5. 遗留问题。

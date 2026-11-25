# 同步协议 v1

> 目标：**离线可用、跨设备最终一致、冲突可解释**。
> 单人场景，不做 CRDT；用「op-log + rev + 实体级 LWW」，够用且可调试。

---

## 1. 三个角色

| 角色 | 职责 |
| --- | --- |
| 本地库（IndexedDB） | 唯一读写入口，永远可读可写 |
| outbox | 记录尚未被服务端确认的本地变更 |
| 服务端 changes 表 | 追加式变更日志，`seq` 单调递增，是增量拉取的游标 |

---

## 2. 写路径

```
UI 操作
  └─► repo.write(entity)         // 事务：写实体 + 写 outbox
        └─► 800ms 防抖
              └─► POST /sync/push { deviceId, ops: [...] }
                    └─► 每个 op 独立返回 applied / conflict / error / duplicate
                          ├─ applied    → 删 outbox，落服务端 rev
                          ├─ duplicate  → 删 outbox
                          ├─ conflict   → 见 §4
                          └─ error      → 重试 3 次后进死信队列 + 提示
```

### op 结构

```ts
{
  opId: uuidv7(),          // 幂等键
  entity: "task",
  op: "upsert" | "delete",
  id: "<实体 id>",
  baseRev: 3,              // 客户端上次看到的 rev；新建为 0
  at: 1764...,             // 客户端本地时间
  payload: { ...完整实体 }  // delete 时省略
}
```

**必须推送完整实体快照**（不是字段补丁）：这样服务端无需理解字段语义，schema 演进也简单。

---

## 3. 读路径

```
每 15s（页面可见时）/ 切回前台时
  └─► GET /sync/pull?cursor=<lastSeq>&limit=200
        └─► 逐条：deleted ? 本地删除 : upsert 本地
              └─► 更新 cursor
        └─► hasMore ? 立刻再拉一次 : 等待下一轮
```

首次登录 / 换设备：`GET /sync/snapshot` 拿全量，再按 `cursor` 增量。

---

## 4. 冲突

服务端判定：`op.baseRev !== row.rev` → `conflict`，返回服务器当前版本。

客户端处理：

```ts
if (localWins(local, server)) {
  // 本地更新更晚：以 server.rev 作为新的 baseRev 重新入队
  requeue({ ...op, baseRev: server.rev });
} else {
  // 服务端胜：覆盖本地，删除该 op
  applyRemote(server);
  removeOp(op.opId);
}
```

`localWins`（`packages/shared/src/sync.ts`）：

```
local.updatedAt > remote.updatedAt  → true
local.updatedAt < remote.updatedAt  → false
相等 → deviceId 字典序大者胜（确定性，避免两边来回打架）
```

### 已知取舍

实体级 LWW 意味着「A 改标题、B 改象限」时，晚的那次会把另一处覆盖回旧值。
接受它，原因：
1. 单人、设备少、同一实体并发编辑概率极低；
2. 可以推出「冲突历史」给用户看（changes 表保留全部版本）；
3. CRDT 的字段级合并会让同步代码复杂度上一个数量级，收益不成正比。

**缓解**：任务详情面板编辑时会先拉一次最新版本；保存时若 `rev` 已变，提示「这条在其它设备上被改过」并提供「用我的覆盖 / 看差异」。

---

## 5. 服务端应用规则

逐个 op 在一个 `db.batch` 里成对写入「实体表 + changes 表」：

| 情况 | 处理 |
| --- | --- |
| 实体不存在 + upsert | 插入，`rev = 1` |
| 实体存在 + `baseRev === rev` | 更新，`rev += 1` |
| 实体存在 + `baseRev !== rev` | 返回 conflict，不写入 |
| delete + 不存在 | applied（幂等） |
| delete + rev 匹配 | `deleted_at = now`，`rev += 1`，change 记 `deleted = 1` |
| `opId` 已存在 | duplicate，返回原始 rev/seq |

服务端强制字段：`rev`（自己算）、`deviceId`（取请求方）。
`updatedAt` 用 payload 值，但若与服务器时间相差 > 24h，用服务器时间（防设备时钟错误导致永远赢/永远输）。

---

## 6. 墓碑与清理

- 软删除的行保留 90 天，之后由维护任务物理删除（`deleted_at < now - 90d`）。
- `changes` 表保留 180 天；客户端 cursor 落后太久（超过最早 seq）时自动走一次全量 snapshot。
- 客户端本地 tombstone 保留 30 天后清理（保证期间离线设备能收到）。

---

## 7. 时钟

不做 HLC。理由：单人设备时钟由系统 NTP 同步，误差 < 1s；LWW 用毫秒时间戳足够。
若检测到同一实体在 1s 内被两台设备写入，服务端在 `changes` 上记 `clock_skew` 标记，供排查。

---

## 8. 断网与重连

| 场景 | 行为 |
| --- | --- |
| 离线写 | 正常写本地 + outbox，`SyncBadge` 显示「离线 · N 条待同步」 |
| 恢复 | `online` 事件触发立刻 push + pull |
| push 部分失败 | 成功的删 op，失败的保留并退避（1s/2s/4s，最多 3 次） |
| 服务端 5xx | 全部保留，退避重试；不丢数据 |
| 版本冲突（服务端升级） | `426 upgrade_required` → 提示刷新页面 |

---

## 9. 测试清单（T01 必测）

- [ ] 新建 → 推 → 拉，两端一致
- [ ] 同一 opId 重复推送只应用一次
- [ ] baseRev 过期 → conflict + 返回权威版本
- [ ] 删除产生墓碑，另一设备拉取后本地消失
- [ ] 100 条 op 批量推送后 `changes` 数量正确、seq 连续
- [ ] 游标分页：limit=2 时 hasMore 正确，循环拉取不丢不重

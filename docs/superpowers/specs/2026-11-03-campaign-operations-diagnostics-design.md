# 活动运营与混合诊断设计

## 目标

让唯一 Owner 在开发者管理后台查询商家的多件优惠活动与配置，在紧急场景安全暂停活动，并通过应用 trace ID 串联管理后台、商家 Worker、活动操作和 SHOPLINE 上游调用的诊断信息。

系统使用混合诊断：D1 保存可检索的业务诊断事件 30 天；Cloudflare Logpush 把两个 Worker 的原始请求日志写到 R2，R2 生命周期规则在 7 天后删除对象。

## 范围

包含：

- 查询已安装商家的活动列表及草稿、启用、计划中、暂停、结束状态。
- 查看活动名称、状态、配置、适用商品或集合、折扣档位、版本号及最近诊断事件。
- Owner 在二次确认后紧急暂停活动。
- 查询应用请求、活动操作、SHOPLINE 上游调用的规范化诊断数据。
- 通过 Cloudflare Logpush 保存两个 Worker 的原始请求日志至 R2。

不包含：

- 不新增或假设 SHOPLINE 未公开的全店健康检查 API。
- 不在浏览器或 D1 保存 access token、refresh token、Cookie、Authorization 头、请求正文、完整 SHOPLINE 响应正文。
- 不让开发者管理后台直连商家应用 D1。
- 不在后台逐对象扫描 R2 原始日志；D1 是搜索入口，R2 仅用于深度排障留存。

## 追踪模型

每一个进入管理后台或商家 Worker 的请求都有一个应用 trace ID：

- 若收到可信的 `X-Trace-Id` 且值符合 UUID 格式，则继承它；否则生成新的 UUID。
- 两个 Worker 在所有响应中返回 `X-Trace-Id`。
- Admin Worker 调用 `MERCHANT_APP` 时传递该 trace ID，并把它计入 HMAC 签名消息，防止中间层替换。
- 商家 Worker 为自身产生的 SHOPLINE 调用创建关联诊断事件。

应用 trace ID 与 SHOPLINE 上游请求 ID 是两个字段：

- `traceId`：本应用生成的完整链路关联 ID。
- `upstreamRequestId`：仅在 SHOPLINE 响应头或响应体明确提供请求 ID 时记录；不可用时为 `null`。

## 商家 Worker：活动读取和暂停

商家 D1 仍是活动与诊断数据的权威来源。现有 `quantity_breaks_campaigns` 的 `campaign_json` 是活动配置来源，活动按 `shop_handle` 归属。新增受 HMAC、时间戳、nonce 保护的内部接口：

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/internal/admin-read/v1/stores/:storeId/campaigns` | 返回该商家的活动摘要和最后诊断事件 |
| GET | `/internal/admin-read/v1/stores/:storeId/campaigns/:id` | 返回活动完整配置、适用范围、折扣档位与诊断事件 |
| POST | `/internal/admin/v1/stores/:storeId/campaigns/:id/pause` | 用当前 revision 执行紧急暂停 |
| GET | `/internal/admin-read/v1/diagnostics` | 按 trace ID、商家、活动、类型、时间筛选 D1 诊断事件 |

读取接口先由 `storeId` 解析出仍安装商家的 handle，再读取活动；不返回 session token 或任何会话加密字段。

紧急暂停请求体为 `{ expectedRevision, reason? }`：

- `expectedRevision` 必须等于当前活动 revision，防止 Owner 暂停一个已被商家更新的版本。
- 仅 `active` 或 `scheduled` 活动允许暂停；`draft`、`paused`、`ended` 返回明确的冲突响应。
- 商家 Worker 复用当前发布锁与 SHOPLINE 自动折扣撤销流程。撤销确认后，把活动写为 `paused`；任何不确定结果保持可重试状态，不伪装为暂停成功。
- 每次请求都写业务诊断事件，包含原因摘要、操作结果、版本、耗时及 trace ID。

## D1 诊断数据

商家 D1 新增诊断事件表，字段至少包括：

- `id`、`trace_id`、`worker_name`、`store_id`、`shop_handle`、`campaign_id`
- `event_type`：`request`、`campaign_pause`、`shopline_api`、`worker_error`
- `outcome`：`success`、`failure`、`uncertain`
- `upstream_service`、`upstream_path`、`upstream_status`、`upstream_request_id`
- `error_code`、`duration_ms`、`occurred_at`、`expires_at`

索引覆盖 `trace_id`、`store_id + occurred_at`、`campaign_id + occurred_at` 与 `expires_at`。5 分钟定时任务删除过期数据，保留 30 天。

管理后台的 Admin D1 继续只保存 Owner 会话和 Owner 审计：活动读取为敏感读取审计；紧急暂停写 `campaign.pause_requested`、`campaign.pause_succeeded` 或 `campaign.pause_failed`。不复制活动或商家诊断事实。

## Cloudflare 原始日志

创建专用 R2 bucket，例如 `kaching-worker-diagnostics`：

- 为 `shopline-quantity-breaks` 和 `kaching-developer-admin` 分别配置 Cloudflare Logpush job，使用不同前缀。
- 启用 7 天 R2 lifecycle expiration。
- R2 保存 Cloudflare 日志源实际支持的时间、Worker、请求、响应和 Ray ID 字段。应用 trace ID 的可靠查询源是 D1 诊断事件；原始日志按时间、Worker、CF-Ray ID 和 D1 事件定位信息辅助关联。
- 采集规则排除 Cookie、Authorization、token、请求/响应正文与查询中敏感值。

部署前必须在当前 Cloudflare 账户中确认 Worker 日志源与可用字段，再创建 Logpush job；不得把未由该账户支持的字段写入配置。Logpush 由 Cloudflare 账户套餐能力决定。若目标日志源不可用，D1 业务诊断继续工作；后台显示“原始日志未启用”，不影响活动运营或紧急暂停。

## 开发者管理后台

新增“活动与排障”导航项：

- 活动列表可按商家、状态、异常状态和日期筛选，显示活动状态、配置摘要、折扣档位数量、范围、最近异常、trace ID 和更新时间。
- 活动详情显示范围、商品/集合、档位、版本、状态与最近诊断事件。
- 紧急暂停使用危险操作确认框，要求明确确认当前商家、活动名称和版本；请求期间禁用重复提交。
- 诊断页可按 trace ID、商家、活动、错误类别和时间查询；展示应用 trace ID、SHOPLINE 上游请求 ID（如有）、HTTP 状态、耗时和安全错误摘要。
- 所有写请求继续要求 Owner 会话与 `x-csrf-token`，并由 Admin Worker 对商家响应做白名单投影。

## 验收与测试

- 商家 Worker 单元/路由测试：HMAC、nonce 重放、活动读取隔离、版本冲突、暂停成功/失败/不确定状态、诊断过期清理和敏感字段不泄漏。
- 管理 Worker 测试：Owner/CSRF、签名 trace ID 传递、响应投影、审计结果与商家错误映射。
- 前端测试：状态映射、危险暂停确认、空/加载/错误状态和 trace ID 展示。
- 部署验收：确认两个 Worker 的 `ADMIN_INTERNAL_SECRET` 相同；验证 D1 30 天清理任务；确认两个 Logpush job、R2 前缀和 7 天生命周期规则存在。
- 使用真实测试商家执行一次暂停，确认活动不再生效、D1 诊断和 Admin 审计拥有同一应用 trace ID；若 SHOPLINE 返回上游请求 ID，确认其单独展示。

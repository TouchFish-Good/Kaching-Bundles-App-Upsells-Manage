# Developer Admin Console API 草案（阶段 2，已确认方向）

## 2026-11-24 已实现增量：活动启动与订阅周期

`GET /admin-api/v1/stores` 与 `GET /admin-api/v1/stores/{storeId}` 使用同一个订阅展示摘要。`subscription` 新增可选字段 `nextStartsAt`、`nextEndsAt`，均为毫秒时间戳或 `null`。数据来自应用已保存的 `next_display_from`、`next_display_until`，仅展示尚未开始的下一期；缺少记录时不根据当前到期时间或自动续费标志推算。下一期结束时间必须晚于下一期开始时间。此读取不修改商家订阅、权限或生效窗口。

Overview、Stores 的桌面列表和手机卡片显示下一期开始时间，无数据时显示 `—`。店铺详情显示当前订阅状态、套餐、当前订阅结束时间、宽限结束时间及下一期开始/结束时间。新增周期时间精确到秒。

活动与排障列表按商家 handle（忽略大小写）、店铺 ID、活动更新时间降序和活动 ID 排序，在数据库分页前完成。同一商家的活动集中排列，商家内部优先展示最近更新的活动。列表及详情中的 handle 均可在新标签页打开 `https://{handle}.myshopline.com/`。

已失效活动详情开放“启动”。`POST /admin-api/v1/campaigns/{campaignId}/activate` 继续校验管理员权限、CSRF、店铺归属与 `expectedRevision`；应用内部接口复用商家应用现有启动流程，包括范围冲突判断、过期活动替换、平台发布及结果核验。过期活动启动可能产生新的独立活动 ID，成功响应包含 `{ campaign, outcome }`，`outcome` 为 `activated`、`activation_pending` 或 `already_active`。页面按返回 ID 跳转，不能假定启动后仍使用原活动 ID。

活动摘要新增可选布尔字段 `activationPending`。平台已接受但尚未确认的活动显示“待确认”，隐藏再次启动入口；详情读取复用应用现有核验逻辑。页面自动查询最多一分钟，查询仅用于确认结果，不重发创建请求；仍未确认时保留待确认状态并提示刷新或查看诊断。旧服务缺少新字段时仍兼容。金额展示和商家应用启动的业务规则不变；本次无需新增数据库迁移，需要同时发布应用与管理后台 Worker。

## 2026-11-23 已实现增量：商家订阅展示

`GET /admin-api/v1/stores` 的 `subscription` 展示摘要支持 `unknown`、`trial`、`active`、`grace`、`review_pending`、`inactive`，并新增 `unactive`、`pending`、`cancelled`、`expired`、`scheduled`。可选布尔字段 `isTrial` 区分试用，旧服务不返回该字段时仍可正常显示。`plan`、`validUntil`、`graceUntil`、`lastVerifiedAt` 的字段和毫秒时间戳格式不变。该摘要用于管理后台展示，不作为商家应用的使用权限依据。

Stores 和 Overview 统一显示未生效、待生效、已取消、已过期和待开始状态；试用对应显示“试用已过期”等文案。已到 `end_at` 的 `unactive` 订阅按已过期展示，原始快照仍保留平台状态；尚未到期或缺少到期时间时继续显示未生效。非生效订阅保留套餐和历史到期时间。只有应用已确认且仍在有效窗口内、并匹配同一订阅的宽限期才显示宽限时间。

应用侧新增独立订阅展示快照。后台列表仅读取本地摘要，不逐个商家调用 Partner API，不持有商家授权令牌。已有商家的展示数据由应用现有五分钟任务分批补查；查询失败保留上次确认的摘要。尚未补查到的商家兼容原有权限摘要，真实接口联调须在两个 Worker 发布后完成。

Stores 新增 `subscriptionStatus` 查询参数，默认 `all`，支持上述展示状态及 `unverified`（没有订阅摘要）。`unknown`（状态未知）与 `unverified`（未核验）分别筛选；`expired` 同时包含试用已过期和付费已过期。可与安装状态 `status`、搜索 `query`、`limit`、`offset` 组合使用。应用只读接口以同一请求时间推导展示状态，在数据库筛选后统计和分页，返回准确的 `total`；非法订阅状态返回 422 `INVALID_SUBSCRIPTION_STATUS`。列表刷新、详情返回和浏览器历史通过 URL 保留条件；修改条件重置分页，清除筛选同时清空搜索。

本次筛选无需数据库迁移，需同时发布管理后台和应用只读接口；只发布页面不会产生服务端筛选。此增量不修改商家应用界面、订阅权限判定或商家订阅记录。

发布顺序：先更新管理后台的状态兼容和界面；然后为应用 D1 应用 `0024_subscription_display_snapshots.sql`，再发布应用 Worker。单独部署管理后台不能恢复应用此前清空的订阅展示数据。

更新日期：2026-10-14。以下端点均为拟议契约，现有项目尚未实现。浏览器只访问管理服务同源 `/admin-api/v1`；商家服务内部只读接口不对浏览器开放。

## 通用契约

Cookie 为 Secure、HttpOnly、SameSite=Lax；所有请求服务端检查管理员会话、账号状态、MFA、角色与环境。状态变更接口校验 CSRF。响应含 `requestId`，敏感响应设置 `Cache-Control: no-store`。列表默认 `limit=25`，最大 `100`，采用游标分页及排序字段白名单。时间为 ISO 8601 UTC。错误形状为 `{ "error": { "code": "FORBIDDEN", "message": "..." }, "requestId": "..." }`：401 未认证、403 无权限、404 不存在或不属于目标店铺、409 冲突、422 参数错误、503 数据源不可用。精确错误码及枚举在实施前以 OpenAPI 固化。

## 身份与管理员

| 方法和路径 | 权限 | 行为 |
| --- | --- | --- |
| `POST /auth/login` | 公开，限速 | 邮箱和密码；成功后进入待 MFA 会话，不泄露账号是否存在。 |
| `POST /auth/mfa/verify` | 待 MFA 会话 | 验证 WebAuthn/TOTP，轮换会话 ID；具体 MFA 方式待确认。 |
| `POST /auth/logout` | 已登录 | 撤销会话、清 Cookie、写审计。 |
| `GET /auth/me` | 已登录 | 返回管理员 ID、角色、允许环境及 MFA 状态；不返回密码或秘密。 |
| `POST /admin-users/invitations` | Owner | 邀请账号，校验 CSRF、限速、写审计。 |
| `POST /admin-users/{id}/disable` | Owner | 停用并撤销全部会话；禁止停用最后一个 Owner。 |

公开注册端点不存在。首次 Owner 通过一次性离线引导创建。密码重置、邀请发送渠道和账号恢复流程待明确。

## 只读业务接口

| 方法和路径 | 最低角色 | 主要参数 | 返回要点 |
| --- | --- | --- | --- |
| `GET /overview` | Viewer | `environment`, `from`, `to` | 已安装店铺、有效活动、错误数；每项含 `asOf/sourceStatus`，缺源为 null。 |
| `GET /stores` | Viewer | `environment`, `query`, `status`, `sort`, `cursor`, `limit` | 脱敏商家摘要与 `nextCursor`。 |
| `GET /stores/{storeId}` | Viewer | `environment` | 基本信息、安装周期摘要、授权 scope、数据更新时间；无 token。 |
| `GET /stores/{storeId}/bundles` | Viewer | `status`, `type`, `query`, `cursor`, `limit` | 仅该店活动；无真实数据源则 503 `SOURCE_UNAVAILABLE`。 |
| `GET /stores/{storeId}/bundles/{bundleId}` | Viewer | `environment` | 验证活动属于该店后返回只读配置摘要和 revision。 |
| `GET /bundles` | Viewer | `environment`, `storeId?`, `status`, `type`, `query`, `cursor`, `limit` | 跨店列表每项含 store ID，区分同名活动。 |
| `GET /events/errors` | Operator | `environment`, `storeId?`, `kind`, `severity`, `from`, `to`, `cursor`, `limit` | 脱敏错误事件，时间窗口和页长受限。 |
| `GET /audit-events` | Owner | `environment`, `actorId?`, `action`, `from`, `to`, `cursor`, `limit` | 追加式审计记录；无编辑或删除端点。 |

P1 可增加 `GET /monitoring/health` 和 `GET /deployments`；可信来源接入前不开放，或返回明确 `SOURCE_UNAVAILABLE`。P2 运维写操作另行设计，不沿用这些只读接口。

## 商家应用内部接口

建议前缀 `/internal/admin-read/v1`：`GET /stores`、`GET /stores/{id}`、`GET /stores/{id}/bundles`、`GET /stores/{id}/bundles/{id}`、`GET /overview`、`GET /events/errors`。仅私网与管理服务短时身份可调用；管理服务重新验证管理员权限、参数和响应字段，不直接透传。内部请求贯通 request ID。内部接口不返回 OAuth token、Webhook 原文或个人资料。活动状态由商家服务按原业务规则计算。

## 响应示例与测试

```json
{
  "data": {
    "environment": "production",
    "installedStoreCount": { "value": 42, "asOf": "2026-10-14T08:00:00Z", "sourceStatus": "current" },
    "activeBundleCount": { "value": null, "asOf": null, "sourceStatus": "unavailable" },
    "errorCount": { "value": 3, "asOf": "2026-10-14T08:00:00Z", "sourceStatus": "current" }
  },
  "requestId": "example-only"
}
```

示例数字仅展示契约格式，绝非项目真实指标。测试需覆盖商家 Cookie 401、Viewer 越权 403、跨店活动 ID 404、过期会话 401、非法分页 422、源不可用 503 且无 mock 回退、管理员停用后会话立即失效。对列表、详情和错误响应做字段白名单测试，确保不含 `accessToken`、密钥或原始 payload；敏感详情及错误事件读取写审计。

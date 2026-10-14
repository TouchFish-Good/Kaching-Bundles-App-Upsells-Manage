# Developer Admin Console API 草案（阶段 2，已确认方向）

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

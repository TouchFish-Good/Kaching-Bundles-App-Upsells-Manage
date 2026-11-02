# Cloudflare Worker + D1 开发者管理后台设计

## 目标与已确认决策

开发者管理后台是只允许一个 Owner 使用的运维工具。它必须完全运行在 Cloudflare 上，同时与商家应用保持严格的数据边界：

- 商家应用继续作为其现有 App D1 中商家、订阅权益、活动、反馈和诊断数据的唯一权威来源。
- 管理后台在新的 Admin D1 中保存账号凭据、会话、CSRF 状态、审计记录和登录限流数据。
- 两个 Worker 部署在同一个 Cloudflare 账户。管理后台 Worker 通过 Service Binding 调用商家 Worker；商家数据库不会绑定给管理后台 Worker。
- 现有的 HMAC 请求签名和重放校验继续用于内部读取边界。Service Binding 消除了公网跳转，但不替代这一层应用级授权校验。
- 固定 Owner 账户由本地管理脚本一次性初始化。脚本生成带版本的密码记录并写入 Admin D1；系统不提供注册接口或运行时初始化凭据。

目标是使系统可以在 Cloudflare 上生产部署，但不把当前尚未接入的商家数据源表述为已可用。

## 部署拓扑

```text
浏览器
  -> developer-admin.example.com
  -> 开发者管理后台 Worker（Vite 静态资源 + /admin-api/v1）
       -> Admin D1：Owner、会话、CSRF、审计、登录尝试
       -> MERCHANT_APP Service Binding + HMAC 签名
            -> 商家应用 Worker
                 -> App D1：店铺、订阅权益、活动、反馈、诊断
```

开发者管理后台 Worker 从同一域名提供构建后的 `web/dist` 静态资源与 API。SPA 回退仅处理非 API 路径。API 响应保持 `Cache-Control: no-store`；静态资源保留 Workers Assets 的正常缓存行为。

Worker 配置使用新的 `ADMIN_DB` D1 绑定，并通过 `MERCHANT_APP` Service Binding 调用现有的 `shopline-quantity-breaks` Worker。数据库 ID、域名和密钥值属于部署配置，绝不提交。

## Admin D1 数据模型

Admin D1 只包含以下表：

- `admin_users`：仅允许一个活跃的 `Owner`；邮箱唯一；密码记录使用含随机盐和明确迭代次数、带版本的 Web Crypto PBKDF2-SHA-256 格式。
- `admin_sessions`：哈希后的不透明会话令牌、CSRF 令牌、创建时间、活动时间、过期时间和撤销时间。
- `admin_audit`：Owner 登录、登出、敏感读取，以及未来审核操作的审计事件。
- `admin_login_attempts`：按来源记录、15 分钟自动过期的计数器，用于拒绝同一来源的第 11 次及之后登录尝试。
- `admin_internal_nonces`：管理后台向商家端发起已签名读取时使用的、自动过期的 nonce 重放记录，确保现有商家端 HMAC 校验契约不变。

Admin D1 不复制商家 access token、Webhook 原始载荷、活动记录、反馈内容或订阅数据。

会话使用 `HttpOnly`、`Secure`、`SameSite=Lax`、路径 `/admin-api/v1`、8 小时绝对过期和 30 分钟空闲过期。身份验证使用 Web Crypto 比较密码记录，且不返回可用于枚举账号的信息。对于必须审计的受保护操作，审计写入成功后才返回响应。

## Worker API 与内部数据流

浏览器 API 保持与当前前端兼容：

- `POST /admin-api/v1/auth/login`
- `GET /admin-api/v1/auth/me`
- `POST /admin-api/v1/auth/logout`
- `GET /admin-api/v1/overview`、`/stores`、`/stores/:storeId`、`/stores/:storeId/bundles`、`/bundles`、`/events/errors` 和 `/audit-events`

管理后台 Worker 校验分页和环境参数、验证唯一 Owner、为请求路径签名并调用 `env.MERCHANT_APP.fetch()`。字段投影层只允许明确定义的字段返回浏览器。商家端错误映射到现有 `NOT_FOUND`、`INVALID_SOURCE_QUERY` 与 `SOURCE_UNAVAILABLE` API 契约。

商家 Worker 继续使用 `ADMIN_INTERNAL_SECRET`、时间戳和 nonce 授权 `/internal/admin-read/v1/*`。现有路由已可提供 Overview、Stores、Store Detail 和 Errors。后续数据契约任务会增加订阅权益摘要、活动/折扣摘要和反馈审核的内部路由；在这些路由实现并由真实 App D1 记录支撑前，管理后台必须明确显示不可用。

## 迁移与初始化

部署时创建新的 Admin D1 数据库，并通过 Wrangler 应用有序迁移集。不导入本地 `admin.sqlite` 文件：本地会话和审计事件仅是非生产开发数据，生产环境的 Owner 会被有意重新初始化。

离线 `bootstrap-owner` 脚本从操作者环境接收邮箱与密码，按照与 Worker 相同的带版本 PBKDF2 格式生成记录，并输出供 `wrangler d1 execute --remote` 使用的参数化 SQL。若已存在活跃 Owner，脚本拒绝生成插入语句。密码值和生成的 SQL 不写入仓库或测试夹具。

每个已部署 Worker 独立配置 Cloudflare Secrets：

- Admin Worker：`ADMIN_INTERNAL_SECRET`。
- Merchant Worker：相同的 `ADMIN_INTERNAL_SECRET`。

生产环境不存在 `.env` 文件。未来若某项功能需要加密密钥，则创建为 Worker Secret，并只记录配置名称、不记录值。

## 错误处理、可观测性与安全性

- 无效 JSON、分页和 CSRF 令牌返回明确的 4xx API 错误；数据库或 Service Binding 失败返回不暴露内部细节的通用 503。
- 每个响应携带不透明 request ID。商家 Trace ID 仅通过已投影的错误事件契约返回。
- Owner 密码、会话令牌、HMAC 密钥、完整商家记录、access token 和原始 Webhook 载荷均不得进入浏览器响应或审计记录。
- Service Binding 不具有 App D1 绑定。商家 Worker 继续负责按行和按字段投影。
- 登录限流保存在 Admin D1，使其跨 Worker isolate 仍然有效。过期的限流与 nonce 记录由 Worker 定时任务清理。

## 测试与验收

迁移必须使用 Cloudflare Vitest pool 和本地 D1 绑定验证。测试覆盖：

1. Owner 创建、PBKDF2 校验、重复 Owner 拒绝、会话过期、登出、CSRF 和共享登录限流。
2. HMAC 签名的 Service Binding 读取、响应投影、重放拒绝、商家源不可用处理，以及敏感读取的必需审计结果。
3. 未认证、请求格式错误、无权限和成功流程的 Worker 路由契约。
4. 静态资源 SPA 回退不会截获 `/admin-api/*` 路由。
5. Vite 构建、Worker 类型检查、Wrangler dry-run，以及桌面端和移动端浏览器冒烟测试。

生产验收还要求：应用 Admin D1 迁移、配置两个 Worker 的 Secret 和 Service Binding、初始化唯一 Owner、通过 HTTPS 访问生产自定义域名，并证明管理后台 Worker 没有 App D1 绑定。

## 非目标与分阶段范围

本次实现仅替换管理后台的运行时和本地状态存储，不伪造订阅到期、活动发布或反馈审核数据。这些商家侧能力将在其内部契约和测试存在后作为后续阶段完成。

实现分为两个交付项：

1. 可部署的 Cloudflare 原生管理后台 Worker，保留目前可用的只读页面、认证、审计和数据投影行为。
2. 扩展商家内部数据契约，并为订阅、活动和反馈审核启用管理后台 UI；每项能力均由真实 App D1 数据支持并单独验证。

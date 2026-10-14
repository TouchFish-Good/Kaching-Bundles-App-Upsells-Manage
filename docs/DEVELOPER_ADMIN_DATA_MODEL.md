# Developer Admin Console 数据模型草案（阶段 2，已确认方向）

更新日期：2026-10-14。以下是逻辑模型，不代表数据库表已存在或迁移已执行。稳定 SHOPLINE store ID 的来源仍须验证。

## 数据所有权

商家应用拥有商家、安装周期、Bundle 活动和应用事件；管理服务拥有管理员账号、会话和审计。管理服务通过内部只读 API 获取脱敏投影，不直接读 `shopline_sessions`。业务实体带 `environment`，时间存 UTC，外部 ID 与内部 UUID 分开。跨环境不能共享账号会话或把同名店铺视为同一对象。

| 实体 | 候选关键字段 | 约束及说明 |
| --- | --- | --- |
| `stores` | `id`, `environment`, `shopline_store_id`, `handle`, `display_name`, `current_installation_id`, `last_synced_at` | `(environment, shopline_store_id)` 唯一；handle 可变且不作主键；名称可空并标来源。 |
| `installations` | `id`, `store_id`, `installed_at`, `uninstalled_at`, `status`, `scopes`, `last_event_at` | 一店可有多个安装周期，同一时刻最多一个 active；重复 Webhook 不产生新周期。 |
| `bundle_campaigns` | `id`, `store_id`, `external_discount_id?`, `type`, `name`, `enabled`, `starts_at`, `ends_at`, `revision`, `updated_at`, `deleted_at?` | 商家业务模型为权威，后台只读；状态由相同业务规则派生，避免两套状态冲突。配置结构随商家端真实模型确定。 |
| `app_events` | `id`, `environment`, `store_id?`, `occurred_at`, `received_at`, `kind`, `severity`, `error_code?`, `trace_id?`, `summary`, `dedupe_key?` | 仅允许脱敏摘要；按环境/时间/店铺建索引，重复投递按幂等键去重。 |
| `admin_users` | `id`, `email_normalized`, `password_hash`, `role`, `status`, `mfa_enrollment`, `created_at`, `disabled_at?` | 邀请制；邮箱唯一；MFA 秘密加密存储，恢复码仅存哈希；权限变更写审计。 |
| `admin_sessions` | `id_hash`, `admin_user_id`, `created_at`, `last_seen_at`, `expires_at`, `revoked_at?`, `mfa_verified_at` | 仅存会话 ID 哈希，可逐会话撤销；与商家 OAuth 会话完全独立。 |
| `admin_audit_events` | `id`, `actor_id?`, `occurred_at`, `action`, `target_type`, `target_id?`, `environment`, `result`, `request_id`, `metadata` | 追加写；失败登录可无 actor；metadata 使用字段白名单，不存请求正文。 |
| `deployment_records`（P1/P2） | `id`, `component`, `environment`, `version`, `published_at`, `result`, `source_ref` | 仅可信 CI/CD 写入；不表示商家级扩展启用状态。 |

## 关系与生命周期

`stores 1:N installations / bundle_campaigns / app_events`；`admin_users 1:N admin_sessions / admin_audit_events`。安装事件处理必须在事务中更新周期和店铺当前安装引用；同时保存事件时间与接收时间。重复事件幂等处理，乱序事件不得覆盖更晚的已确认状态，并留下可排查记录。卸载后历史数据是否保留及期限待用户决定；清理需覆盖关联记录、索引及备份策略。管理员停用立即撤销全部会话；审计记录不随账号停用而删除。

## 查询投影和统计口径

`store_summary` 仅含稳定 ID、名称/handle、安装状态、最近授权/同步时间、活动数和错误数；绝不含 accessToken。`bundle_summary` 含店铺 ID、活动 ID、名称、类型、派生状态、时间和 revision。Overview 已安装数按当前 active 安装的稳定 store ID 去重；有效活动数按商家端派生规则计算；错误数按固定时间窗口内去重事件计数。每项聚合返回环境、范围、`asOf` 和 `sourceStatus`；不可用时值为 null，不以样本或零替代。

## 现有数据库与未验证契约

目前实际存在的只有 SQLite `shopline_sessions`，其中包含 accessToken。它不能充当 `stores` 或 `admin_users`，且管理服务不应直接连接。开发环境可用新逻辑模型做验证；生产存储与迁移顺序待架构批准。`web/src/prototype/data.ts` 的 `campaignData` 不能导入生产作为真实活动。

需验证：稳定 SHOPLINE store ID 如何取得、安装/卸载 Webhook 的唯一事件标识和顺序语义、真实活动字段与外部折扣 ID、Function 指标来源、Theme Extension 商家启用状态。若取不到某字段，应调整页面及模型，不得用 handle 或虚构值填补。

# Developer Admin Console MVP 验收报告

更新日期：2026-11-02。范围：Cloudflare Worker 本地 D1 与假 Service Binding 验证；没有创建 Cloudflare 远程资源、真实 SHOPLINE 商家联调或生产部署。

状态定义：PASS 表示有本地测试或代码证据；BLOCKED 表示缺少真实数据源或外部条件；NOT_TESTED 表示尚未进行对应环境验证。

| 需求 | 状态 | 证据及限制 |
| --- | --- | --- |
| ADM-01 独立认证 | PASS | 单 Owner 的 PBKDF2 密码、会话失效、CSRF、登出、商家 Cookie 拒绝和共享登录限流由 Worker/D1 测试覆盖。没有 MFA。 |
| ADM-02 管理权限 | PASS | 后台只有 Owner；所有管理读取在 Worker 内验证 Owner，会话状态不依赖商家 Cookie。 |
| ADM-03 商家安装清单 | BLOCKED | Service Binding、HMAC 和字段投影已由假商家响应验证；尚未与真实 SHOPLINE 店铺核对。 |
| ADM-04 商家详情 | BLOCKED | 稳定 ID 详情与敏感读取审计由本地 Worker 测试覆盖；真实数据仍待联调。 |
| ADM-05 Bundle 查询 | BLOCKED | 商家服务已有草稿存储，但商家页面仍使用原型活动；跨店稳定 ID 投影未接入。管理接口返回 SOURCE_UNAVAILABLE，页面显示未接入。 |
| ADM-06 Bundle 详情 | BLOCKED | 同 ADM-05，无法与商家端真实记录比对。 |
| ADM-07 Overview | BLOCKED | 已安装数与最近错误数来自本地登记表；活动数明确显示不可用。真实统计口径待联调。 |
| ADM-08 脱敏错误事件 | PASS | 只允许投影后的 Trace ID 与结构化字段；格式错误、重放拒绝和源不可用均映射为安全错误。 |
| ADM-09 管理审计 | PASS | 登录和敏感读取写入独立 Admin D1；敏感读取按 success/not_found/failure 记录，审计失败会阻断响应。 |
| ADM-10 至 ADM-13 P1 | NOT_TESTED | 结构化日志、服务监控、扩展部署证据、历史趋势未接入。 |
| ADM-14 至 ADM-16 P2 | NOT_TESTED | 部署历史、告警、受控运维操作未实施。 |

## 执行记录

- 后台：Node 24 下 Worker 测试、Owner SQL 脚本测试、Worker 类型检查和 Vite 生产构建已通过。旧 Node 运行时已移除。
- 浏览器：未执行。运行真实登录 E2E 需要先创建 Admin D1 并提供真实 `ADMIN_DB` binding；不会以虚构 ID 代替。
- 安全边界：内部读取采用 HMAC 签名，重放保护由商家 Worker 的 App D1 保持；管理 Worker 对商家响应执行字段投影，测试证明 access token 不会进入浏览器响应。

## 上线前事项

1. 创建独立 Admin D1、设置两个 Worker 的共享 `ADMIN_INTERNAL_SECRET` 与 Service Binding，并应用迁移和 Owner SQL。
2. 用真实测试店完成授权、卸载、重装和错误事件核对，再确认 ADM-03 至 ADM-08。
3. 在真实 binding 下运行浏览器登录 E2E，随后完成 HTTPS、自定义域名、备份、保留期与部署验收。

本报告不将本地夹具数据视为真实商家验收，也不表示系统已可用于生产。

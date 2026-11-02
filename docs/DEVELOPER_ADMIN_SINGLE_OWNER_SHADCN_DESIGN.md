# Developer Admin Console: Single Owner and Shadcn Direction

更新日期：2026-11-02。状态：Worker 本地实现已验证；Cloudflare 远程集成和浏览器登录 E2E 尚未执行。

## Confirmed Decisions

- 后台只有一个 Owner 账户。通过离线 `bootstrap-owner` 脚本读取 `ADMIN_BOOTSTRAP_EMAIL` 与 `ADMIN_BOOTSTRAP_PASSWORD`，生成受锁保护的 Admin D1 SQL。
- 登录只有邮箱和密码；没有公开注册、MFA、邀请、团队管理或角色导航。
- 密码登录创建短期 `HttpOnly` 会话；登出、CSRF、登录限流、敏感读取审计和商家 Worker 的 HMAC 边界仍然保留。

## Information Architecture

| Area | Purpose | Current source status |
| --- | --- | --- |
| Overview | Installed stores, active campaigns, and 24-hour errors | Stores/errors available when the merchant source responds; campaigns unavailable |
| Stores | Installation state, scopes, installation cycles, and related activity context | Available from the signed internal source |
| Bundles | Cross-store campaign inspection | Explicitly unavailable until the merchant app persists real campaign records |
| Errors | Filtered errors with store ID and Trace ID copy action | Available only for structured events the merchant app has collected |
| Audit | Owner login and sensitive-read trail | Available from the console database |

Subscription expiry, feedback moderation, and full campaign/discount inspection are intentionally not represented as mock data. They require signed internal source routes backed by the merchant application's real entitlement, feedback, and campaign repositories before these pages can be opened.

## UI Direction

The console follows a Shadcn-style internal-tool language: neutral `zinc` surfaces, small radii, one-pixel borders, compact controls, Lucide icons, and semantic status badges. Cards only frame discrete metrics and records; content sections remain unframed. Desktop uses a 240px navigation rail and responsive tables. Mobile uses a drawer navigation and labelled record summaries rather than squeezing data tables into the viewport.

当前 `docs/qa/` 中的旧夹具截图不构成 Cloudflare Worker 浏览器验收。真实 Admin D1 binding 就绪后，需重新采集登录页、Overview、Stores 与 Bundles 的桌面和移动端截图。

## Next Data Contracts

1. Add signed internal read routes for subscription entitlements by stable store ID, including `state`, `activeSpuKey`, `validUntil`, `graceUntil`, and `lastVerifiedAt`.
2. Add a campaign/discount projection that returns only the store-owned campaign summary, publication state, schedule, tier summary, and revision.
3. Add feedback moderation routes with an Owner audit entry for every status, visibility, or reply change.
4. Generate or propagate a Trace ID at the merchant worker boundary and persist it with structured error events; no request tokens or raw payloads enter the console.

# GDPR 与开发者后台数据视图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在全 Cloudflare 架构内安全处理 SHOPLINE GDPR 删除通知，并让唯一 Owner 在开发者后台查看 GDPR 任务、已安装商家和可读的活动折扣详情。

**Architecture:** 商家 Worker 是 SHOPLINE 回调、店铺凭证、市场和活动数据的唯一拥有者；它验签 GDPR 回调、持久化可重试任务、处理删除，并将经过白名单投影的活动价格和市场信息交给管理后台。开发者后台继续通过 Service Binding 读取商家 Worker，仅以反向私有 Service Binding 清除本后台中与已删除商家关联的审计记录；浏览器不直接调用 SHOPLINE 或任何内部端点。

**Tech Stack:** Cloudflare Workers、D1、Service Bindings、Hono、TypeScript、React 18、Vite、Vitest、Playwright。

**Spec:**
- `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/docs/superpowers/specs/2026-11-12-shopline-gdpr-webhooks-design.md`
- `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/docs/superpowers/specs/2026-11-12-overview-installations-and-campaign-pricing-design.md`

## Global Constraints

- SHOPLINE GDPR 回调仅由 `app.vswwy.cn` 接收，成功持久化后返回空 body 的 `200`。
- GDPR 原始 payload、客户姓名、邮箱、手机号、订单 ID、Authorization、Cookie 和 token 不可持久化、返回或写诊断。
- GDPR 回调使用原始 body 的 `X-Shopline-Hmac-Sha256` 常量时间验签；使用实店投递确认签名编码前不得改变既有普通 webhook 验签。
- `customers/redact` 当前仅完成可审计任务，不删除无关联的全店数据；`merchants/redact` 仅删除该稳定店铺范围的数据。
- 商店删除在 30 天时限内执行；计划任务每 5 分钟处理任务；重复投递和重复执行必须幂等。
- 所有商家范围的 SHOPLINE Admin REST 请求必须使用 `shoplineAdminHeaders()`。
- 活动金额内部保持最小货币单位整数；百分比保持基点整数；浏览器必须按可靠币种格式化，不能显示“分”或猜测币种。
- 管理后台只接受严格白名单投影；不得把完整 SHOPLINE 市场响应、会话或平台折扣 ID 返回给浏览器。
- 不新增或修改 CSS 的 `:focus`、`:focus-visible` 或相关焦点伪类规则。
- 不修改当前未审阅的商家应用主题、Function、翻译、公共页面或既有设计/计划草稿。
- 每个仓库仅在用户明确批准该次变更推送后，暂存已审阅文件、创建提交并推送对应 `main`；绝不使用 `git add -A` 或强制推送。

## Review Focus

- Base64 与 hex 两种 HMAC 编码差异：只接受与同一 raw body 匹配的签名，错误编码不得被错误接受。Task 2 覆盖。
- 商店删除的部分失败：后台审计清理失败时商家行不能标记完成，并能无副作用重试。Task 3 覆盖。
- 反向 Service Binding 被公网伪造：缺少、过期、重放或错误签名必须返回 `401`，且不删除审计行。Task 4 覆盖。
- SHOPLINE 市场请求异常或市场缺失：活动详情仍返回市场 ID 和已保存金额，不能伪造名称。Task 5 覆盖。
- JPY 等零小数位币种、百分比基点和未提供店铺币种：前端不能显示错误金额。Task 8 覆盖。

---

## File Structure

### 商家应用仓库

`/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new`

- `worker/migrations/0018_gdpr_deletion_tasks.sql`: GDPR 任务表、索引和可安全清理的最小完成记录。
- `worker/src/auth/gdpr-webhook.ts`: 原始 body 验签、主题/头部/最小 payload 验证、客户 ID 带密钥摘要。
- `worker/src/db/gdpr-deletion-tasks.ts`: D1 幂等写入、claim、成功、重试和过期清理。
- `worker/src/jobs/gdpr-deletion-tasks.ts`: 客户与商店范围的删除编排。
- `worker/src/internal/admin-cleanup-client.ts`: 调用开发者后台私有审计清理端点的 HMAC 客户端。
- `worker/src/routes/gdpr.ts`: 公网 GDPR 回调和 Service Binding 任务读取/重试接口。
- `worker/src/services/storefront-market.ts`: 经校验、五分钟缓存的市场名称和币种元数据读取。
- `worker/src/routes/internal-admin.ts`: 活动详情价格投影和 GDPR 任务内部接口注册。
- `worker/src/index.ts`, `worker/src/env.ts`, `worker/wrangler.toml`: 路由、调度器和 `DEVELOPER_ADMIN` Service Binding。

### 开发者后台仓库

`/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台`

- `worker/internal/merchant-client.ts`: 复用既有签名约定，增加 GDPR 任务读取和重试调用。
- `worker/source-projection.ts`: 严格投影 GDPR 任务、店铺币种和市场覆盖项。
- `worker/routes/admin-api.ts`: Owner/CSRF 保护的 GDPR 任务 API 与审计；不暴露私有清理端点。
- `worker/index.ts`, `worker/env.ts`, `wrangler.toml`: 仅由反向 Service Binding 调用的审计清理端点和服务绑定声明。
- `worker/db/admin-store.ts`: 删除给定店铺及其活动/反馈目标 ID 的 `admin_audit` 行。
- `web/src/api.ts`, `web/src/App.tsx`, `web/src/pages.tsx`, `web/src/campaigns.tsx`, `web/src/gdpr.tsx`, `web/src/styles.css`: 首页已安装商家区块、中文活动金额展示、两页 GDPR 任务管理和导航。

### 测试文件

- 商家 Worker 新增 `worker/test/gdpr-webhook.test.ts`、`worker/test/gdpr-deletion-tasks.test.ts`、`worker/test/storefront-market.test.ts`，并扩展 `worker/test/internal-admin-routes.test.ts`、`worker/test/migrations.test.ts`。
- 开发者后台扩展 `worker/test/campaign-admin-api.test.ts`、`worker/test/source-boundary.test.ts`、`worker/test/migrations.test.ts`，新增 `worker/test/gdpr-admin-api.test.ts` 与 `web/test/admin-presentation.test.mjs`。

### Task 1: GDPR D1 模型与可重试仓储

**Repository:** 商家应用仓库

**Files:**
- Create: `worker/migrations/0018_gdpr_deletion_tasks.sql`
- Create: `worker/src/db/gdpr-deletion-tasks.ts`
- Modify: `worker/test/migrations.test.ts`
- Create: `worker/test/gdpr-deletion-tasks.test.ts`

**Interfaces:**
- Produces: `D1GdprDeletionTasks.createVerified()`, `claimDue()`, `complete()`, `retry()`, `list()` and `purgeExpired()`.
- Consumes: `D1Database` and the Worker clock injected by tests.

- [ ] **Step 1: Write failing repository and migration tests**

```ts
it('deduplicates a verified webhook ID without storing raw customer data', async () => {
  await tasks.createVerified(customerTask);
  await tasks.createVerified(customerTask);
  const row = await db.prepare('SELECT webhook_id, customer_id_digest FROM gdpr_deletion_tasks').first();
  expect(row).toMatchObject({ webhook_id: customerTask.webhookId, customer_id_digest: expect.any(String) });
  expect(JSON.stringify(row)).not.toContain('customer@example.com');
});

it('claims one due task once and keeps a failed task retryable before its deadline', async () => {
  await tasks.createVerified(merchantTask);
  expect((await tasks.claimDue(now)).map((task) => task.webhookId)).toEqual([merchantTask.webhookId]);
  await tasks.retry(merchantTask.webhookId, 'ADMIN_AUDIT_CLEANUP_FAILED', now + 5_000);
  expect(await tasks.list({ kind: 'merchant_redact', limit: 25, offset: 0 })).toMatchObject({ total: 1 });
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm --prefix worker test -- --run test/gdpr-deletion-tasks.test.ts test/migrations.test.ts`

Expected: FAIL because the migration and `D1GdprDeletionTasks` do not exist.

- [ ] **Step 3: Add the migration and repository**

```sql
CREATE TABLE gdpr_deletion_tasks (
  webhook_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('customer_redact', 'merchant_redact')),
  store_id TEXT NOT NULL,
  shop_domain TEXT,
  customer_id_digest TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'completed', 'retrying', 'failed')),
  received_at INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL,
  completed_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error_code TEXT
);
CREATE INDEX idx_gdpr_deletion_tasks_due ON gdpr_deletion_tasks (state, next_attempt_at);
```

Implement claim with one D1 batch that transitions only an eligible `pending`/`retrying` task to `running`; `complete()` clears `shop_domain`; `purgeExpired()` deletes records after `completed_at + 30 days`.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `npm --prefix worker test -- --run test/gdpr-deletion-tasks.test.ts test/migrations.test.ts`

Expected: PASS.

- [ ] **Step 5: Review checkpoint**

Run: `git diff --check` and `git diff -- worker/migrations/0018_gdpr_deletion_tasks.sql worker/src/db/gdpr-deletion-tasks.ts worker/test/gdpr-deletion-tasks.test.ts worker/test/migrations.test.ts`.

Do not commit or push until the user explicitly approves the completed change set.

### Task 2: GDPR Public Webhook Authentication and Ingestion

**Repository:** 商家应用仓库

**Files:**
- Create: `worker/src/auth/gdpr-webhook.ts`
- Create: `worker/src/routes/gdpr.ts`
- Modify: `worker/src/index.ts`
- Modify: `worker/src/crypto.ts`
- Create: `worker/test/gdpr-webhook.test.ts`
- Modify: `worker/test/crypto.test.ts`

**Interfaces:**
- Consumes: `D1GdprDeletionTasks.createVerified(input)` from Task 1.
- Produces: `registerGdprRoutes(app)` for the two configured public routes.

- [ ] **Step 1: Write failing HMAC and callback contract tests**

```ts
it('returns an empty 200 after accepting a signed customers/redact payload', async () => {
  const response = await worker.fetch(gdprRequest('/api/webhooks/gdpr/customers-redact', signedCustomerBody));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('');
});

it.each(['missing', 'wrong', 'replayed'])('rejects %s GDPR signatures without creating a task', async (mode) => {
  const response = await worker.fetch(gdprRequest('/api/webhooks/gdpr/merchants-redact', merchantBody, mode));
  expect(response.status).toBe(401);
  expect(await taskCount()).toBe(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix worker test -- --run worker/test/gdpr-webhook.test.ts`

Expected: FAIL because neither GDPR route exists.

- [ ] **Step 3: Implement raw-body verification and routes**

```ts
const rawBody = await request.text();
const header = request.headers.get('X-Shopline-Hmac-Sha256') ?? '';
const hex = await hmacHex(env.SHOPLINE_APP_SECRET, rawBody);
const base64 = await hmacBase64(env.SHOPLINE_APP_SECRET, rawBody);
if (!timingSafeEqual(header, hex) && !timingSafeEqual(header, base64)) throw new GdprWebhookError('INVALID_SIGNATURE');
```

Add `hmacBase64()` next to the existing `hmacHex()` and test both helpers against the same known HMAC digest. Require `POST`, exact path/topic pairing, non-empty `X-Shopline-Webhook-Id`, numeric `X-Shopline-Shop-Id`, valid `X-Shopline-Shop-Domain`, and the minimal topic-specific ID. Hash only the customer ID with an HMAC-derived digest before calling Task 1. The response is `new Response(null, { status: 200 })`; invalid input is `401` or `400` with no PII in body or logs.

- [ ] **Step 4: Run focused and existing webhook tests**

Run: `npm --prefix worker test -- --run worker/test/gdpr-webhook.test.ts worker/test/webhook.test.ts worker/test/crypto.test.ts`

Expected: PASS; existing generic webhook validation remains unchanged.

- [ ] **Step 5: Review checkpoint**

Run: `git diff --check` and inspect `worker/src/auth/gdpr-webhook.ts` to confirm raw payload is never persisted or emitted.

### Task 3: GDPR Execution, Merchant Redaction and Scheduler

**Repository:** 商家应用仓库

**Files:**
- Create: `worker/src/jobs/gdpr-deletion-tasks.ts`
- Create: `worker/src/internal/admin-cleanup-client.ts`
- Modify: `worker/src/index.ts`
- Modify: `worker/src/env.ts`
- Modify: `worker/wrangler.toml`
- Create: `worker/test/gdpr-deletion-tasks.test.ts`

**Interfaces:**
- Consumes: `D1GdprDeletionTasks` from Task 1 and Task 4's private admin cleanup endpoint.
- Produces: `processGdprDeletionTasks(env, now)` and an `Env.DEVELOPER_ADMIN` Service Binding.

- [ ] **Step 1: Add failing deletion-order tests**

```ts
it('redacts one merchant in dependency order and leaves other stores untouched', async () => {
  await processGdprDeletionTasks(env, now);
  expect(await countRowsForStore('42')).toBe(0);
  expect(await countRowsForStore('43')).toBeGreaterThan(0);
  expect(await tasks.get(merchantTask.webhookId)).toMatchObject({ state: 'completed', shopDomain: null });
});

it('does not complete merchant deletion when private audit cleanup fails', async () => {
  env.DEVELOPER_ADMIN = { fetch: async () => new Response('', { status: 503 }) } as Fetcher;
  await processGdprDeletionTasks(env, now);
  expect(await tasks.get(merchantTask.webhookId)).toMatchObject({ state: 'retrying', lastErrorCode: 'ADMIN_AUDIT_CLEANUP_FAILED' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix worker test -- --run worker/test/gdpr-deletion-tasks.test.ts`

Expected: FAIL because no processor or reverse binding exists.

- [ ] **Step 3: Implement bounded redaction and five-minute scheduling**

```ts
if (task.kind === 'customer_redact') {
  await tasks.complete(task.webhookId, now);
  return;
}
await deleteDeveloperAdminAudit(env, { storeId: task.storeId, shopHandle: task.shopDomain });
await database.batch(merchantScopedDeleteStatements(task.storeId, handle));
await tasks.complete(task.webhookId, now);
```

Build deletion statements in child-before-parent order for feedback attachments, comments, votes, replies, status history, feedback records, campaign operation children, campaigns/publications/staged data, subscriptions, diagnostics, request/errors, installation/session/webhook rows and store identity. Keep only the current completed GDPR task. Call the reverse binding before destructive merchant D1 deletes. In `scheduled()`, call `processGdprDeletionTasks()` on the existing `*/5` path before normal campaign/subscription work, and call `purgeExpired()` there as well.

Add `DEVELOPER_ADMIN` as a Service Binding in `worker/wrangler.toml` targeting `kaching-developer-admin`; use the existing `ADMIN_INTERNAL_SECRET` signature shape with an explicit `POST /internal/merchant-redaction/v1/audit-cleanup` path and a generated trace ID.

- [ ] **Step 4: Run deletion, scheduler and migration tests**

Run: `npm --prefix worker test -- --run worker/test/gdpr-deletion-tasks.test.ts worker/test/migrations.test.ts worker/test/health.test.ts`

Expected: PASS, including retrying after a reverse-binding failure.

- [ ] **Step 5: Review checkpoint**

Run: `git diff --check` and verify every deletion statement binds the resolved `store_id` or `shop_handle`; reject any unscoped `DELETE FROM` statement.

### Task 4: Developer Admin Private Cleanup Endpoint and GDPR Owner API

**Repository:** 开发者后台仓库

**Files:**
- Modify: `worker/env.ts`
- Modify: `worker/index.ts`
- Modify: `worker/db/admin-store.ts`
- Modify: `worker/internal/merchant-client.ts`
- Modify: `worker/routes/admin-api.ts`
- Modify: `worker/source-projection.ts`
- Create: `worker/test/gdpr-admin-api.test.ts`
- Modify: `worker/test/source-boundary.test.ts`

**Interfaces:**
- Consumes: signed merchant requests and Merchant Worker paths `/internal/admin-read/v1/gdpr-tasks` and `/internal/admin/v1/gdpr-tasks/:webhookId/retry`.
- Produces: owner endpoints `GET /gdpr/customer-tasks`, `GET /gdpr/merchant-tasks`, `POST /gdpr/tasks/:webhookId/retry`, and the private cleanup endpoint used in Task 3.

- [ ] **Step 1: Write failing owner, CSRF and private-auth tests**

```ts
it('requires an Owner and CSRF token before retrying a failed GDPR task', async () => {
  const response = await worker.fetch(ownerRequest('/admin-api/v1/gdpr/tasks/event-1/retry', { method: 'POST' }));
  expect(response.status).toBe(403);
});

it('rejects an unsigned reverse-binding cleanup request without changing admin_audit', async () => {
  const response = await worker.fetch(new Request('https://admin.internal/internal/merchant-redaction/v1/audit-cleanup', { method: 'POST' }));
  expect(response.status).toBe(401);
  expect(await auditCount()).toBe(1);
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm run test:worker -- --run worker/test/gdpr-admin-api.test.ts`

Expected: FAIL because the endpoints and task projection do not exist.

- [ ] **Step 3: Implement owner proxy, strict projection and private cleanup**

```ts
app.post('/gdpr/tasks/:webhookId/retry', requireOwner, async (context) => {
  if (!csrfAllowed(context)) return context.json({ error: { code: 'CSRF_REQUIRED' } }, 403);
  return proxyGdprRetry(context, context.req.param('webhookId'));
});
```

Validate the HMAC timestamp, nonce, trace ID and signature for `/internal/merchant-redaction/v1/audit-cleanup` using the same canonical string already used for Merchant requests. Validate only numeric `storeId` and optional valid `shopHandle`; `AdminStore.removeMerchantAuditTargets()` deletes only matching `admin_audit.target_id` values. Do not make that endpoint available beneath `/admin-api/v1`. Project customer task ID only as its persisted digest summary; never return raw payload, original customer ID or domain after completion. Owner retry writes `gdpr.retry_requested` and final proxy result audit rows.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `npm run test:worker -- --run worker/test/gdpr-admin-api.test.ts worker/test/source-boundary.test.ts`

Expected: PASS; private endpoint remains absent from browser API routes.

- [ ] **Step 5: Review checkpoint**

Run: `git diff --check` and search `rg -n 'customer_id|customerId|payload|authorization' worker` to confirm no raw customer field enters a response projection.

### Task 5: Market Metadata and Activity Pricing Projection

**Repository:** 商家应用仓库, then 开发者后台仓库

**Files:**
- Modify: merchant `worker/src/services/storefront-market.ts`
- Modify: merchant `worker/src/routes/internal-admin.ts`
- Create: merchant `worker/test/storefront-market.test.ts`
- Modify: merchant `worker/test/internal-admin-routes.test.ts`
- Modify: admin `worker/source-projection.ts`
- Modify: admin `worker/test/campaign-admin-api.test.ts`

**Interfaces:**
- Produces merchant `resolveCampaignMarketMetadata(session, marketIds, env)` returning validated `{ marketId, marketName, currencyCode | null }[]`.
- Produces the safe campaign additions `shopCurrencyCode` and `tiers[].marketOverrides[]` consumed by Task 8.

- [ ] **Step 1: Write failing market cache and projection tests**

```ts
it('caches a validated market name for five minutes and sends SHOPLINE admin headers', async () => {
  await resolveCampaignMarketMetadata(session, ['market-us'], env);
  await resolveCampaignMarketMetadata(session, ['market-us'], env);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].headers).toMatchObject({ Accept: 'application/json', 'User-Agent': 'SHOPLINE-Quantity-Breaks-App/1.0' });
});

it('projects only known market override fields and removes unknown source fields', async () => {
  expect(projectSource('/campaigns', sourceWithMarkets).body).not.toContain('accessToken');
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm --prefix worker test -- --run worker/test/storefront-market.test.ts worker/test/internal-admin-routes.test.ts`

Run: `npm run test:worker -- --run worker/test/campaign-admin-api.test.ts`

Expected: FAIL because campaign market metadata is not projected.

- [ ] **Step 3: Implement metadata enrichment and strict source projection**

```ts
const overrides = Object.entries(tier.marketOverrides ?? {}).map(([marketId, override]) => ({
  marketId,
  marketName: marketById.get(marketId)?.name ?? null,
  mode: override.mode,
  ...(override.mode === 'specified_amount' ? { currencyCode: override.currencyCode, amountMinor: override.amountMinor } : {}),
}));
```

Use the existing five-minute market cache and `shoplineAdminHeaders()`. Only enrich single campaign detail reads; list reads retain their light projection. If metadata or the shop currency lookup fails, return `null` names/currency while retaining valid stored overrides. In the admin Worker, validate bounded strings, positive integer amounts and the two allowed modes; reject unknown fields and malformed source records with `INVALID_SOURCE`.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `npm --prefix worker test -- --run worker/test/storefront-market.test.ts worker/test/internal-admin-routes.test.ts`

Run: `npm run test:worker -- --run worker/test/campaign-admin-api.test.ts`

Expected: PASS; market source outages do not turn a valid campaign detail into an unavailable source.

- [ ] **Step 5: Review checkpoint**

Run: `rg -n 'fetch\(' worker/src/services/storefront-market.ts worker/src/routes/internal-admin.ts` and manually verify every new SHOPLINE request supplies `shoplineAdminHeaders()`.

### Task 6: Merchant GDPR Internal Operations API

**Repository:** 商家应用仓库

**Files:**
- Modify: `worker/src/routes/gdpr.ts`
- Modify: `worker/src/routes/internal-admin.ts`
- Modify: `worker/test/internal-admin-routes.test.ts`

**Interfaces:**
- Produces `GET /internal/admin-read/v1/gdpr-tasks?kind=&state=&storeId=&limit=&offset=` and `POST /internal/admin/v1/gdpr-tasks/:webhookId/retry`.
- Consumes: `authorizeInternalRequest()` and `D1GdprDeletionTasks`.

- [ ] **Step 1: Write failing internal endpoint tests**

```ts
it('lists only the safe merchant-redact task projection for a signed internal request', async () => {
  const response = await app.fetch(signedInternalGet('/internal/admin-read/v1/gdpr-tasks?kind=merchant_redact&limit=25&offset=0'), env, ctx);
  expect(await response.json()).toMatchObject({ data: { items: [expect.objectContaining({ kind: 'merchant_redact', state: 'pending' })] } });
});

it('rejects retry of a completed task and accepts a signed retry of a failed task', async () => {
  expect((await app.fetch(signedInternalPost('/internal/admin/v1/gdpr-tasks/done/retry'), env, ctx)).status).toBe(409);
  expect((await app.fetch(signedInternalPost('/internal/admin/v1/gdpr-tasks/failed/retry'), env, ctx)).status).toBe(200);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix worker test -- --run worker/test/internal-admin-routes.test.ts`

Expected: FAIL because no GDPR internal routes exist.

- [ ] **Step 3: Implement signed task list and retry routes**

```ts
app.post('/internal/admin/v1/gdpr-tasks/:webhookId/retry', route(async (context) => {
  const task = await tasks.requestRetry(context.req.param('webhookId'), currentTime(context.env));
  return task ? context.json({ data: task }) : context.json({ error: { code: 'TASK_NOT_RETRYABLE' } }, 409);
}));
```

Apply the same pagination, store ID, state and kind validation style as existing internal routes. Task lists expose only task ID, kind, store ID, safe handle snapshot while pending, digest summary, state, attempts, timestamps and non-PII error code. Completed merchant rows show `已清除` through frontend presentation, not a retained shop domain.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `npm --prefix worker test -- --run worker/test/internal-admin-routes.test.ts worker/test/gdpr-deletion-tasks.test.ts`

Expected: PASS.

- [ ] **Step 5: Review checkpoint**

Run: `git diff --check` and inspect response fixtures for raw webhook bodies, customer IDs, emails and domains after completion.

### Task 7: Developer Admin GDPR Screens and Navigation

**Repository:** 开发者后台仓库

**Files:**
- Create: `web/src/gdpr.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/api.ts`
- Modify: `web/src/styles.css`
- Create: `web/test/admin-presentation.test.mjs`

**Interfaces:**
- Consumes: `GdprDeletionTask` API type from `api.ts` and Owner retry endpoint from Task 4.
- Produces routes `/gdpr/customer-deletions` and `/gdpr/merchant-deletions`.

- [ ] **Step 1: Write failing presentation tests**

```js
test('labels completed merchant deletion as cleared without retaining a handle', () => {
  assert.equal(gdprTaskStoreLabel({ kind: 'merchant_redact', state: 'completed', handle: null, storeId: '42' }), '已清除 · 42');
});

test('allows retry only for pending, retrying and failed GDPR tasks', () => {
  assert.equal(canRetryGdprTask({ state: 'completed' }), false);
  assert.equal(canRetryGdprTask({ state: 'failed' }), true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test web/test/admin-presentation.test.mjs`

Expected: FAIL because the GDPR presentation module does not exist.

- [ ] **Step 3: Implement the two task pages**

```tsx
<Route path="/gdpr/customer-deletions" element={<GdprTasksPage kind="customer_redact" admin={admin} />} />
<Route path="/gdpr/merchant-deletions" element={<GdprTasksPage kind="merchant_redact" admin={admin} />} />
```

Use one reusable task list component with fields: 接收时间、商家/客户摘要、事件 ID、状态、尝试次数、截止时间、完成时间、失败代码和操作。 Add filters for state, store and date. The action is an icon button with tooltip; it opens the existing compact confirmation dialog wording that the operation is irreversible. It sends the CSRF token and refreshes the list after a successful retry. Do not create an input that lets an Owner fabricate a customer or merchant deletion event.

- [ ] **Step 4: Run frontend tests and build**

Run: `node --test web/test/admin-presentation.test.mjs && npm run build`

Expected: PASS and no TypeScript errors.

- [ ] **Step 5: Review checkpoint**

Run: `git diff --check` and manually check that completed customer tasks render digest summaries only.

### Task 8: Overview and Campaign Detail Presentation

**Repository:** 开发者后台仓库

**Files:**
- Modify: `web/src/api.ts`
- Modify: `web/src/pages.tsx`
- Modify: `web/src/campaigns.tsx`
- Modify: `web/src/styles.css`
- Modify: `web/test/admin-presentation.test.mjs`

**Interfaces:**
- Consumes: `Store`, `Overview`, campaign `shopCurrencyCode` and market override projections from Tasks 4 and 5.
- Produces: independent Overview installed-store resource and presentation helpers `campaignDiscountTypeLabel()`, `formatCampaignDiscountValue()` and `formatMarketOverride()`.

- [ ] **Step 1: Write failing presentation tests**

```js
test('uses the confirmed Chinese discount labels', () => {
  assert.equal(campaignDiscountTypeLabel('bundle_fixed_price'), '整单固定价格');
  assert.equal(campaignDiscountTypeLabel('fixed_amount'), '每件固定减免');
});

test('formats minor units and does not guess a missing currency', () => {
  assert.equal(formatCampaignDiscountValue({ discountType: 'percentage', discountValue: 1000 }), '10%');
  assert.equal(formatCampaignDiscountValue({ discountType: 'fixed_price', discountValue: 1250, shopCurrencyCode: 'USD' }), 'USD 12.50');
  assert.equal(formatCampaignDiscountValue({ discountType: 'fixed_price', discountValue: 100 }), '币种暂不可用');
});

test('uses a zero-decimal currency and market fallback correctly', () => {
  assert.equal(formatCampaignDiscountValue({ discountType: 'fixed_amount', discountValue: 1200, shopCurrencyCode: 'JPY' }), 'JPY 1,200');
  assert.match(formatMarketOverride({ marketId: 'm-1', marketName: null, mode: 'auto_convert' }), /市场名称暂不可用 · m-1 · 自动换算/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test web/test/admin-presentation.test.mjs`

Expected: FAIL because the helpers and relevant fields do not exist.

- [ ] **Step 3: Implement the compact views**

```tsx
const stores = useResource<List<Store>>('/stores?status=installed&limit=10&offset=0');
<section className="overview-section">
  <div className="section-heading"><h2>已安装商家</h2><Link to="/stores?status=installed">查看全部商家</Link></div>
  <InstalledStoreList resource={stores} />
</section>
```

Keep Overview metric and store resources independent. Remove only the `max-width: 780px` declaration from `.overview-section`. In campaign detail, add the market coverage column/row content without changing campaign actions. Use `Intl.NumberFormat(undefined, { style: 'currency', currency })` with `currencyDisplay: 'code'`; show `—` for `none`, `10%` for basis points, and safe fallback labels when metadata is unavailable. Render every override as “市场名称 · 市场 ID · 币种金额” or “自动换算”.

- [ ] **Step 4: Run tests and production build**

Run: `node --test web/test/admin-presentation.test.mjs && npm run build && npm run check:worker`

Expected: PASS.

- [ ] **Step 5: Visual QA**

Run the local admin server and inspect `/overview`, `/campaigns/:id`, `/gdpr/customer-deletions` and `/gdpr/merchant-deletions` at 1440px, 768px and 390px.

Expected: installed list and desktop tables are readable; phone cards show all required values without overlap; no console errors; no new `:focus` CSS rules.

### Task 9: Cross-Worker Integration, Migration and Release Verification

**Repository:** both repositories

**Files:**
- Modify only files produced by Tasks 1-8.
- Modify: `docs/APP_PROGRESS.md` in the merchant repository only with actually verified pages and tests.

**Interfaces:**
- Consumes: all task outputs.
- Produces: a verified release candidate and an explicit deploy order.

- [ ] **Step 1: Execute complete test suites**

Run in the merchant repository:

```bash
npm --prefix worker test
npm --prefix worker run typecheck
npm --prefix worker run build
```

Run in the developer admin repository:

```bash
npm run test
npm run check:worker
npm run build
```

Expected: all commands exit `0`.

- [ ] **Step 2: Apply and verify migrations in non-production first**

```bash
npx wrangler d1 migrations apply shopline-quantity-breaks --local --config worker/wrangler.toml
npx wrangler d1 migrations apply kaching-developer-admin --local --config wrangler.toml
```

Expected: both D1 schemas include the expected migrations. Inspect GDPR task table and existing admin tables without deleting production data.

- [ ] **Step 3: Verify cross-binding contracts with fixtures**

```ts
expect(await adminWorker.fetch(ownerGet('/admin-api/v1/gdpr/merchant-tasks?limit=25&offset=0'), adminEnv, ctx)).toHaveProperty('status', 200);
expect(merchantInternalRequest.headers.get('x-admin-signature')).toMatch(/^[a-f0-9]{64}$/);
```

Confirm unsigned browser-originated calls to either private endpoint fail, while signed binding requests work. Confirm a completed merchant GDPR task no longer appears in Overview's installed list or campaigns source.

- [ ] **Step 4: Prepare deployment order and rollback boundary**

1. Apply merchant D1 migration and deploy merchant Worker with public GDPR endpoints and `DEVELOPER_ADMIN` binding.
2. Apply developer-admin D1 migration only if Task 4 requires one, deploy its private endpoint and GDPR UI.
3. Invoke the two configured SHOPLINE callbacks in a development store and confirm empty `200` plus idempotency.
4. If the developer-admin deployment fails after merchant deployment, leave GDPR tasks retrying; do not disable the public GDPR callback or delete task rows. Restore the previous developer-admin Worker version, then retry pending tasks.

- [ ] **Step 5: Git review and explicit approval gate**

For each repository, run `git status --short`, `git diff --check`, inspect staged files for secrets, and present only the reviewed files and proposed commit message. Ask exactly: `本次代码/文档已在本地更新，是否推送到 GitHub？` Do not commit, push or deploy until the user explicitly approves that completed change set.

## Plan Self-Review

- GDPR callback receipt, safe persistence, retry, thirty-day cleanup, customer no-op and merchant redaction are covered by Tasks 1-3 and 6.
- Private admin audit cleanup, Owner/CSRF restrictions and safe GDPR projection are covered by Task 4.
- SHOPLINE market metadata, cache, admin headers, shop currency and strict activity projection are covered by Task 5.
- GDPR navigation/pages and confirmed Chinese activity labels, normal-currency values, market labels, independent Overview stores list and CSS width removal are covered by Tasks 7-8.
- Full test, local migration, integration, browser, deployment order and explicit Git approval checks are covered by Task 9.
- No implementation step uses a broad delete target, an unrestricted source projection, a raw GDPR payload, an unauthenticated private endpoint, or a forced push.

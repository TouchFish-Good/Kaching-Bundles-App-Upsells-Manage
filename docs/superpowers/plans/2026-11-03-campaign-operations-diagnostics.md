# 活动运营与混合诊断实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在开发者管理后台提供商家活动查询、配置查看、Owner 紧急暂停，以及基于 D1 与 R2 的跨 Worker 诊断能力。

**Architecture:** 商家 Worker 的 D1 是活动和业务诊断的权威来源；管理后台只通过 `MERCHANT_APP` Service Binding 调用 HMAC 保护的 Owner 接口。两个 Worker 共享应用 trace ID，SHOPLINE 上游请求 ID（若响应明确返回）单独存储；D1 保存 30 天可检索事件，Cloudflare Logpush 将两个 Worker 的原始日志投递到 R2 并由 7 天生命周期规则删除。

**Tech Stack:** Cloudflare Workers、D1、R2、Logpush、Hono、TypeScript、React 18、Vite、Vitest、Node test。

**Spec:** `docs/superpowers/specs/2026-11-03-campaign-operations-diagnostics-design.md`

## Global Constraints

- 商家 D1 是活动与诊断事实的唯一来源；管理后台不得绑定商家 D1。
- 所有跨 Worker 请求使用 `ADMIN_INTERNAL_SECRET`、时间戳、nonce 和方法/路径签名；trace ID 也必须防篡改传递。
- 所有后台写请求要求唯一 Owner 会话与 `x-csrf-token`。
- `traceId` 是本应用链路 ID；`upstreamRequestId` 仅在 SHOPLINE 明确返回时记录，不能伪造。
- 不保存 access token、refresh token、Cookie、Authorization、请求正文或完整上游响应正文。
- 活动暂停必须携带 `expectedRevision`，只允许暂停 `active` 或 `scheduled` 活动；冲突或不确定结果不能报告成功。
- D1 诊断事件保留 30 天；R2 原始日志保留 7 天；清理任务与生命周期规则必须可验证。
- 所有后台新增文案使用中文；不新增或修改 CSS `:focus`、`:focus-visible` 规则。
- Logpush 字段必须以当前 Cloudflare 账户实际支持的日志源为准，不能假设自定义响应头可被采集。

## Review Focus

- 商家已更新 revision 后，旧的 Owner 暂停请求必须返回冲突且不能删除 SHOPLINE 折扣；Task 2 测试版本冲突。
- SHOPLINE 删除结果不确定时，活动不能变成 `paused`，且诊断 outcome 必须为 `uncertain`；Task 2 测试不确定分支。
- 请求头携带恶意或非 UUID `X-Trace-Id` 时必须生成新的应用 trace ID，不能把任意值写入签名或 D1；Task 1 测试输入校验。
- 上游返回包含 token、Cookie 或长正文时，D1 事件和管理 API 必须只留下白名单字段；Task 1 与 Task 3 测试投影。
- D1 清理与 R2 生命周期配置缺失时，后台必须显示原始日志不可用而不影响活动读取/暂停；Task 5 验收测试与检查脚本。

### Task 1: 诊断事件、trace ID 与保留清理

**Files:**
- Create: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/migrations/0010_campaign_diagnostics.sql`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/src/db/migrate.ts`
- Create: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/src/db/campaign-diagnostics.ts`
- Create: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/src/observability/trace.ts`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/src/env.ts`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/src/index.ts`
- Test: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/test/campaign-diagnostics.test.ts`
- Test: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/test/trace.test.ts`

**Interfaces:**
- Produces `createTraceId(request): string`, `traceIdFromRequest(request): string`, `withTraceHeaders(response, traceId): Response`.
- Produces `D1CampaignDiagnostics.record(input): Promise<void>`, `list(filters): Promise<{ items; total }>` and `purgeExpired(now): Promise<number>`.
- Diagnostic item fields are `id`, `traceId`, `workerName`, `storeId`, `shopHandle`, `campaignId`, `eventType`, `outcome`, `upstreamService`, `upstreamPath`, `upstreamStatus`, `upstreamRequestId`, `errorCode`, `durationMs`, `occurredAt`.

- [ ] **Step 1: Write failing trace and retention tests**

```ts
it('rejects an invalid incoming trace id and creates a UUID', () => {
  expect(traceIdFromRequest(new Request('https://app.test', { headers: { 'X-Trace-Id': 'not-a-uuid' } }))).toMatch(UUID_PATTERN);
});

it('purges only diagnostics older than the 30-day expiry boundary', async () => {
  const now = Date.parse('2026-11-03T00:00:00.000Z');
  const old = now - 31 * 24 * 60 * 60 * 1000;
  await diagnostics.record({ traceId: '550e8400-e29b-41d4-a716-446655440000', eventType: 'worker_error', outcome: 'failure', occurredAt: old, expiresAt: old });
  await expect(diagnostics.purgeExpired(now)).resolves.toBe(1);
});
```

- [ ] **Step 2: Run the focused tests and confirm the missing module/schema failure**

Run from the merchant Worker: `npx vitest run test/trace.test.ts test/campaign-diagnostics.test.ts`.

Expected: FAIL because trace utilities, the diagnostics table, and repository do not exist.

- [ ] **Step 3: Add the migration, repository, trace helpers, and fetch/scheduled wiring**

Create `campaign_diagnostic_events` with indexes for `trace_id`, `(store_id, occurred_at)`, `(campaign_id, occurred_at)`, and `expires_at`. Add `traceId` to the request context through Hono middleware, return `X-Trace-Id`, and use `purgeExpired` from the 5-minute scheduled branch. Record only normalized upstream metadata and error codes.

- [ ] **Step 4: Run focused tests and Worker type/module checks**

Run: `npx vitest run test/trace.test.ts test/campaign-diagnostics.test.ts && npm run typecheck && npm run test:module-boundaries`.

Expected: PASS with no secrets or request bodies in stored rows.

- [ ] **Step 5: Commit**

```sh
git add worker/migrations/0010_campaign_diagnostics.sql worker/src/db/migrate.ts worker/src/db/campaign-diagnostics.ts worker/src/observability/trace.ts worker/src/env.ts worker/src/index.ts worker/test/campaign-diagnostics.test.ts worker/test/trace.test.ts
git commit -m "feat(diagnostics): add trace events and retention cleanup"
```

### Task 2: 商家活动 Owner 读取与紧急暂停接口

**Files:**
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/src/auth/internal-request.ts`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/src/db/campaigns.ts`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/src/routes/internal-admin.ts`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/src/services/discounts.ts`
- Test: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/test/internal-campaign-admin.test.ts`

**Interfaces:**
- Consumes Task 1 trace and diagnostics APIs, `D1SessionStore.getActiveStoreIdentity`, `D1CampaignRepository.list/get/getPublication/beginPublication/finishPublication/markPublicationFailure`, and existing `deleteAutomaticDiscount`.
- Produces signed `GET /internal/admin-read/v1/stores/:storeId/campaigns`, signed `GET /internal/admin-read/v1/stores/:storeId/campaigns/:id`, signed `POST /internal/admin/v1/stores/:storeId/campaigns/:id/pause`.
- HMAC canonical message becomes `METHOD\nPATH\nTIMESTAMP\nNONCE\nTRACE_ID`; Admin and merchant implementations must change together.

- [ ] **Step 1: Write failing route tests**

```ts
it('returns campaign summaries for an installed store without access tokens', async () => {
  const response = await signedGet('/internal/admin-read/v1/stores/42/campaigns', '550e8400-e29b-41d4-a716-446655440000');
  await expect(response.json()).resolves.toMatchObject({ data: { items: [expect.objectContaining({ id: 'campaign-1', status: 'active', revision: 3 })] } });
});

it('rejects a stale emergency pause revision without calling SHOPLINE', async () => {
  const response = await signedPost('/internal/admin/v1/stores/42/campaigns/campaign-1/pause', { expectedRevision: 2, reason: '紧急排障' }, '550e8400-e29b-41d4-a716-446655440000');
  expect(response.status).toBe(409);
  expect(deleteDiscountMock).not.toHaveBeenCalled();
});

it('records an uncertain upstream pause and does not return success', async () => {
  globalThis.fetch = async () => new Response('', { status: 504 });
  const response = await signedPost('/internal/admin/v1/stores/42/campaigns/campaign-1/pause', { expectedRevision: 3 }, '550e8400-e29b-41d4-a716-446655440000');
  expect(response.status).toBe(503);
  await expect(repository.get('shop', 'campaign-1')).resolves.toMatchObject({ status: 'active' });
});
```

- [ ] **Step 2: Run tests and verify missing routes/signature behavior fails**

Run: `npm test -- test/internal-campaign-admin.test.ts`.

Expected: FAIL because campaign Owner routes and trace-aware signatures do not exist.

- [ ] **Step 3: Implement canonical trace-aware authorization and campaign projections**

Resolve `storeId` to an installed session handle, project campaign JSON to safe fields (`id`, `name`, `status`, `revision`, `scope`, `tiers`, `startsAt`, `endsAt`, `pauseReason`, `updatedAt`) and never return encrypted session columns. Add `pause` orchestration with revision checking, publication lease, `deleteAutomaticDiscount`, collection cleanup, failure classification (`failure`/`uncertain`), and D1 diagnostics for each upstream call.

- [ ] **Step 4: Run route tests, typecheck, module boundaries, and the full Worker suite**

Run: `npm test && npm run typecheck && npm run test:module-boundaries`.

Expected: all existing tests plus campaign Owner tests pass. If the existing Cloudflare Vitest fake-timer error still blocks collection, record the exact failure and do not call the D1 suite passing.

- [ ] **Step 5: Commit**

```sh
git add worker/src/auth/internal-request.ts worker/src/db/campaigns.ts worker/src/routes/internal-admin.ts worker/src/services/discounts.ts worker/test/internal-campaign-admin.test.ts
git commit -m "feat(campaigns): add signed owner reads and emergency pause"
```

### Task 3: 管理后台活动/诊断代理与投影

**Files:**
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/worker/internal/merchant-client.ts`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/worker/source-projection.ts`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/worker/routes/admin-api.ts`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/worker/env.ts`
- Test: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/worker/test/campaign-admin-api.test.ts`

**Interfaces:**
- Consumes Task 2 signed endpoints and existing `AdminStore.audit`.
- Produces Owner-only browser APIs: `GET /campaigns`, `GET /campaigns/:id`, `POST /campaigns/:id/pause`, `GET /diagnostics`.
- All merchant calls sign `METHOD\nPATH\nTIMESTAMP\nNONCE\nTRACE_ID`; response projection returns only the campaign/diagnostic allowlists.

- [ ] **Step 1: Write failing proxy tests**

```ts
it('requires CSRF for emergency pause and writes a success audit', async () => {
  expect((await loggedInFetch('/admin-api/v1/campaigns/campaign-1/pause', { method: 'POST' })).status).toBe(403);
  const response = await ownerFetch('/admin-api/v1/campaigns/campaign-1/pause', csrf, { method: 'POST', body: JSON.stringify({ expectedRevision: 3 }) });
  expect(response.status).toBe(200);
  expect(await latestAuditAction()).toBe('campaign.pause_succeeded');
});

it('maps a malformed merchant campaign response to SOURCE_UNAVAILABLE', async () => {
  merchant.fetch = async () => new Response(JSON.stringify({ data: { accessToken: 'secret', items: [] } }));
  expect((await loggedInFetch('/admin-api/v1/campaigns')).status).toBe(503);
});
```

- [ ] **Step 2: Run the proxy tests and confirm they fail**

Run: `npm run test:worker -- worker/test/campaign-admin-api.test.ts`.

Expected: FAIL because the browser routes and trace-aware client are missing.

- [ ] **Step 3: Implement signed calls, strict projections, CSRF, and audit mappings**

Extend the shared merchant client with trace-aware `internalGet`, `internalPost`, and `internalDelete` helpers. Validate IDs, revision, reason length, pagination and date filters. Map merchant `401`, `409`, malformed responses, timeouts, and upstream failures to safe public codes; audit sensitive reads and all pause outcomes without recording secrets.

- [ ] **Step 4: Run management tests and checks**

Run: `npm run test:worker && npm run check:worker && npm run build`.

Expected: PASS, including trace header/signature assertions and field allowlist assertions.

- [ ] **Step 5: Commit**

```sh
git add worker/internal/merchant-client.ts worker/source-projection.ts worker/routes/admin-api.ts worker/env.ts worker/test/campaign-admin-api.test.ts
git commit -m "feat(admin): proxy campaign operations and diagnostics"
```

### Task 4: 中文活动与排障工作台

**Files:**
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/web/src/api.ts`
- Create: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/web/src/campaigns.tsx`
- Create: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/web/src/diagnostics.tsx`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/web/src/App.tsx`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/web/src/styles.css`
- Create: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/worker/test/campaign-presentation.test.mjs`

**Interfaces:**
- Consumes Task 3 browser APIs and existing `api`, `ApiError`, `absoluteTime`, loading/error/table patterns.
- Produces `/campaigns`, `/campaigns/:id`, and `/diagnostics` pages with Chinese labels and no mock data.

- [ ] **Step 1: Write failing presentation tests**

```js
test('renders emergency pause as a destructive action and keeps uncertain status visible', () => {
  assert.deepEqual(campaignStatus({ status: 'active', diagnosticOutcome: 'uncertain' }), { label: '启用', tone: 'warning' });
  assert.equal(canPauseCampaign({ status: 'paused' }), false);
});
```

- [ ] **Step 2: Run the test and confirm the mapping module is missing**

Run: `node --test worker/test/campaign-presentation.test.mjs`.

Expected: FAIL because campaign presentation helpers do not exist.

- [ ] **Step 3: Implement list/detail/diagnostics pages**

Use dense existing table patterns with filters for handle/store ID, status, abnormal outcome, date and trace ID. Detail shows scope, products/collections, tiers, revision, upstream request ID when present, and safe errors. Pause uses an accessible confirmation dialog, displays the current revision, disables repeat submission, refreshes after success, and clearly separates `暂停成功` from `结果待确认`.

- [ ] **Step 4: Run presentation test, build, and browser QA**

Run: `node --test worker/test/campaign-presentation.test.mjs && npm run build`.

Start the local app and capture desktop `1440x900` and mobile `390x844` screenshots for campaign list, campaign detail, pause confirmation, and diagnostics. Verify no overflow, trace IDs wrap safely, and no new `:focus`/`:focus-visible` CSS rules are introduced.

- [ ] **Step 5: Commit**

```sh
git add web/src/api.ts web/src/campaigns.tsx web/src/diagnostics.tsx web/src/App.tsx web/src/styles.css worker/test/campaign-presentation.test.mjs
git commit -m "feat(admin-ui): add campaigns and diagnostics workspace"
```

### Task 5: Cloudflare R2/Logpush 配置与最终验收

**Files:**
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/wrangler.toml`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/README.md`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/docs/DEVELOPER_ADMIN_PROGRESS.md`
- Create: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/docs/DIAGNOSTICS_OPERATIONS.md`
- Create: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/scripts/verify-diagnostics-resources.mjs`

**Interfaces:**
- Consumes Tasks 1-4 and the Cloudflare account's actual R2/Logpush capabilities.
- Produces a documented R2 binding/lifecycle check, two Logpush jobs with separate prefixes when supported, and a truthful acceptance report.

- [ ] **Step 1: Add resource verification tests/checks before configuration**

The verification script must query/list resources without exposing secrets and fail with an actionable Chinese message when the bucket, lifecycle rule, or Logpush job is missing. It must treat unavailable Logpush as a degraded diagnostic capability, not as a successful configuration.

- [ ] **Step 2: Run the resource check against the current account**

Run: `node scripts/verify-diagnostics-resources.mjs`.

Expected: report current plan capability, R2 bucket/lifecycle state, and both Worker Logpush jobs; no resource is created implicitly.

- [ ] **Step 3: Create/configure Cloudflare resources only after account capability is confirmed**

Create or reuse the dedicated R2 bucket, configure 7-day expiration, and configure one Logpush job per Worker with separate prefixes. Add the R2 binding only if the app needs object metadata; keep the browser API on D1 diagnostics. Never place tokens or request bodies in logs.

- [ ] **Step 4: Run full cross-repository verification and real smoke test**

Merchant Worker: `npm test && npm run typecheck && npm run test:module-boundaries && npm run build`.

Admin Worker: `npm run test:worker && npm run check:worker && npm run build`.

Smoke test with a real test merchant: list a draft/active campaign, inspect tiers and scope, pause an active campaign, confirm SHOPLINE discount removal and merchant storefront behavior, then query the same application trace ID in diagnostics and verify Owner audit entries. Do not mark production validation complete if the real merchant or Logpush entitlement is unavailable.

- [ ] **Step 5: Commit documentation/configuration and request separate push approval**

```sh
git add wrangler.toml README.md docs/DEVELOPER_ADMIN_PROGRESS.md docs/DIAGNOSTICS_OPERATIONS.md scripts/verify-diagnostics-resources.mjs
git commit -m "docs(operations): document campaign diagnostics and retention"
```

## Final Review Checklist

- [ ] Every spec requirement maps to a task and test.
- [ ] No task returns raw merchant data, tokens, or unbounded logs.
- [ ] Stale revisions, uncertain upstream outcomes, trace tampering, and retention cleanup have explicit tests.
- [ ] Merchant and admin repositories are reviewed and pushed separately only after explicit approval.
- [ ] Deployments happen in order: merchant migration, merchant Worker, admin Worker, then smoke test.

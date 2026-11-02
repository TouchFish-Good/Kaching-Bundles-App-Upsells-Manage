# 需求与建议运营 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让唯一 Owner 在开发者管理后台安全地运营商家应用中的真实建议与评论，包括审核、官方回复、拒绝显示和评论删除。

**Architecture:** 商家应用的 App D1 继续保存建议、评论和内容治理事实；商家 Worker 增加经过 HMAC 签名保护的 Owner 读取和写入接口。开发者管理后台只通过 `MERCHANT_APP` Service Binding 调用这些接口，验证 Owner/CSRF 后投影响应并写入自己的审计表；React 管理页面以这些真实接口渲染队列和详情。

**Tech Stack:** Cloudflare Workers、D1、Hono、TypeScript、React 18、Vite、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-02-feedback-operations-design.md`

## Global Constraints

- 商家 App D1 是反馈业务数据唯一权威来源；Admin Worker 不得绑定或直连商家 D1。
- 全部跨 Worker 调用使用既有 `ADMIN_INTERNAL_SECRET`、HMAC、时间戳和 nonce；不得新增浏览器可见密钥。
- 管理后台只有一个 Owner，所有写操作验证会话与 `x-csrf-token`。
- 匿名仅影响商家公开身份；Owner 读取必须获得真实 `handle` 和匿名标记。
- `拒绝显示` 持久化为 `status = rejected`、`visibility = hidden`、`hidden_reason = owner_rejected_display`，而不是新的商家公开状态枚举。
- 评论删除为软删除，不提供恢复；商家端不得返回已删除评论。
- 不新增或修改 CSS 的 `:focus`、`:focus-visible` 或相关焦点伪类规则。
- 所有 Owner 可见文案为中文；不使用模拟建议、评论或商家数据。
- 两个仓库分别提交和推送；每个完成的变更集都须先取得用户明确推送确认。

## Review Focus

- 已被 Owner 拒绝显示的建议仍可被作者自己的“我的建议”、详情、投票或评论接口读取。
- 匿名建议或匿名评论的真实 `handle` 从商家公共 API 泄露给其他商家。
- 删除评论后公共详情仍返回评论内容或数量不一致。
- 请求体伪造官方身份、隐藏模式或跨建议评论 ID 时被接口接受。
- Admin Worker 在商家 Worker 修改失败或审计失败时仍向浏览器报告成功。

### Task 1: 商家 D1 内容治理与 Owner 查询仓储

**Files:**
- Create: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/migrations/0009_feedback_comment_moderation.sql`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/src/db/feedback.ts`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/src/domain/feedback.ts`
- Test: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/test/feedback-repository.test.ts`
- Test: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/test/migrations.test.ts`

**Interfaces:**
- Consumes: `feedback_requests`, `feedback_comments`, `feedback_status_history`, `feedback_admin_audit_logs` 与现有 `D1FeedbackRepository`。
- Produces: `listForOwner(filters)`, `readDetailForOwner(id)`, `updateStatus({ requestId, status, hideFromMerchants, note })`, `deleteComment({ requestId, commentId, reason })`。

- [ ] **Step 1: 写 Owner 可见性与评论删除的失败测试**

```ts
it('hides an owner-rejected suggestion from its author and public readers but retains it for the Owner', async () => {
  const feedback = await repository.createSuggestion({ storeId: 'shop-1', handle: 'alpha', title: 'Spam', content: '...', idempotencyKey: 'idempotency-1' });
  await repository.updateStatus({ requestId: feedback.id, status: 'rejected', hideFromMerchants: true, note: '违规内容' });

  await expect(repository.readDetailForViewer(feedback.id, 'shop-1')).resolves.toBeNull();
  await expect(repository.listForViewer('shop-1', { mine: true })).resolves.toMatchObject({ items: [] });
  await expect(repository.readDetailForOwner(feedback.id)).resolves.toMatchObject({ handle: 'alpha', displayStatus: 'rejected_hidden' });
});

it('removes a deleted comment from merchant detail while retaining it for the Owner', async () => {
  const comment = await repository.createComment({ requestId: feedbackId, storeId: 'shop-2', handle: 'beta', isAnonymous: true, content: 'abuse' });
  await repository.deleteComment({ requestId: feedbackId, commentId: comment!.id, reason: '人身攻击' });

  await expect(repository.readDetailForViewer(feedbackId, 'shop-1')).resolves.not.toMatchObject({ comments: [expect.objectContaining({ id: comment!.id })] });
  await expect(repository.readDetailForOwner(feedbackId)).resolves.toMatchObject({ comments: [expect.objectContaining({ id: comment!.id, isDeleted: true, authorHandle: 'beta', isAnonymous: true })] });
});
```

- [ ] **Step 2: 运行失败测试并确认当前实现不满足行为**

Run in `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker`: `npm test -- test/feedback-repository.test.ts test/migrations.test.ts`

Expected: FAIL，缺少 Owner 查询、`hideFromMerchants` 和 `deleteComment` 方法，且现有作者读取仍可见隐藏建议。

- [ ] **Step 3: 编写最小迁移和仓储实现**

```sql
ALTER TABLE feedback_comments ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'hidden'));
ALTER TABLE feedback_comments ADD COLUMN deleted_at TEXT;
ALTER TABLE feedback_comments ADD COLUMN deleted_by_admin_id TEXT;
ALTER TABLE feedback_comments ADD COLUMN deletion_reason TEXT;
CREATE INDEX idx_feedback_comments_visibility ON feedback_comments (request_id, visibility, created_at ASC, id ASC);
```

在 `D1FeedbackRepository` 中：

- 创建 `OwnerFeedbackSummary` 和 `OwnerFeedbackDetail`，始终带 `storeId`、`handle`、`isAnonymous`、`hiddenReason`、`displayStatus`、状态历史与删除评论元数据。
- `updateStatus` 仅在 `hideFromMerchants === true && status === 'rejected'` 时写入 `owner_rejected_display` 和 hidden；普通拒绝仍公开。
- 公共读取条件同时排除 `withdrawn_by_submitter` 与 `owner_rejected_display`；公开评论查询限制 `visibility = 'public'`。
- `deleteComment` 只在评论属于请求 ID 时把评论设为 hidden，写删除时间、`developer-platform` 和原因，并追加 `feedback_admin_audit_logs`。
- 将建议状态改变、拒绝显示和评论删除分别写入反馈审计日志；更新或删除未变更时返回 `null`/`false`。

- [ ] **Step 4: 运行仓储与迁移测试确认通过**

Run in `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker`: `npm test -- test/feedback-repository.test.ts test/migrations.test.ts`

Expected: PASS，且测试断言匿名作者只会在 Owner 查询中暴露真实 `handle`。

### Task 2: 商家 Worker 的签名 Owner 反馈接口

**Files:**
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/src/routes/internal-admin.ts`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/src/routes/feedback-admin.ts`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/src/index.ts` only if registration needs an explicit new route module
- Test: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/test/feedback-admin-routes.test.ts`
- Test: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker/test/internal-admin-routes.test.ts`

**Interfaces:**
- Consumes: Task 1 repository API and existing `authorizeInternalRequest` HMAC/replay guard.
- Produces: signed `GET /internal/admin-read/v1/feedback`, `GET /internal/admin-read/v1/feedback/:id`, `PATCH /internal/admin/v1/feedback/:id/status`, `POST /internal/admin/v1/feedback/:id/replies`, `DELETE /internal/admin/v1/feedback/:id/comments/:commentId`.

- [ ] **Step 1: 写接口层失败测试**

```ts
it('returns the real handle and anonymous marker only to a signed Owner list request', async () => {
  const response = await worker.fetch(await signedRequest('/internal/admin-read/v1/feedback?status=pending&limit=25&offset=0', undefined, nonce, 'GET'), testEnv, context);
  await expect(response.json()).resolves.toMatchObject({ data: { items: [expect.objectContaining({ handle: 'alpha', isAnonymous: true })] } });
});

it('requires a signed non-replayed request to delete a comment', async () => {
  const first = await worker.fetch(await signedRequest(`/internal/admin/v1/feedback/${feedbackId}/comments/${commentId}`, { reason: '人身攻击' }, nonce, 'DELETE'), testEnv, context);
  const replay = await worker.fetch(await signedRequest(`/internal/admin/v1/feedback/${feedbackId}/comments/${commentId}`, { reason: '人身攻击' }, nonce, 'DELETE'), testEnv, context);
  expect(first.status).toBe(200);
  expect(replay.status).toBe(401);
});
```

- [ ] **Step 2: 运行接口测试确认失败**

Run in `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker`: `npm test -- test/feedback-admin-routes.test.ts test/internal-admin-routes.test.ts`

Expected: FAIL，反馈 Owner 读取路由与评论 DELETE 路由尚不存在。

- [ ] **Step 3: 实现参数校验、投影和写入路由**

实现以下精确规则：

- GET 列表接受 `query`（最大 100 字符）、`status`、`display`（`visible`/`rejected_hidden`/`withdrawn`）、`store`、`from`、`to`、`limit`（1-100）和 `offset`（0-100000）；无效值返回 `422 INVALID_*`。
- GET 详情返回 Owner 所需的全文、真实建议/评论 `handle`、匿名标记、状态历史、撤回元数据、官方回复和已删除评论元数据。
- PATCH 请求体为 `{ status, hideFromMerchants?: boolean, note?: string }`；`hideFromMerchants` 只允许与 `status: 'rejected'` 同时使用，否则返回 `422 INVALID_DISPLAY_MODE`。
- POST 回复沿用仓储固定的“多件折扣”身份；不接受任何身份、头像或 `isOfficial` 覆盖字段。
- DELETE 评论请求体可选 `{ reason?: string }`，长度为 1-500；跨建议评论 ID、已删除评论或不存在记录返回 404。
- 每条路由先调用既有 HMAC 授权和 nonce 重放检查，且不把异常堆栈返回给调用方。

- [ ] **Step 4: 运行商家 Worker 全量验证**

Run in `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/worker`: `npm test && npm run typecheck && npm run test:module-boundaries`

Expected: PASS；至少包括签名、重放、筛选、隐藏建议、官方身份及评论删除断言。

### Task 3: 开发者管理 Worker 代理、投影和审计

**Files:**
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/worker/internal/merchant-client.ts`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/worker/source-projection.ts`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/worker/routes/admin-api.ts`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/worker/test/source-boundary.test.ts`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/worker/test/auth-routes.test.ts`

**Interfaces:**
- Consumes: Task 2 signed merchant endpoints and existing `AdminStore.audit`.
- Produces: Owner-only browser endpoints `/feedback`, `/feedback/:id`, `/feedback/:id/status`, `/feedback/:id/replies`, `/feedback/:id/comments/:commentId`.

- [ ] **Step 1: 写失败的代理边界与 CSRF 测试**

```ts
it('signs a feedback status change, requires CSRF, and audits the Owner action', async () => {
  const forbidden = await loggedInFetch('/admin-api/v1/feedback/request-1/status', { method: 'PATCH', body: JSON.stringify({ status: 'approved' }) });
  expect(forbidden.status).toBe(403);

  const success = await loggedInFetch('/admin-api/v1/feedback/request-1/status', { method: 'PATCH', headers: { 'x-csrf-token': csrfToken }, body: JSON.stringify({ status: 'approved' }) });
  expect(success.status).toBe(200);
  expect(await latestAuditAction()).toBe('feedback.status_changed');
});

it('projects only approved Owner feedback fields and maps a merchant failure to SOURCE_UNAVAILABLE', async () => {
  merchant.fetch = async () => new Response(JSON.stringify({ data: { accessToken: 'secret', items: [] } }));
  await expect(loggedInFetch('/admin-api/v1/feedback')).resolves.toHaveProperty('status', 503);
});
```

- [ ] **Step 2: 运行新增测试确认失败**

Run: `npm run test:worker -- worker/test/source-boundary.test.ts worker/test/auth-routes.test.ts`

Expected: FAIL，当前 client 只支持 GET，且没有反馈浏览器路由、CSRF 写校验或响应投影。

- [ ] **Step 3: 实现通用签名请求与 Owner API**

在 `merchant-client.ts` 将现有 GET 实现提取为内部通用方法，使用精确的 `METHOD\nPATH\nTIMESTAMP\nNONCE` 签名，支持 JSON body 的 `PATCH`、`POST`、`DELETE`，保留 5 秒超时。为写入端点增加：

- `requireOwner` 与 `x-csrf-token` 检查。
- 请求 ID、状态、comment ID、文本长度和筛选边界校验。
- 成功时写 `AdminStore.audit`：`feedback.status_changed`、`feedback.reply_created`、`feedback.comment_deleted`；读取详情仍作为敏感读取审计。
- 任何 merchant `401`、非白名单响应、超时或审计失败映射为安全错误，不向浏览器透传内部响应。

在 `source-projection.ts` 为列表、详情和写结果增加严格运行时字段投影，确保匿名真实 `handle` 仅在 Owner 认证后的路径出现。

- [ ] **Step 4: 运行管理 Worker 测试和类型检查**

Run: `npm run test:worker && npm run check:worker`

Expected: PASS，且新测试覆盖签名方法、CSRF、审计、字段白名单和 source failure。

### Task 4: 中文“需求与建议”运营界面

**Files:**
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/web/src/api.ts`
- Create: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/shared/feedback-presentation.mjs`
- Create: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/shared/feedback-presentation.d.mts`
- Create: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/web/src/feedback.tsx`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/web/src/App.tsx`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/web/src/styles.css`
- Test: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/worker/test/feedback-presentation.test.mjs`

**Interfaces:**
- Consumes: Task 3 browser APIs and existing `api<T>()`, `ApiError`, `absoluteTime`, responsive table patterns.
- Produces: `/feedback` list route and `/feedback/:id` detail route with owner actions.

- [ ] **Step 1: 写列表状态映射与操作可用性的失败测试**

```ts
it('maps a hidden rejection to the Chinese 拒绝显示 badge and disables merchant-facing actions for withdrawn items', () => {
  expect(displayStatus({ status: 'rejected', displayStatus: 'rejected_hidden' })).toEqual({ label: '拒绝显示', tone: 'danger' });
  expect(canChangeStatus({ displayStatus: 'withdrawn' })).toBe(false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test worker/test/feedback-presentation.test.mjs`

Expected: FAIL，原因是共享状态映射模块尚不存在。

- [ ] **Step 3: 实现无模拟数据的工作台**

先实现 `shared/feedback-presentation.mjs` 的 `displayStatus()` 和 `canChangeStatus()`，再让 `web/src/feedback.tsx` 调用它。实现具体交互：

- 侧栏新增“需求与建议”，默认 URL 为 `/feedback?status=pending`。
- 过滤工具栏含关键词、状态/生命周期、商家、起止日期和搜索按钮；URL 查询参数保持筛选状态。
- 桌面表格与移动记录块均显示标题、摘要、真实 handle、店铺 ID、匿名标记、状态、创建时间、评论/回复计数。
- 详情中显示原始建议、状态历史、商家撤回信息、官方回复、评论及匿名标记；已删除评论以“已删除”状态显示给 Owner。
- 状态使用按钮组或菜单：批准、拒绝、标记开发中、标记已上线、拒绝显示；每次写入后刷新详情与列表。
- 官方回复为 textarea 和“发布官方回复”命令；评论删除使用垃圾桶图标按钮、确认对话框和可选原因输入。
- 使用既有 loading、error、empty 和 retry 模式；不新增焦点 CSS 规则。

- [ ] **Step 4: 构建并执行交互和视觉验收**

Run: `npm run build`

Expected: PASS。

启动本地 Admin Worker 与前端，使用 Playwright 在 1440x900 和 390x844 分别截取：待审核队列、匿名建议详情、拒绝显示建议、官方回复和已删除评论。保存参考截图与本地截图到项目既有 QA 目录，并确认筛选、状态更新、回复和评论删除不会造成布局重叠或文本溢出。

### Task 5: 文档、远程部署与跨 Worker 验收

**Files:**
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New/bundles-app-upsells-new/README.md` only if its deployment instructions require the feedback migration update
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/README.md`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/docs/DEVELOPER_ADMIN_PROGRESS.md`
- Modify: `/Users/SL/Desktop/Kaching Bundles App & Upsells New开发者管理后台/docs/DEVELOPER_ADMIN_ACCEPTANCE_REPORT.md`

**Interfaces:**
- Consumes: Tasks 1-4 and the existing Cloudflare D1/Worker deployments.
- Produces: evidence-backed operational status and a deployed signed integration.

- [ ] **Step 1: 更新文档失败条件与验收记录**

在文档中明确：商家 Worker 必须先部署并完成其 App D1 迁移，随后部署 Admin Worker；未完成真实店铺联调不得标记为生产数据验收通过。

- [ ] **Step 2: 执行两个仓库的完整验证**

Run in merchant app Worker directory: `npm test && npm run typecheck && npm run test:module-boundaries && npm run build`

Run in merchant app Web directory: `npm run test:prototype && npm run build`

Run in admin app: `npm run test:worker && node --test worker/test/bootstrap-owner.test.mjs worker/test/reset-owner-password.test.mjs worker/test/no-node-runtime.test.mjs && npm run check:worker && npm run build && git diff --check`

Expected: 所有命令退出码为 0；任何 Node/Vite 版本告警记录在验收报告中但不伪装为失败通过。

- [ ] **Step 3: 先部署商家应用，再部署管理后台**

使用各自仓库现有 Wrangler 配置：先应用商家 App D1 migration `0009_feedback_comment_moderation.sql` 并部署 `shopline-quantity-breaks`，再构建和部署 `kaching-developer-admin`。部署前确认两个 Worker 的 `ADMIN_INTERNAL_SECRET` 保持相同，管理后台的 `MERCHANT_APP` binding 仍指向 `shopline-quantity-breaks`。

- [ ] **Step 4: 运行真实跨 Worker 冒烟验收**

用真实测试店提交一条匿名建议和匿名评论；在 `https://admin.vswwy.cn` 以 Owner 登录并确认：

1. 队列显示真实 handle 与匿名标记。
2. 官方回复在商家应用只显示“多件折扣”和官方头像。
3. “拒绝显示”后提交商家与其他商家均无法读取建议。
4. 删除评论后商家详情不再显示评论，Owner 详情显示已删除状态。
5. Admin D1 审计页能找到相应的请求 ID 与结果。

- [ ] **Step 5: 分别请求两个仓库的 Git 推送批准**

分别检查商家应用和开发者管理后台的 `git status`、未跟踪文件、暂存差异和敏感信息；按仓库提供文件清单、拟提交信息与验证结果。取得针对该变更集的明确“推送”确认后，先推送商家应用仓库 `https://github.com/TouchFish-Good/Kaching-Bundles-App-Upsells.git` 的当前分支，再推送管理后台仓库 `https://github.com/TouchFish-Good/Kaching-Bundles-App-Upsells-Manage.git` 的 `main`。不使用 force push。

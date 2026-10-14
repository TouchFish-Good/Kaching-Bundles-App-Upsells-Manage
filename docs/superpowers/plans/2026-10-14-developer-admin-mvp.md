# Developer Admin Console MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an independently authenticated, read-only internal console that reports real SHOPLINE installation data and sanitized errors, while clearly marking unavailable Bundle data.

**Architecture:** The merchant Express service owns installation and application-event records and exposes a signed internal read API. A separate admin Express service owns administrator accounts, MFA, sessions and audit records, and serves a React console. Both use separate local SQLite databases during development; production database and deployment are gated by the architecture's operational decisions.

**Tech Stack:** Node 22, TypeScript, Express, SQLite, React 18, Vite, lucide-react, Node test runner. Admin password hashing uses Argon2id via `argon2`; TOTP uses `otplib`.

**Spec:** `docs/DEVELOPER_ADMIN_REQUIREMENTS.md`, `docs/DEVELOPER_ADMIN_ARCHITECTURE.md`, `docs/DEVELOPER_ADMIN_API_SPEC.md`, `docs/DEVELOPER_ADMIN_UI_SPEC.md`.

## Global Constraints

- The management console has independent administrator authentication and server-side RBAC.
- Business data is read-only; no merchant token or raw Webhook payload reaches the browser.
- A stable SHOPLINE store ID is required; handle is only a mutable search/display field.
- No prototype `campaignData` may be counted or presented as real activity.
- Sources that do not exist return an explicit unavailable state.
- Preserve existing merchant changes, including modified `shopline.app.toml`; do not push without approval.

## Review Focus

- A stale or duplicate uninstall Webhook must not create an incorrect current installation state.
- A guessed store ID or another store's bundle ID must not expose a record.
- Logging and API errors must not leak access tokens, cookies or raw payloads.
- An expired or disabled admin session must fail immediately, including a previously loaded page's next request.
- A failed internal data source must show unavailable rather than a plausible zero.

---

### Task 1: Merchant installation registry and sanitized events

**Files:** Modify `../Kaching Bundles App & Upsells New/bundles-app-upsells-new/app/src/shopline.ts` and Webhook controller; create focused registry and tests under `app/src/admin-read/` and `app/test/`.

**Interfaces:** `recordInstallation({storeId,handle,scope,at})`, `recordUninstallation({handle,webhookId,at})`, `listStores(filters)`, `getStore(id)`, `recordError(event)`, `listErrors(filters)`.

- [ ] Write tests showing stable ID persistence, duplicate uninstall idempotence, unknown store handling, and no token/payload in stored events.
- [ ] Run the tests and observe feature-related failure.
- [ ] Implement SQLite tables and repository with parameterized queries; obtain stable ID from documented `GET /merchants/shop.json` during `afterAuth`. Mark sync errors without inventing an ID.
- [ ] Replace raw Webhook console logging/response echo with sanitized handling, keep SDK authentication, and record real error events.
- [ ] Run focused tests and merchant TypeScript build; record results in progress document.

### Task 2: Signed internal read API

**Files:** Create `app/src/admin-read/internal-api.ts`, `app/src/admin-read/signature.ts`, tests; modify `app/src/index.ts` before merchant `/api/*` middleware.

**Interfaces:** Signed `GET /internal/admin-read/v1/overview`, `/stores`, `/stores/:id`, `/stores/:id/bundles`, `/events/errors`.

- [ ] Write tests for valid/expired/altered signatures and unauthorized access.
- [ ] Run tests red; implement HMAC request signature with timestamp, nonce and short replay window.
- [ ] Write route tests for real installation counts, paginated search, sanitized errors and explicit `SOURCE_UNAVAILABLE` for Bundles.
- [ ] Implement read-only routes and bounded filters; verify tests and merchant build.

### Task 3: Independent administrator identity and audit

**Files:** Create target `package.json`, `server/db.ts`, `server/auth.ts`, `server/audit.ts`, `server/bootstrap.ts`, test files.

**Interfaces:** `POST /admin-api/v1/auth/login`, `POST /auth/mfa/verify`, `GET /auth/me`, `POST /auth/logout`, invite/disable Owner actions; `requireAdmin(role)` middleware.

- [ ] Write tests for password login, MFA, session expiry/revocation, Viewer denial and last Owner protection; run red.
- [ ] Implement separate SQLite auth/audit tables, Argon2id password hashes, TOTP enrollment, invitation-only Owner bootstrap, secure server-side cookie sessions, CSRF and rate limiting.
- [ ] Add audit for login, sensitive reads and account changes; test that audit failures block sensitive changes.
- [ ] Run identity suite and TypeScript build before next task.

### Task 4: Admin API gateway and source states

**Files:** Create `server/internal-client.ts`, `server/routes.ts`, `server/types.ts`, tests.

**Interfaces:** `GET /admin-api/v1/overview`, `/stores`, `/stores/:id`, `/bundles`, `/events/errors`, `/audit-events`; all responses include `requestId` and explicit source status.

- [ ] Write red tests for merchant Cookie rejection, role checks, source 503, bounded pagination, no token fields and correct store scoping.
- [ ] Implement signed internal client and admin routes; return `SOURCE_UNAVAILABLE` for unavailable Bundle source.
- [ ] Run API suite and TypeScript build; review response field whitelist.

### Task 5: React console and user flows

**Files:** Create `web/` Vite app in target, including shell, auth, Overview, Stores/detail, Bundles/unavailable, Errors, Audit, responsive CSS and tests.

**Interfaces:** Browser consumes only same-origin `/admin-api/v1`; query params preserve filters; all business values come from API.

- [ ] Write UI flow tests for login, navigation, store search, 503 source state and 403 display; observe red.
- [ ] Implement the confirmed UI spec with restrained visual tokens, dense tables, mobile record summaries, loading/empty/error states and accessible controls.
- [ ] Run UI tests, TypeScript build and Vite build; serve locally and inspect desktop/mobile screenshots and interaction.

### Task 6: Integration, gap audit and acceptance report

**Files:** Update `docs/DEVELOPER_ADMIN_PROGRESS.md`; create `docs/DEVELOPER_ADMIN_ACCEPTANCE_REPORT.md`.

- [ ] Run merchant and admin full tests/builds plus browser login/search/permission/error paths.
- [ ] Compare every MVP requirement ID with actual evidence; label PASS/FAIL/BLOCKED/NOT_TESTED, including stable ID and SHOPLINE live validation.
- [ ] Check no mock business data, no token leakage, no unusable commands, no unexpected source-repo changes.
- [ ] Start the admin dev server on an available port and report the URL; document production prerequisites and remaining external blockers.

## Execution decision

The user's staged brief explicitly authorized beginning real application development after UI/UX confirmation, which has now occurred. Execute this plan in the current session. The target project is already a separate workspace; preserve the source repository's unrelated modification. Do not push or deploy.

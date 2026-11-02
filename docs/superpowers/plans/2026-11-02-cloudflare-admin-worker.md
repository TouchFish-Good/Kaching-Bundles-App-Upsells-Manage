# Cloudflare 原生开发者管理后台实施计划

> **供代理执行：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务执行本计划。步骤使用复选框语法追踪。

**目标：** 将开发者管理后台从 Express、本地 SQLite 与原生依赖迁移为由 Cloudflare Worker、Admin D1 和 Service Binding 承载的同源 Web 应用，同时保持现有浏览器 API 契约。

**架构：** 新的 Admin Worker 直接提供 `web/dist` 资源和 `/admin-api/v1` 路由。Worker 仅绑定新的 `ADMIN_DB`，将经过 HMAC 签名的只读查询通过 `MERCHANT_APP` Service Binding 转发给商家 Worker；商家业务数据继续只保存在 App D1。认证会话、CSRF、审计与限流全部迁入 Admin D1。

**技术栈：** Cloudflare Workers、Workers Assets、D1、Service Binding、Hono、Web Crypto PBKDF2、TypeScript、Vitest Workers Pool、Vite、React。

**规格：** `docs/superpowers/specs/2026-11-02-cloudflare-worker-d1-design.md`

## 全局约束（Global Constraints）

- 管理后台 Worker 只能绑定 `ADMIN_DB`，不得绑定商家 App D1。
- `MERCHANT_APP` 必须调用同一 Cloudflare 账户的 `shopline-quantity-breaks` Worker；`ADMIN_INTERNAL_SECRET` 继续在两个 Worker 中配置为相同 Secret。
- 不创建公开注册、邀请、MFA、角色管理或商家数据复制功能。
- 所有浏览器 API 保持 `/admin-api/v1` 前缀、`HttpOnly`、`Secure`、`SameSite=Lax` Cookie 和 `Cache-Control: no-store`。
- 密码使用带版本、随机盐与明确迭代次数的 Web Crypto PBKDF2-SHA-256 记录；不得继续引入原生 `argon2`。
- D1 数据库 ID 不是密钥，应随 `wrangler.toml` 提交；不得提交域名、密码、令牌、密钥、生成的 Owner SQL 或 `.dev.vars`。
- 前端现有“未接入”状态必须保留；本阶段不伪造订阅、活动或反馈审核数据。
- 任何代码完成后按仓库规则先在本地核对变更，再请求用户授权推送；不执行 `git push`。

## 审查重点（Review Focus）

- Cookie 仅从 `/admin-api/v1` 路径读取，登出必须同时撤销 D1 会话，过期或空闲会话均返回 401。
- Service Binding 或 HMAC 签名失败时不得泄露商家响应体、access token、密钥或堆栈，浏览器应收到 503 的通用错误。
- `admin_users` 已有活跃 Owner 时，任何初始化或重复创建请求都不得覆盖原密码或产生第二个可登录账户。
- 静态资源 SPA 回退不得吞掉 `/admin-api/*` 的 404、401 或 503 响应。
- 两个不同 Worker isolate 同一 IP 的连续第 11 次登录尝试必须被 D1 共享限流拒绝，不能依赖内存 `Map`。

---

### Task 1: 建立 Cloudflare Worker 工具链与 Admin D1 迁移

**文件：**
- 创建：`wrangler.toml`
- 创建：`worker/migrations/0001_admin_auth.sql`
- 创建：`worker/env.ts`
- 创建：`worker/vitest.config.ts`
- 创建：`worker/test/migrations.test.ts`
- 修改：`package.json`
- 修改：`package-lock.json`
- 修改：`tsconfig.json`
- 修改：`vite.config.ts`
- 修改：`.gitignore`

**接口：**
- 消费：`web/dist` 作为 Worker Assets 目录。
- 产生：`Env` 类型，至少包含 `ADMIN_DB: D1Database`、`MERCHANT_APP: Fetcher`、`ADMIN_INTERNAL_SECRET: string`、`ASSETS: Fetcher` 和可选的 `now(): number` 测试时钟。
- 产生：迁移后的 `admin_users`、`admin_owner_lock`、`admin_sessions`、`admin_audit` 与 `admin_login_attempts` 表。

- [ ] **Step 1: 编写 D1 迁移失败测试**

在 `worker/test/migrations.test.ts` 中读取迁移文件并断言尚未存在的关键 SQL：

```ts
it('creates isolated owner, session, audit, rate-limit, and nonce tables', async () => {
  const sql = await readFile(new URL('../migrations/0001_admin_auth.sql', import.meta.url), 'utf8');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS admin_users');
  expect(sql).toContain("CHECK (role = 'Owner')");
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS admin_owner_lock');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS admin_login_attempts');
});
```

- [ ] **Step 2: 运行测试并确认失败**

运行：`npm run test:worker -- worker/test/migrations.test.ts`

预期：失败，提示找不到 `worker/migrations/0001_admin_auth.sql` 或脚本不存在。

- [ ] **Step 3: 添加 Worker 配置、类型和迁移**

创建 `wrangler.toml` 时先保留 Worker、Service Binding 与 Assets 配置；在获准创建远程资源的部署步骤中执行 `wrangler d1 create kaching-developer-admin`，将命令实际输出的数据库 ID 写入同一文件的 `[[d1_databases]]` 块。数据库 ID 不是密钥，应与 Worker 配置一同受版本控制；不能用虚构 ID 或占位字符串替代。目标 D1 配置块格式为：

```toml
name = "kaching-developer-admin"
main = "worker/index.ts"
compatibility_date = "2026-11-02"
workers_dev = true

[[services]]
binding = "MERCHANT_APP"
service = "shopline-quantity-breaks"

[assets]
directory = "./dist"
binding = "ASSETS"
```

创建 D1 后，将 Wrangler 实际输出的四行 `[[d1_databases]]` 配置原样加入 `wrangler.toml`：`binding` 必须是 `ADMIN_DB`，`database_name` 必须是 `kaching-developer-admin`，`database_id` 必须是该命令输出的 UUID，`migrations_dir` 必须是 `worker/migrations`。

迁移中对 `admin_users.role` 使用 `CHECK (role = 'Owner')`；对 `admin_owner_lock.id` 使用 `CHECK (id = 1)` 和主键约束，作为唯一 Owner 的并发安全锁；使用主键或唯一索引保证每个 `ip_key` 只有一条限流记录。HMAC nonce 的唯一性校验保留在商家 Worker 的 App D1 `internal_request_nonces` 表。更新 `package.json` 增加 `hono`、`wrangler`、`@cloudflare/vitest-pool-workers`、`@cloudflare/workers-types` 和 `vitest`，并定义：

```json
{
  "build:web": "tsc --noEmit && vite build",
  "test:worker": "vitest run --config worker/vitest.config.ts",
  "check:worker": "tsc --noEmit -p worker/tsconfig.json",
  "build": "npm run build:web && npm run check:worker && wrangler deploy --dry-run"
}
```

移除 `vite.config.ts` 中指向本地 `4400` 的开发代理；改为在本地使用 `wrangler dev` 访问完整应用。将 `.wrangler/`、`.dev.vars` 和本地 D1 文件加入忽略规则。

- [ ] **Step 4: 运行迁移测试并确认通过**

运行：`npm run test:worker -- worker/test/migrations.test.ts`

预期：PASS，迁移文件声明所有隔离的 Admin D1 表。

- [ ] **Step 5: 提交工具链与迁移**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts .gitignore wrangler.toml worker
git commit -m "feat(admin): scaffold cloudflare worker and d1 schema"
```

### Task 2: 实现 Web Crypto 密码记录与 Admin D1 仓储

**文件：**
- 创建：`shared/password-record.mjs`
- 创建：`worker/db/admin-store.ts`
- 创建：`worker/test/admin-store.test.ts`
- 创建：`worker/test/password-record.test.ts`
- 删除：`server/store.js`

**接口：**
- 消费：`Env['ADMIN_DB']` 与可选 `now` 时钟。
- 产生：`createPasswordRecord(password): Promise<string>`、`verifyPasswordRecord(record, password): Promise<boolean>`。
- 产生：`AdminStore`，包含 `createOwner(input)`、`login(input)`、`authenticate(token)`、`logout(token)`、`audit(input)`、`listAudit(page)` 与 `consumeLoginAttempt(ipKey)`。

- [ ] **Step 1: 编写密码记录与仓储失败测试**

在 `worker/test/password-record.test.ts` 添加：

```ts
it('verifies only the original password against a versioned PBKDF2 record', async () => {
  const record = await createPasswordRecord('strong-passphrase-123');
  expect(record).toMatch(/^pbkdf2-sha256\$v1\$600000\$/);
  await expect(verifyPasswordRecord(record, 'strong-passphrase-123')).resolves.toBe(true);
  await expect(verifyPasswordRecord(record, 'wrong-password')).resolves.toBe(false);
});
```

在 `worker/test/admin-store.test.ts` 添加：

```ts
it('allows one Owner and persists a revocable session', async () => {
  const store = new AdminStore(env.ADMIN_DB, fixedNow);
  await store.createOwner({ email: 'owner@example.com', password: 'strong-passphrase-123' });
  await expect(store.createOwner({ email: 'other@example.com', password: 'another-passphrase-456' })).rejects.toThrow('OWNER_EXISTS');
  const session = await store.login({ email: 'owner@example.com', password: 'strong-passphrase-123', ipKey: 'ip-a' });
  expect(await store.authenticate(session.token)).toMatchObject({ email: 'owner@example.com', role: 'Owner' });
  await store.logout(session.token);
  await expect(store.authenticate(session.token)).resolves.toBeNull();
});
```

- [ ] **Step 2: 运行测试并确认失败**

运行：`npm run test:worker -- worker/test/password-record.test.ts worker/test/admin-store.test.ts`

预期：失败，提示找不到 `shared/password-record.mjs` 与 `worker/db/admin-store.ts`。

- [ ] **Step 3: 实现最小密码记录和 D1 仓储**

`shared/password-record.mjs` 使用 `crypto.getRandomValues` 生成 16 字节盐，使用 `crypto.subtle.importKey` 和 `deriveBits` 执行 PBKDF2-SHA-256 600000 次，格式固定为：

```ts
`pbkdf2-sha256$v1$600000$${base64url(salt)}$${base64url(hash)}`
```

用等时字节比较校验哈希。`AdminStore.createOwner()` 先生成用户 ID，再在同一个 `ADMIN_DB.batch()` 中依次插入 `admin_owner_lock(id, user_id)` 的固定 ID `1` 和 `admin_users`；锁插入冲突必须映射为 `OWNER_EXISTS`，且整个批处理回滚。会话令牌和 CSRF 令牌随机生成后仅保存 SHA-256 哈希；登录创建 8 小时绝对过期、30 分钟空闲过期的 active session。`consumeLoginAttempt` 以 D1 原子更新将同一 `ip_key` 在 15 分钟窗口内计数，返回第 11 次为拒绝，并在该事务内清理过期窗口。每个数据库语句用绑定参数，不拼接用户输入。

- [ ] **Step 4: 扩充边界测试并运行通过**

在 `worker/test/admin-store.test.ts` 增加断言：过期会话返回 `null`、30 分钟空闲会话返回 `null`、两个 `AdminStore` 实例共享第 11 次 `ip-a` 登录拒绝、审计写入失败的调用方收到错误。运行：

`npm run test:worker -- worker/test/password-record.test.ts worker/test/admin-store.test.ts`

预期：PASS。

- [ ] **Step 5: 提交认证数据层**

```bash
git add shared/password-record.mjs worker/db/admin-store.ts worker/test/password-record.test.ts worker/test/admin-store.test.ts server/store.js
git commit -m "feat(admin): move owner auth state to d1"
```

### Task 3: 实现 Worker 认证、CSRF、审计与 API 路由

**文件：**
- 创建：`worker/routes/auth.ts`
- 创建：`worker/routes/admin-api.ts`
- 创建：`worker/test/auth-routes.test.ts`
- 修改：`worker/env.ts`
- 删除：`server/app.js`
- 删除：`test/auth.test.js`
- 删除：`test/api.test.js`

**接口：**
- 消费：`AdminStore` 与 `Env`。
- 产生：`registerAuthRoutes(app)` 和 `registerAdminApiRoutes(app)`，路由挂载于 `/admin-api/v1`。
- 产生：`requireOwner` 中间件，将 `{ id, email, role, csrfToken }` 写入 Hono context variables。

- [ ] **Step 1: 编写认证路由失败测试**

在 `worker/test/auth-routes.test.ts` 通过 `worker.fetch(request, env, ctx)` 写入：

```ts
it('sets a secure session cookie and requires CSRF on logout', async () => {
  await seedOwner(env.ADMIN_DB, 'owner@example.com', 'strong-passphrase-123');
  const login = await worker.fetch(jsonRequest('/admin-api/v1/auth/login', { email: 'owner@example.com', password: 'strong-passphrase-123' }), env, ctx);
  expect(login.status).toBe(200);
  expect(login.headers.get('Set-Cookie')).toContain('HttpOnly');
  expect(login.headers.get('Set-Cookie')).toContain('Secure');
  const cookie = sessionCookie(login);
  expect((await worker.fetch(request('/admin-api/v1/auth/logout', { method: 'POST', headers: { Cookie: cookie } }), env, ctx)).status).toBe(403);
});
```

- [ ] **Step 2: 运行测试并确认失败**

运行：`npm run test:worker -- worker/test/auth-routes.test.ts`

预期：失败，提示找不到 Worker 入口或认证路由。

- [ ] **Step 3: 实现 Hono API 路由**

创建 `worker/index.ts`，关闭 API 缓存、生成每请求 UUID `X-Request-Id`，并挂载 API。登录路由取 `CF-Connecting-IP`，经 SHA-256 处理为 `ipKey` 后调用共享 D1 限流；凭据错误统一返回 `401 INVALID_CREDENTIALS`，第 11 次返回 `429 RATE_LIMITED`。Cookie 只使用：

```ts
`admin_session=${encodeURIComponent(token)}; Path=/admin-api/v1; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`
```

`GET /auth/me` 返回 Owner、CSRF 和环境，不返回密码记录或会话令牌。`POST /auth/logout` 必须验证 `x-csrf-token`，撤销 session 后清除同名 Cookie。`GET /audit-events` 必须只允许 Owner 并从 `AdminStore.listAudit()` 读取。

- [ ] **Step 4: 添加错误与兼容性断言并运行通过**

向测试添加：未认证 `/stores` 返回 401；旧 `/auth/mfa/verify` 和 `/admin-users` 返回 404；错误登录不泄露 Owner 邮箱；logout 后 `/auth/me` 返回 401；所有 API 响应具备 `Cache-Control: no-store` 和 `X-Request-Id`。运行：

`npm run test:worker -- worker/test/auth-routes.test.ts`

预期：PASS。

- [ ] **Step 5: 提交 API 认证层**

```bash
git add worker/index.ts worker/routes worker/env.ts worker/test/auth-routes.test.ts server/app.js test/auth.test.js test/api.test.js
git commit -m "feat(admin): serve owner api from cloudflare worker"
```

### Task 4: 通过 Service Binding 实现签名商家读取与字段投影

**文件：**
- 创建：`worker/internal/merchant-client.ts`
- 创建：`worker/source-projection.ts`
- 创建：`worker/test/source-boundary.test.ts`
- 修改：`worker/routes/admin-api.ts`
- 删除：`server/internal-client.js`
- 删除：`server/source-projection.js`
- 删除：`test/source-boundary.test.js`

**接口：**
- 消费：`Env['MERCHANT_APP']` 与 `Env['ADMIN_INTERNAL_SECRET']`。
- 产生：`internalGet(env, path): Promise<{ status: number; body: unknown }>` 与 `projectSource(path, result)`。

- [ ] **Step 1: 编写 Service Binding 失败测试**

在 `worker/test/source-boundary.test.ts` 使用记录请求的假的 `MERCHANT_APP.fetch`：

```ts
it('signs Service Binding paths and strips fields not in the source contract', async () => {
  env.MERCHANT_APP = { fetch: vi.fn(async (request: Request) => new Response(JSON.stringify({
    data: { total: 1, items: [{ storeId: 'store-42', handle: 'shop', scope: '', status: 'installed', installedAt: '2026-10-14T01:00:00Z', updatedAt: '2026-10-14T02:00:00Z', accessToken: 'never-return-this' }], accessToken: 'never-return-this' },
  })) } as Fetcher;
  const response = await loggedInFetch('/admin-api/v1/stores', env);
  expect(response.status).toBe(200);
  expect(JSON.stringify(await response.json())).not.toContain('never-return-this');
});
```

- [ ] **Step 2: 运行测试并确认失败**

运行：`npm run test:worker -- worker/test/source-boundary.test.ts`

预期：失败，提示找不到 `merchant-client` 或 `/stores` 尚未从 Service Binding 获取数据。

- [ ] **Step 3: 实现签名客户端和投影层**

`merchant-client.ts` 复用现有签名字符串格式：

```ts
`${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}`
```

用 Web Crypto HMAC-SHA-256 生成十六进制 `x-admin-signature`，将 `x-admin-timestamp`、随机生成的 `x-admin-nonce` 与签名发送到 `env.MERCHANT_APP.fetch(new Request('https://merchant.internal' + signedPath, { headers }))`。重放校验由已接收请求的商家 Worker 在 App D1 中完成；5 秒 `AbortSignal.timeout` 触发、非 JSON 响应和 Worker fetch 异常都标准化为 `SOURCE_UNAVAILABLE`。

将现有 `server/source-projection.js` 的白名单校验移植为 TypeScript，只接受 Overview、Stores、Store Detail 和 Errors 的预期字段。受保护的 store detail 与 errors 查询在商家响应后，以实际状态 `success`、`not_found` 或 `failure` 写入审计；审计写入失败时返回 `503 AUDIT_UNAVAILABLE`。

- [ ] **Step 4: 添加边界断言并运行通过**

添加：404 商家响应映射为 `NOT_FOUND` 且审计为 `not_found`；格式错误的商家 JSON 映射为 503 且不泄露原字段；商家拒绝重放 nonce 的 401 响应映射为 503；受保护读取的审计失败阻断响应。运行：

`npm run test:worker -- worker/test/source-boundary.test.ts`

预期：PASS。

- [ ] **Step 5: 提交内部读取边界**

```bash
git add worker/internal worker/source-projection.ts worker/routes/admin-api.ts worker/test/source-boundary.test.ts server/internal-client.js server/source-projection.js test/source-boundary.test.js
git commit -m "feat(admin): read merchant data through service binding"
```

### Task 5: 完成同源静态资源与离线 Owner 初始化

**文件：**
- 创建：`scripts/bootstrap-owner.mjs`
- 创建：`worker/test/assets.test.ts`
- 修改：`worker/index.ts`
- 修改：`package.json`
- 修改：`README.md`
- 修改：`.env.example`
- 删除：`server/index.js`
- 删除：`server/bootstrap.js`
- 删除：`test/browser-smoke.mjs`（以 Worker 端到端浏览器测试替换）
- 创建：`worker/test/browser-smoke.mjs`

**接口：**
- 消费：`shared/password-record.mjs` 与 `Admin D1` 迁移。
- 产生：`npm run bootstrap-owner -- --email owner@example.com` 输出可人工执行的 D1 SQL；非 API 404 静态请求返回 SPA `index.html`。

- [ ] **Step 1: 编写静态资源失败测试**

在 `worker/test/assets.test.ts` 编写：

```ts
it('keeps api misses as JSON while falling back to the SPA for browser routes', async () => {
  expect((await worker.fetch(new Request('https://admin.example/admin-api/v1/missing'), env, ctx)).status).toBe(404);
  const page = await worker.fetch(new Request('https://admin.example/stores'), env, ctx);
  expect(await page.text()).toContain('<div id="root">');
});

```

- [ ] **Step 2: 运行测试并确认失败**

运行：`npm run test:worker -- worker/test/assets.test.ts`

预期：失败，提示 Worker 没有 SPA fallback。

- [ ] **Step 3: 实现资源回退、清理和初始化脚本**

在 `worker/index.ts` 中先处理 `/admin-api/`，仅对非 API 请求调用 `env.ASSETS.fetch()`；资源返回 404 时再获取 `/`。登录限流记录在 `AdminStore.consumeLoginAttempt()` 内按窗口清理，因此管理后台 Worker 不需要独立定时任务。

`scripts/bootstrap-owner.mjs` 读取 `ADMIN_BOOTSTRAP_EMAIL` 与 `ADMIN_BOOTSTRAP_PASSWORD`（最少 12 字符），使用共享密码工具与 `crypto.randomUUID()` 输出一条带随机 Owner ID、参数化转义值、`Owner` 与 `active` 的 `INSERT ... SELECT ... WHERE NOT EXISTS` 语句；输出前不打印密码。将 README 改为 Cloudflare 部署说明，明确依次运行 D1 迁移、配置 Service Binding/Secrets、离线生成 Owner SQL、再部署 Worker。删除 Node 服务器环境变量示例，保留只含非敏感示例的 `.env.example` 或将其替换为 `.dev.vars.example`。

- [ ] **Step 4: 添加脚本与浏览器回归测试并运行通过**

增加断言：初始化脚本对短密码返回非零退出、输出不含输入密码且包含 `WHERE NOT EXISTS`；`worker/test/browser-smoke.mjs` 使用 `wrangler dev --local` 启动 Worker 后验证登录页、Owner 登录、Overview 和 390px 视口没有页面错误。运行：

`npm run test:worker -- worker/test/assets.test.ts && node worker/test/browser-smoke.mjs`

预期：PASS。

- [ ] **Step 5: 提交可部署运行时与文档**

```bash
git add scripts/bootstrap-owner.mjs worker/index.ts worker/test/assets.test.ts worker/test/browser-smoke.mjs README.md .env.example package.json server/index.js server/bootstrap.js test/browser-smoke.mjs
git commit -m "feat(admin): run console fully on cloudflare"
```

### Task 6: 删除旧 Node 运行时、执行全量验证并更新进度

**文件：**
- 修改：`docs/DEVELOPER_ADMIN_PROGRESS.md`
- 修改：`docs/DEVELOPER_ADMIN_ACCEPTANCE_REPORT.md`
- 修改：`docs/DEVELOPER_ADMIN_SINGLE_OWNER_SHADCN_DESIGN.md`
- 删除：`server/` 中剩余 Express、SQLite、原生依赖文件
- 删除：`test/ui-state.test.js`（若被 Worker 端测试替代）或迁移为 `worker/test/ui-state.test.ts`
- 修改：`package.json`
- 修改：`package-lock.json`

**接口：**
- 消费：Tasks 1-5 产生的 Worker、D1 迁移、前端构建和测试命令。
- 产生：无 Express、`sqlite3`、`argon2`、`otplib`、`qrcode` 生产依赖的可部署项目；文档准确描述“本地验证通过、生产 Cloudflare 资源尚未创建”。

- [ ] **Step 1: 编写旧运行时边界失败测试**

创建或迁移 `worker/test/no-node-runtime.test.mjs`：

```js
test('does not ship the retired Node server runtime', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  for (const dependency of ['express', 'sqlite3', 'argon2', 'otplib', 'qrcode']) assert.equal(manifest.dependencies?.[dependency], undefined);
  await assert.rejects(stat('server/index.js'));
});
```

- [ ] **Step 2: 运行测试并确认失败**

运行：`node --test worker/test/no-node-runtime.test.mjs`

预期：失败，因为旧 Node 依赖和 `server/index.js` 仍存在。

- [ ] **Step 3: 删除旧运行时并更新文档**

从 `package.json` 和锁文件移除旧 Node 服务依赖，删除整个 `server/` 目录与已替换测试，确保只保留 Worker 运行路径。更新进度和验收报告：已完成的是本地 Worker/D1 测试、构建与浏览器验证；Cloudflare D1 创建、Secret、Service Binding、域名和远程部署均标为未执行。文档不得把未执行的远程部署标为通过。

- [ ] **Step 4: 运行全量验证并确认通过**

运行：

```bash
npm run test:worker
node --test worker/test/no-node-runtime.test.mjs
npm run build:web
npm run check:worker
wrangler deploy --dry-run
git diff --check
```

预期：全部 PASS；`wrangler deploy --dry-run` 不发起远程部署；未跟踪文件仅为预期的 Worker、迁移、脚本和文档文件。

- [ ] **Step 5: 提交迁移完成状态**

```bash
git add package.json package-lock.json server test worker docs README.md .env.example scripts shared wrangler.toml vite.config.ts tsconfig.json .gitignore
git commit -m "chore(admin): retire local node runtime"
```

## 计划自查

- 规格覆盖：Admin D1、单 Owner、会话、CSRF、限流、审计、Service Binding、HMAC、字段投影、静态资源、初始化、测试和远程部署边界分别由 Tasks 1-6 覆盖；HMAC 重放校验继续由商家 App D1 的现有表负责。
- 规格刻意延后内容：订阅、活动/折扣和反馈审核的商家内部数据契约是第二阶段，未在本计划伪造或旁路 App D1。
- 接口一致性：Task 2 的 `AdminStore` 由 Task 3 和 Task 4 消费；Task 4 的 `internalGet` 与 `projectSource` 由 Task 3 的数据路由消费；Task 5 的 Worker 入口汇总前述路由。
- 审查重点覆盖：会话和 CSRF 在 Task 3；源失败和敏感字段在 Task 4；重复 Owner 在 Task 2；SPA/API 区分在 Task 5；跨 isolate 限流在 Task 2。
- 占位符扫描：未发现未完成步骤或含糊实现指令。

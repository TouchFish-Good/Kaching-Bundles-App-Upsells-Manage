# Cloudflare Worker + D1 Developer Admin Design

## Purpose and Decisions

The Developer Admin Console is a single-Owner operations tool. It must run entirely on Cloudflare while preserving a strict boundary from the merchant application:

- The merchant application remains the authority for merchant, entitlement, campaign, feedback, and diagnostic data in its existing App D1 database.
- The admin console owns its credentials, sessions, CSRF state, audit records, and login throttling in a new Admin D1 database.
- Both Workers run in the same Cloudflare account. The admin Worker reaches the merchant Worker through a Service Binding; the merchant database is never bound to the admin Worker.
- The existing HMAC request signature and replay check remain enabled for the internal read boundary. A Service Binding removes the public network hop but does not replace this application-level authorization check.
- The fixed Owner account is initialized once through a local administrative script that emits a versioned password record and inserts it into Admin D1. There is no registration route or runtime bootstrap credential.

The target is production deployability on Cloudflare. It does not claim that merchant data sources that are currently unavailable have become available.

## Deployment Topology

```text
Browser
  -> developer-admin.example.com
  -> Developer Admin Worker (static Vite assets + /admin-api/v1)
       -> Admin D1: owner, sessions, CSRF, audit, login attempts
       -> MERCHANT_APP Service Binding + HMAC signature
            -> Merchant App Worker
                 -> App D1: stores, entitlements, campaigns, feedback, diagnostics
```

The Developer Admin Worker serves the built `web/dist` assets and the API from one origin. Its SPA fallback must only apply to non-API paths. API responses remain `Cache-Control: no-store`; assets retain the normal Workers Assets cache behaviour.

The Worker configuration must use a new `ADMIN_DB` D1 binding and a `MERCHANT_APP` Service Binding to the existing `shopline-quantity-breaks` Worker. Database IDs, domains, and secret values remain deployment configuration and are never committed.

## Admin D1 Data Model

Admin D1 contains only the following tables:

- `admin_users`: exactly one active `Owner`; email is unique; the password record is a versioned Web Crypto PBKDF2-SHA-256 record with random salt and explicit iteration count.
- `admin_sessions`: hashed opaque session token, CSRF token, creation, activity, expiry, and revocation timestamps.
- `admin_audit`: Owner login, logout, sensitive reads, and future moderation mutation audit events.
- `admin_login_attempts`: a keyed, expiring 15-minute counter used to reject the eleventh failed-or-successful attempt from the same source.
- `admin_internal_nonces`: an expiring nonce replay ledger used when this Worker sends signed merchant reads, allowing the existing merchant HMAC verification contract to remain unchanged.

No merchant access tokens, webhook payloads, campaign records, feedback content, or subscription data are copied into Admin D1.

Sessions use `HttpOnly`, `Secure`, `SameSite=Lax`, path `/admin-api/v1`, eight-hour absolute expiry, and a thirty-minute idle expiry. Authentication compares password records with Web Crypto and returns no account-enumeration details. D1 writes are checked before a protected response is returned where an audit record is mandatory.

## Worker API and Internal Data Flow

The browser API remains compatible with the current frontend:

- `POST /admin-api/v1/auth/login`
- `GET /admin-api/v1/auth/me`
- `POST /admin-api/v1/auth/logout`
- `GET /admin-api/v1/overview`, `/stores`, `/stores/:storeId`, `/stores/:storeId/bundles`, `/bundles`, `/events/errors`, and `/audit-events`

The admin Worker validates pagination and environment inputs, authenticates the single Owner, signs the requested path, and invokes `env.MERCHANT_APP.fetch()`. The projection layer permits only explicitly defined response fields before returning data to the browser. Merchant errors map to the existing `NOT_FOUND`, `INVALID_SOURCE_QUERY`, and `SOURCE_UNAVAILABLE` API contract.

The merchant Worker continues to authorize `/internal/admin-read/v1/*` using `ADMIN_INTERNAL_SECRET`, timestamp, and nonce. Its existing routes already serve Overview, Stores, Store Detail, and Errors. A later data-contract task will add dedicated internal routes for subscription entitlement summaries, campaign/discount summaries, and feedback moderation; until those routes are implemented and backed by real App D1 records, the console must report them as unavailable.

## Migration and Initialization

The deployment creates a new Admin D1 database and applies an ordered migration set with Wrangler. It does not import the local `admin.sqlite` file: local sessions and audit events are non-production development artifacts, and the Owner is deliberately reseeded for the production environment.

An offline `bootstrap-owner` script accepts an email and password from the operator environment, creates a PBKDF2 record using the same versioned format as the Worker, and emits parameterized SQL for `wrangler d1 execute --remote`. It refuses to produce an insert if an active Owner already exists. Password values and generated SQL are not written to the repository or test fixtures.

Cloudflare Secrets are configured independently for each deployed Worker:

- Admin Worker: `ADMIN_INTERNAL_SECRET`.
- Merchant Worker: the same `ADMIN_INTERNAL_SECRET`.

There is no production `.env` file. If a future deployment needs an encryption key for a feature, it is created as a Worker secret and documented without a value.

## Error Handling, Observability, and Security

- Invalid request JSON, pagination, and CSRF tokens produce explicit 4xx API codes; database and Service Binding failures produce a generic 503 response without internal detail.
- Every response carries an opaque request ID. Merchant Trace IDs are returned only through the projected error-event contract.
- The owner password, session tokens, HMAC secret, full merchant records, access tokens, and raw webhook payloads never enter browser responses or audit records.
- The Service Binding has no App D1 binding. The merchant Worker remains responsible for row-level and field-level projections.
- Login throttling is stored in Admin D1 so it remains effective across Worker isolates. Expired throttling and nonce rows are pruned by a scheduled Worker handler.

## Testing and Acceptance

The migration must be verified with the Cloudflare Vitest pool and a local D1 binding. Tests cover:

1. Owner creation, PBKDF2 verification, duplicate Owner refusal, session expiry, logout, CSRF, and shared login throttling.
2. HMAC-signed Service Binding reads, response projection, replay rejection, unavailable merchant source handling, and mandatory sensitive-read audit outcomes.
3. Worker route contracts for unauthenticated, malformed, unauthorized, and successful flows.
4. Static-asset SPA fallback does not capture `/admin-api/*` routes.
5. Vite build, Worker type check, Wrangler dry-run, and desktop/mobile browser smoke tests.

Production acceptance additionally requires applying the Admin D1 migration, configuring both Worker secrets and the Service Binding, seeding the one Owner, accessing the production custom domain over HTTPS, and proving that the admin Worker has no App D1 binding.

## Non-goals and Phasing

This implementation replaces only the admin runtime and its local state store. It does not fabricate subscription expiry, campaign publication, or feedback moderation data. Those merchant-side capabilities are a follow-up phase after their internal contracts and tests exist.

The implementation is split into two deliverables:

1. A deployable Cloudflare-native admin Worker preserving all currently available read-only pages, authentication, audit, and source-projection behaviour.
2. Merchant internal-contract expansion and admin UI enablement for subscriptions, campaigns, and feedback moderation, each backed by real App D1 data and separately verified.

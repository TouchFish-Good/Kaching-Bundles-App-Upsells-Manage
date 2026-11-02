# Developer Admin Console: Single Owner and Shadcn Direction

Updated: 2026-11-02. Status: implemented locally; production integration remains unverified.

## Confirmed Decisions

- The console has exactly one Owner account. It is created once with `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD`.
- Login is email and password only. There is no public registration, MFA step, invitation flow, team management page, or role-based navigation.
- A successful password login creates a short-lived, `HttpOnly` management session. Logout, CSRF protection for mutations, login rate limiting, sensitive-read audit records, and the separate HMAC boundary to the merchant service remain in place.

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

The visual evidence is maintained under `docs/qa/` for the login page plus Overview, Stores, and Bundles at desktop and mobile widths.

## Next Data Contracts

1. Add signed internal read routes for subscription entitlements by stable store ID, including `state`, `activeSpuKey`, `validUntil`, `graceUntil`, and `lastVerifiedAt`.
2. Add a campaign/discount projection that returns only the store-owned campaign summary, publication state, schedule, tier summary, and revision.
3. Add feedback moderation routes with an Owner audit entry for every status, visibility, or reply change.
4. Generate or propagate a Trace ID at the merchant worker boundary and persist it with structured error events; no request tokens or raw payloads enter the console.

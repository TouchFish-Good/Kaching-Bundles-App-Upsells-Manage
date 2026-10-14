# Kaching Developer Admin

Internal read-only console for the SHOPLINE app. The merchant app lives in the sibling `Kaching Bundles App & Upsells New/bundles-app-upsells-new` project. The console does not use SHOPLINE merchant sessions for administrator access.

## Local setup

1. Install dependencies with `npm install`.
2. Set `ADMIN_ENCRYPTION_KEY` to 32 random bytes encoded as 64 hex characters, and set a distinct `ADMIN_INTERNAL_SECRET` to a long random value. The merchant app must receive the same `ADMIN_INTERNAL_SECRET`. Keep both outside Git.
3. Set `ADMIN_INTERNAL_URL` to the merchant backend URL (default `http://127.0.0.1:3000`) and `ADMIN_ENVIRONMENT=development`.
4. With `ADMIN_BOOTSTRAP_EMAIL` and a strong `ADMIN_BOOTSTRAP_PASSWORD` set in the environment, run `npm run bootstrap-owner` once. Register the printed TOTP URI in an authenticator. Clear the bootstrap password environment variable afterwards.
5. Run `npm run server:dev` and `npm run dev`; open `http://127.0.0.1:5174`.

The merchant backend must be running for Stores and Overview. Real installation records appear only after a SHOPLINE authorization successfully returns a stable store ID from `GET /merchants/shop.json`; no sample store is seeded. Bundle activity remains unavailable until the merchant app persists real activities. The UI says so rather than showing demo data.

Local SQLite files are for development. Production requires independent HTTPS deployment, durable database and backup decisions, environment separation, a shared replay store for signed internal requests in multi-instance deployments, and live SHOPLINE verification. Do not deploy this local setup as production.

## Checks

Run `npm test` and `npm run build`. The merchant app's tests are under its `app/test/` directory and run with `node --test -r ts-node/register/transpile-only test/*.test.js` from its `app` directory.

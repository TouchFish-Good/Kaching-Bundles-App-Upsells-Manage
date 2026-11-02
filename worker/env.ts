type WorkerBindings = {
  ADMIN_DB: D1Database;
  MERCHANT_APP: Fetcher;
  ADMIN_INTERNAL_SECRET: string;
  ASSETS: Fetcher;
  now?: () => number;
};

export type Env = WorkerBindings;

declare global {
  namespace Cloudflare {
    interface Env extends WorkerBindings {}
  }
}

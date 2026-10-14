import { resolve } from 'node:path';
import { AdminStore } from './store.js';
import { createApp } from './app.js';

const port = Number(process.env.ADMIN_PORT || 4400);
const dbPath = resolve(process.env.ADMIN_DB_PATH || './admin.sqlite');
if (!process.env.ADMIN_ENCRYPTION_KEY || !process.env.ADMIN_INTERNAL_SECRET) {
  throw new Error('ADMIN_ENCRYPTION_KEY and ADMIN_INTERNAL_SECRET are required');
}
const store = new AdminStore(dbPath);
await store.ready();
const app = createApp(store, {
  internalUrl: process.env.ADMIN_INTERNAL_URL || 'http://127.0.0.1:3000',
  internalSecret: process.env.ADMIN_INTERNAL_SECRET,
  environment: process.env.ADMIN_ENVIRONMENT || 'development',
});
app.listen(port, () => console.log(`Developer Admin API listening on http://127.0.0.1:${port}`));

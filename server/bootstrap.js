import { resolve } from 'node:path';
import { AdminStore } from './store.js';

if (!process.env.ADMIN_ENCRYPTION_KEY || !process.env.ADMIN_BOOTSTRAP_EMAIL || !process.env.ADMIN_BOOTSTRAP_PASSWORD) {
  throw new Error('Set ADMIN_ENCRYPTION_KEY, ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD');
}

const store = new AdminStore(resolve(process.env.ADMIN_DB_PATH || './admin.sqlite'));
try {
  await store.ready();
  const existing = await store.get('SELECT count(*) AS count FROM admin_users');
  if (existing.count > 0) throw new Error('Bootstrap is only allowed on an empty administrator database');
  await store.createOwner({
    email: process.env.ADMIN_BOOTSTRAP_EMAIL,
    password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
  });
  console.log('Owner created. Clear the bootstrap password environment variable now.');
} finally {
  await store.close();
}

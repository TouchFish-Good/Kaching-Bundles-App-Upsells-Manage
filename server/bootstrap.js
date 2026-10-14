import { resolve } from 'node:path';
import { authenticator } from 'otplib';
import { AdminStore } from './store.js';

if (!process.env.ADMIN_ENCRYPTION_KEY || !process.env.ADMIN_BOOTSTRAP_EMAIL || !process.env.ADMIN_BOOTSTRAP_PASSWORD) {
  throw new Error('Set ADMIN_ENCRYPTION_KEY, ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD');
}

const store = new AdminStore(resolve(process.env.ADMIN_DB_PATH || './admin.sqlite'));
try {
  await store.ready();
  const existing = await store.get('SELECT count(*) AS count FROM admin_users');
  if (existing.count > 0) throw new Error('Bootstrap is only allowed on an empty administrator database');
  const secret = authenticator.generateSecret();
  await store.createUser({
    email: process.env.ADMIN_BOOTSTRAP_EMAIL,
    password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
    role: 'Owner',
    mfaSecret: secret,
  });
  console.log('Owner created. Add this URI to an authenticator now; it will not be shown again:');
  console.log(authenticator.keyuri(process.env.ADMIN_BOOTSTRAP_EMAIL, 'Kaching Developer Admin', secret));
} finally {
  await store.close();
}

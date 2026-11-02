import { createPasswordRecord } from '../shared/password-record.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const email = String(option('--email') ?? process.env.ADMIN_BOOTSTRAP_EMAIL ?? '').trim().toLowerCase();
const password = String(process.env.ADMIN_BOOTSTRAP_PASSWORD ?? '');

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('ADMIN_BOOTSTRAP_EMAIL must be a valid email address.');
  process.exitCode = 1;
} else if (password.length < 12) {
  console.error('ADMIN_BOOTSTRAP_PASSWORD must be at least 12 characters.');
  process.exitCode = 1;
} else {
  const id = crypto.randomUUID();
  const passwordRecord = await createPasswordRecord(password);
  const createdAt = Date.now();
  const ownerGuard = '(SELECT 1 FROM admin_owner_lock WHERE id = 1)';

  console.log([
    `INSERT INTO admin_users(id, email, password_record, role, status, created_at) SELECT ${sql(id)}, ${sql(email)}, ${sql(passwordRecord)}, 'Owner', 'active', ${createdAt} WHERE NOT EXISTS ${ownerGuard};`,
    `INSERT INTO admin_owner_lock(id, user_id) SELECT 1, ${sql(id)} WHERE EXISTS (SELECT 1 FROM admin_users WHERE id = ${sql(id)}) AND NOT EXISTS ${ownerGuard};`,
  ].join('\n'));
}

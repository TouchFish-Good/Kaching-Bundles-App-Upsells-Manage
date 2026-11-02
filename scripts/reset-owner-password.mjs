import { createPasswordRecord } from '../shared/password-record.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const email = String(option('--email') ?? process.env.ADMIN_OWNER_EMAIL ?? '').trim().toLowerCase();
const password = String(process.env.ADMIN_OWNER_PASSWORD ?? '');

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('ADMIN_OWNER_EMAIL must be a valid email address.');
  process.exitCode = 1;
} else if (password.length < 12) {
  console.error('ADMIN_OWNER_PASSWORD must be at least 12 characters.');
  process.exitCode = 1;
} else {
  const passwordRecord = await createPasswordRecord(password);
  console.log(
    `UPDATE admin_users SET password_record = ${sql(passwordRecord)} WHERE email = ${sql(email)} AND role = 'Owner' AND status = 'active' AND id = (SELECT user_id FROM admin_owner_lock WHERE id = 1);`,
  );
}

import { expect, it } from 'vitest';
import { createPasswordRecord, verifyPasswordRecord } from '../../shared/password-record.mjs';

it('verifies only the original password against a versioned PBKDF2 record', async () => {
  const record = await createPasswordRecord('strong-passphrase-123');

  expect(record).toMatch(/^pbkdf2-sha256\$v1\$600000\$/);
  await expect(verifyPasswordRecord(record, 'strong-passphrase-123')).resolves.toBe(true);
  await expect(verifyPasswordRecord(record, 'wrong-password')).resolves.toBe(false);
});

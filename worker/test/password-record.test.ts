import { expect, it } from 'vitest';
import { createPasswordRecord, verifyPasswordRecord } from '../../shared/password-record.mjs';

it('writes new password records with the Worker Free-compatible v2 work factor', async () => {
  const record = await createPasswordRecord('strong-passphrase-123');

  expect(record).toMatch(/^pbkdf2-sha256\$v2\$25000\$/);
  await expect(verifyPasswordRecord(record, 'strong-passphrase-123')).resolves.toBe(true);
  await expect(verifyPasswordRecord(record, 'wrong-password')).resolves.toBe(false);
});

it('continues to verify an existing v1 password record', async () => {
  const v1Record = 'pbkdf2-sha256$v1$600000$OeAFfpvBqD84OwTF7o4C0Q$puUMxMqXM3tuaI71WUbrmpMvfGo8OivM5rSCmvu562c';

  await expect(verifyPasswordRecord(v1Record, 'legacy-owner-password-123')).resolves.toBe(true);
  await expect(verifyPasswordRecord(v1Record, 'wrong-password')).resolves.toBe(false);
});

it('rejects unsupported password record versions', async () => {
  const record = await createPasswordRecord('strong-passphrase-123');
  const unknownVersion = record.replace('$v2$25000$', '$v3$25000$');

  await expect(verifyPasswordRecord(unknownVersion, 'strong-passphrase-123')).resolves.toBe(false);
});

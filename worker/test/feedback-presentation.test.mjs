import test from 'node:test';
import assert from 'node:assert/strict';

import { canChangeStatus, displayStatus } from '../../shared/feedback-presentation.mjs';

test('maps a hidden rejection to the Chinese 拒绝显示 badge and disables actions for withdrawn items', () => {
  assert.deepEqual(displayStatus({ status: 'rejected', displayStatus: 'rejected_hidden' }), { label: '拒绝显示', tone: 'danger' });
  assert.equal(canChangeStatus({ displayStatus: 'withdrawn' }), false);
});

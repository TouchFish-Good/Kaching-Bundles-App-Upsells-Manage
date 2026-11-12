import assert from 'node:assert/strict';
import test from 'node:test';
import { canRetryGdprTask, gdprTaskStoreLabel } from '../src/gdpr-presentation.mjs';

test('labels completed merchant deletion as cleared without retaining a handle', () => {
  assert.equal(gdprTaskStoreLabel({ kind: 'merchant_redact', state: 'completed', handle: null, storeId: '42' }), '已清除 · 42');
});

test('allows retry only for pending, retrying and failed GDPR tasks', () => {
  assert.equal(canRetryGdprTask({ state: 'completed' }), false);
  assert.equal(canRetryGdprTask({ state: 'failed' }), true);
});

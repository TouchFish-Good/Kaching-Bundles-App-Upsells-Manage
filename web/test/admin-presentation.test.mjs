import assert from 'node:assert/strict';
import test from 'node:test';
import { canRetryGdprTask, gdprTaskStoreLabel } from '../src/gdpr-presentation.mjs';
import { storeSubscriptionPresentation } from '../src/store-presentation.mjs';

test('labels completed merchant deletion as cleared without retaining a handle', () => {
  assert.equal(gdprTaskStoreLabel({ kind: 'merchant_redact', state: 'completed', handle: null, storeId: '42' }), '已清除 · 42');
});

test('allows retry only for pending, retrying and failed GDPR tasks', () => {
  assert.equal(canRetryGdprTask({ state: 'completed' }), false);
  assert.equal(canRetryGdprTask({ state: 'failed' }), true);
});

test('presents an active merchant subscription with its plan and expiry', () => {
  assert.deepEqual(storeSubscriptionPresentation({
    state: 'active', plan: 'ultra', validUntil: 1796256000000, graceUntil: null, lastVerifiedAt: 1793664000000,
  }), { stateLabel: '生效中', planLabel: 'Ultra', expiryAt: 1796256000000, expiryLabel: '到期时间' });
});

test('presents a missing subscription as not verified without inventing an expiry', () => {
  assert.deepEqual(storeSubscriptionPresentation(null), { stateLabel: '未核验', planLabel: '—', expiryAt: null, expiryLabel: '到期时间' });
});

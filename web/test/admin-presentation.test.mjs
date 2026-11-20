import assert from 'node:assert/strict';
import test from 'node:test';
import { canRetryGdprTask, gdprTaskStoreLabel } from '../src/gdpr-presentation.mjs';
import { storeStatusUpdatedLabel, storeSubscriptionPresentation, storeUrl } from '../src/store-presentation.mjs';

test('labels merchant deletion with both its handle and stable store ID after completion', () => {
  assert.equal(gdprTaskStoreLabel({ kind: 'merchant_redact', state: 'completed', handle: 'alpha', storeId: '42' }), 'alpha · 店铺 ID 42');
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

test('builds the public SHOPLINE URL from a store handle', () => {
  assert.equal(storeUrl('north-star'), 'https://north-star.myshopline.com');
});

test('labels the store timestamp as an installation state update', () => {
  assert.equal(storeStatusUpdatedLabel, '安装状态更新时间');
});

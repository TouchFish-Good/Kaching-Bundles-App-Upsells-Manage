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

test('keeps the plan and historical expiry for a trial that is not effective', () => {
  assert.deepEqual(storeSubscriptionPresentation({
    state: 'unactive', isTrial: true, plan: 'ultra', validUntil: 1893456000000, graceUntil: null, lastVerifiedAt: 1795400000000,
  }), { stateLabel: '试用未生效', planLabel: 'Ultra', expiryAt: 1893456000000, expiryLabel: '到期时间' });
});

test('shows the ended trial as expired while retaining its plan and historical expiry', () => {
  assert.deepEqual(storeSubscriptionPresentation({
    state: 'expired', isTrial: true, plan: 'ultra', validUntil: 1795100400000, graceUntil: null, lastVerifiedAt: 1795400000000,
  }), { stateLabel: '试用已过期', planLabel: 'Ultra', expiryAt: 1795100400000, expiryLabel: '到期时间' });
});

test('distinguishes ended, cancelled, pending and future subscriptions', () => {
  for (const [state, label] of [['expired', '已过期'], ['cancelled', '已取消'], ['pending', '待生效'], ['scheduled', '待开始']]) {
    const subscription = { state, plan: 'ultra', validUntil: 1795100400000, graceUntil: null };
    assert.equal(storeSubscriptionPresentation(subscription).stateLabel, label);
    assert.equal(storeSubscriptionPresentation({ ...subscription, isTrial: true }).stateLabel, `试用${label}`);
  }
});

test('builds the public SHOPLINE URL from a store handle', () => {
  assert.equal(storeUrl('north-star'), 'https://north-star.myshopline.com');
});

test('labels the store timestamp as an installation state update', () => {
  assert.equal(storeStatusUpdatedLabel, '安装状态更新时间');
});

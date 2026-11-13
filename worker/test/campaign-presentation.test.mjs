import test from 'node:test';
import assert from 'node:assert/strict';

import * as presentation from '../../shared/campaign-presentation.mjs';

const { campaignStatus, canPauseCampaign, coverageConflictNotice, campaignTierDisplay, campaignCombinationDisplay, campaignListPath, specifiedMarketAmountDisplays } = presentation;

test('renders an uncertain active campaign as warning and prevents pausing an already paused campaign', () => {
  assert.deepEqual(campaignStatus({ status: 'active', diagnosticOutcome: 'uncertain' }), { label: '启用', tone: 'warning' });
  assert.equal(canPauseCampaign({ status: 'paused' }), false);
});

test('formats collection overlap names for the Chinese conflict notice', () => {
  assert.equal(coverageConflictNotice([{ campaignName: '冬季活动', overlap: { type: 'collections', names: ['冬季精选'] } }]), '活动范围冲突：与「冬季活动」的指定分类重叠（冬季精选）。未执行平台操作。');
});

test('opens only valid diagnostic response bodies and formats the complete redacted JSON', () => {
  const body = '{"error":{"code":"DISCOUNT_UNAVAILABLE"},"details":{"retryable":true}}';
  assert.equal(presentation.canViewDiagnosticResponse(body), true);
  assert.equal(presentation.canViewDiagnosticResponse(null), false);
  assert.equal(presentation.formatDiagnosticResponseBody(body), '{\n  "error": {\n    "code": "DISCOUNT_UNAVAILABLE"\n  },\n  "details": {\n    "retryable": true\n  }\n}');
});

test('uses a disabled refresh label while current data is loading', () => {
  assert.equal(presentation.refreshLabel(false), '刷新');
  assert.equal(presentation.refreshLabel(true), '刷新中');
});

test('prefers Chinese campaign tier display fields and formats legacy values as a fallback', () => {
  assert.deepEqual(campaignTierDisplay({ discountType: 'percentage', discountValue: 1000, discountTypeDisplay: '百分比折扣', discountValueDisplay: '10%' }), { type: '百分比折扣', value: '10%' });
  assert.deepEqual(campaignTierDisplay({ discountType: 'percentage', discountValue: 1234 }), { type: '百分比折扣', value: '12.34%' });
  assert.deepEqual(campaignTierDisplay({ discountType: 'fixed_price', discountValue: 200 }), { type: '每件固定价格', value: '200' });
  assert.deepEqual(campaignTierDisplay({ discountType: 'bundle_fixed_amount', discountValue: 200 }), { type: '整单固定减免', value: '200' });
  assert.deepEqual(campaignTierDisplay({ discountType: 'none' }), { type: '原价', value: '—' });
});

test('formats campaign combination choices and specified market amounts for the detail view', () => {
  assert.deepEqual(campaignCombinationDisplay({ orderDiscounts: true, productDiscounts: false, shippingDiscounts: true }), [
    { label: '订单折扣', value: '可叠加' },
    { label: '商品折扣', value: '不叠加' },
    { label: '运费折扣', value: '可叠加' },
  ]);
  assert.deepEqual(specifiedMarketAmountDisplays([
    { marketId: 'market-us', marketName: '美国市场', mode: 'specified_amount', currencyCode: 'USD', amountMinor: 250 },
    { marketId: 'market-cn', marketName: '中国市场', mode: 'specified_amount', currencyCode: 'CNY', amountMinor: 8000 },
    { marketId: 'market-jp', marketName: '日本市场', mode: 'specified_amount', currencyCode: 'JPY', amountMinor: 800 },
    { marketId: 'market-eu', marketName: '欧洲市场', mode: 'auto_convert' },
  ]), [
    { marketName: '美国市场', marketId: 'market-us', value: 'USD 2.50' },
    { marketName: '中国市场', marketId: 'market-cn', value: 'CNY 80.00' },
    { marketName: '日本市场', marketId: 'market-jp', value: 'JPY 800' },
  ]);
});

test('returns from a merchant campaign detail to the unfiltered campaign list', () => {
  assert.equal(campaignListPath(), '/campaigns');
});

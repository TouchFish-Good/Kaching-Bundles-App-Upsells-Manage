import test from 'node:test';
import assert from 'node:assert/strict';

import * as presentation from '../../shared/campaign-presentation.mjs';

const { campaignStatus, canPauseCampaign, coverageConflictNotice } = presentation;

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

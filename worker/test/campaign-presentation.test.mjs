import test from 'node:test';
import assert from 'node:assert/strict';

import { campaignStatus, canPauseCampaign, coverageConflictNotice } from '../../shared/campaign-presentation.mjs';

test('renders an uncertain active campaign as warning and prevents pausing an already paused campaign', () => {
  assert.deepEqual(campaignStatus({ status: 'active', diagnosticOutcome: 'uncertain' }), { label: '启用', tone: 'warning' });
  assert.equal(canPauseCampaign({ status: 'paused' }), false);
});

test('formats collection overlap names for the Chinese conflict notice', () => {
  assert.equal(coverageConflictNotice([{ campaignName: '冬季活动', overlap: { type: 'collections', names: ['冬季精选'] } }]), '活动范围冲突：与「冬季活动」的指定分类重叠（冬季精选）。未执行平台操作。');
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { campaignStatus, canPauseCampaign } from '../../shared/campaign-presentation.mjs';

test('renders an uncertain active campaign as warning and prevents pausing an already paused campaign', () => {
  assert.deepEqual(campaignStatus({ status: 'active', diagnosticOutcome: 'uncertain' }), { label: '启用', tone: 'warning' });
  assert.equal(canPauseCampaign({ status: 'paused' }), false);
});

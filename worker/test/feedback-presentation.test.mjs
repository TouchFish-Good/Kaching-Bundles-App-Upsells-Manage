import test from 'node:test';
import assert from 'node:assert/strict';

import { canChangeStatus, commentManagementHeaders, commentSourceLabel, commentFiltersPath, displayStatus } from '../../shared/feedback-presentation.mjs';

test('maps a hidden rejection to the Chinese 拒绝显示 badge and disables actions for withdrawn items', () => {
  assert.deepEqual(displayStatus({ status: 'rejected', displayStatus: 'rejected_hidden' }), { label: '拒绝显示', tone: 'danger' });
  assert.equal(canChangeStatus({ displayStatus: 'withdrawn' }), false);
});

test('uses the requested comment management columns and source label without IDs', () => {
  assert.deepEqual(commentManagementHeaders, ['评论', '商家', '是否匿名', '状态', '创建时间', '所属建议', '操作']);
  assert.equal(commentSourceLabel({ feedbackTitle: '结账优化' }), '结账优化');
});

test('keeps comment date filters in the Owner list request', () => {
  assert.equal(commentFiltersPath({ query: '结账', store: 'alpha', from: '2026-11-01', to: '2026-11-03', offset: '25' }),
    '/feedback-comments?query=%E7%BB%93%E8%B4%A6&store=alpha&from=2026-11-01&to=2026-11-03&limit=25&offset=25');
});

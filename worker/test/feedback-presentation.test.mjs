import test from 'node:test';
import assert from 'node:assert/strict';

import { canChangeStatus, commentManagementHeaders, commentSourceLabel, displayStatus } from '../../shared/feedback-presentation.mjs';

test('maps a hidden rejection to the Chinese 拒绝显示 badge and disables actions for withdrawn items', () => {
  assert.deepEqual(displayStatus({ status: 'rejected', displayStatus: 'rejected_hidden' }), { label: '拒绝显示', tone: 'danger' });
  assert.equal(canChangeStatus({ displayStatus: 'withdrawn' }), false);
});

test('uses the requested comment management columns and source label without IDs', () => {
  assert.deepEqual(commentManagementHeaders, ['评论', '商家', '是否匿名', '状态', '创建时间', '所属建议', '操作']);
  assert.equal(commentSourceLabel({ feedbackTitle: '结账优化' }), '结账优化');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { metricDisplay, sourceMessage } from '../web/src/state.ts';

test('a missing source is not rendered as a real zero', () => {
  assert.equal(metricDisplay({ value: null, sourceStatus: 'unavailable' }), '未接入');
  assert.equal(metricDisplay({ value: 0, sourceStatus: 'current' }), '0');
  assert.equal(sourceMessage('stale'), '数据延迟');
});

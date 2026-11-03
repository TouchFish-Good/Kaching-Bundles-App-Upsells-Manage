import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateDiagnosticsResources } from '../scripts/verify-diagnostics-resources.mjs';

test('recognizes both worker log jobs and a seven-day R2 expiration rule', () => {
  const report = evaluateDiagnosticsResources({
    bucketName: 'kaching-worker-diagnostics',
    buckets: [{ name: 'kaching-worker-diagnostics' }],
    lifecycle: { rules: [{ id: 'expire-raw-logs', enabled: true, action: 'Delete', conditions: { age: 604800 } }] },
    jobs: [
      { name: 'kaching-merchant-raw-logs', destination_conf: 'r2://kaching-worker-diagnostics/merchant-app/{DATE}' },
      { name: 'kaching-admin-raw-logs', destination_conf: 'r2://kaching-worker-diagnostics/developer-admin/{DATE}' },
    ],
  });

  assert.equal(report.status, 'ready');
  assert.equal(report.missing.length, 0);
});

test('reports degraded diagnostics when R2 is unavailable instead of treating it as configured', () => {
  const report = evaluateDiagnosticsResources({
    bucketName: 'kaching-worker-diagnostics',
    r2Unavailable: true,
    buckets: [],
    lifecycle: null,
    jobs: [],
  });

  assert.equal(report.status, 'degraded');
  assert.match(report.message, /尚未启用 R2/);
});

import { describe, expect, it, vi } from 'vitest';
import { internalGet } from '../internal/merchant-client';
import type { Env } from '../env';

const traceId = '550e8400-e29b-41d4-a716-446655440000';
const environment = (fetch: (request: Request) => Promise<Response>) => ({
  ADMIN_INTERNAL_SECRET: 'internal-test-secret', MERCHANT_APP: { fetch },
}) as unknown as Env;

describe('internal source failure diagnostics', () => {
  it('distinguishes a timeout without retrying the signed request', async () => {
    const fetch = vi.fn(async () => { throw new DOMException('secret upstream detail', 'TimeoutError'); });
    await expect(internalGet(environment(fetch), '/campaigns', traceId)).rejects.toMatchObject({
      message: 'SOURCE_UNAVAILABLE', reason: 'timeout', upstreamStatus: null,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retains HTTP status when an upstream error page is not JSON', async () => {
    await expect(internalGet(environment(async () => new Response('secret error page', { status: 503 })), '/campaigns', traceId))
      .rejects.toMatchObject({ message: 'SOURCE_UNAVAILABLE', reason: 'invalid_json', upstreamStatus: 503 });
  });

  it('distinguishes transport failures and missing configuration', async () => {
    await expect(internalGet(environment(async () => { throw new Error('token=secret'); }), '/campaigns', traceId))
      .rejects.toMatchObject({ message: 'SOURCE_UNAVAILABLE', reason: 'transport', upstreamStatus: null });
    await expect(internalGet({ ...environment(async () => Response.json({})), ADMIN_INTERNAL_SECRET: '' }, '/campaigns', traceId))
      .rejects.toMatchObject({ reason: 'configuration' });
  });
});

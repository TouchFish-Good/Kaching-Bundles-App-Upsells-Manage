import { afterEach, expect, it, vi } from 'vitest';
import { api, ApiError, onUnauthorized } from '../../web/src/api';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('notifies the application when an authenticated API request is rejected', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 }));
  const onExpired = vi.fn();
  const unsubscribe = onUnauthorized(onExpired);

  await expect(api('/stores')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' } satisfies Partial<ApiError>);

  expect(onExpired).toHaveBeenCalledOnce();
  unsubscribe();
});

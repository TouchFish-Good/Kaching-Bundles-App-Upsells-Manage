import type { Env } from '../env';

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function signature(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function internalGet(env: Env, path: string): Promise<{ status: number; body: unknown }> {
  if (!env.ADMIN_INTERNAL_SECRET || !path.startsWith('/')) throw new Error('SOURCE_UNAVAILABLE');

  const signedPath = `/internal/admin-read/v1${path}`;
  const timestamp = String((env.now ?? Date.now)());
  const nonce = crypto.randomUUID();
  const request = new Request(`https://merchant.internal${signedPath}`, {
    headers: {
      'x-admin-timestamp': timestamp,
      'x-admin-nonce': nonce,
      'x-admin-signature': await signature(env.ADMIN_INTERNAL_SECRET, `GET\n${signedPath}\n${timestamp}\n${nonce}`),
    },
    signal: AbortSignal.timeout(5_000),
  });

  try {
    const response = await env.MERCHANT_APP.fetch(request);
    return { status: response.status, body: await response.json() };
  } catch {
    throw new Error('SOURCE_UNAVAILABLE');
  }
}

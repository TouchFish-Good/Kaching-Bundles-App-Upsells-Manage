import type { Env } from '../env';

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function signature(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

async function internalRequest(env: Env, method: 'GET' | 'PATCH' | 'POST' | 'DELETE', signedPath: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  if (!env.ADMIN_INTERNAL_SECRET || !signedPath.startsWith('/')) throw new Error('SOURCE_UNAVAILABLE');
  const timestamp = String((env.now ?? Date.now)());
  const nonce = crypto.randomUUID();
  const request = new Request(`https://merchant.internal${signedPath}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      'x-admin-timestamp': timestamp,
      'x-admin-nonce': nonce,
      'x-admin-signature': await signature(env.ADMIN_INTERNAL_SECRET, `${method}\n${signedPath}\n${timestamp}\n${nonce}`),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });

  try {
    const response = await env.MERCHANT_APP.fetch(request);
    return { status: response.status, body: await response.json() };
  } catch {
    throw new Error('SOURCE_UNAVAILABLE');
  }
}

export function internalGet(env: Env, path: string): Promise<{ status: number; body: unknown }> {
  return internalRequest(env, 'GET', `/internal/admin-read/v1${path}`);
}

export function internalPatch(env: Env, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  return internalRequest(env, 'PATCH', `/internal/admin/v1${path}`, body);
}

export function internalPost(env: Env, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  return internalRequest(env, 'POST', `/internal/admin/v1${path}`, body);
}

export function internalDelete(env: Env, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  return internalRequest(env, 'DELETE', `/internal/admin/v1${path}`, body);
}

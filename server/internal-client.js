import { createHmac, randomUUID } from 'node:crypto';

export function signInternal(secret, method, path, timestamp, nonce) {
  return createHmac('sha256', secret).update(`${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}`).digest('hex');
}

export async function internalGet(config, path) {
  if (!config.internalUrl || !config.internalSecret) throw new Error('Internal source not configured');
  const signedPath = `/internal/admin-read/v1${path}`;
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const response = await fetch(new URL(signedPath, config.internalUrl), {
    headers: {
      'x-admin-timestamp': timestamp,
      'x-admin-nonce': nonce,
      'x-admin-signature': signInternal(config.internalSecret, 'GET', signedPath, timestamp, nonce),
    },
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json();
  return { status: response.status, body };
}

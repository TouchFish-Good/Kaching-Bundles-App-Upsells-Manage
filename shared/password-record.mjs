const FORMAT = 'pbkdf2-sha256';
const DEFAULT_VERSION = 'v2';
const ITERATIONS_BY_VERSION = {
  v1: 600000,
  // Fits within the Cloudflare Workers Free CPU allowance while login throttling remains enabled.
  v2: 25000,
};
const SALT_BYTES = 16;
const HASH_BITS = 256;

const encoder = new TextEncoder();

function base64url(bytes) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64url(value) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    HASH_BITS,
  ));
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function createPasswordRecord(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iterations = ITERATIONS_BY_VERSION[DEFAULT_VERSION];
  const hash = await derive(password, salt, iterations);
  return [FORMAT, DEFAULT_VERSION, iterations, base64url(salt), base64url(hash)].join('$');
}

export async function verifyPasswordRecord(record, password) {
  try {
    const [format, version, iterations, encodedSalt, encodedHash, extra] = String(record).split('$');
    const expectedIterations = ITERATIONS_BY_VERSION[version];
    if (extra !== undefined || format !== FORMAT || !expectedIterations || iterations !== String(expectedIterations)) return false;

    const salt = fromBase64url(encodedSalt);
    const expectedHash = fromBase64url(encodedHash);
    if (salt.length !== SALT_BYTES || expectedHash.length !== HASH_BITS / 8) return false;

    return equalBytes(expectedHash, await derive(password, salt, expectedIterations));
  } catch {
    return false;
  }
}

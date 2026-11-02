const FORMAT = 'pbkdf2-sha256';
const VERSION = 'v1';
const ITERATIONS = 600000;
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
  const hash = await derive(password, salt, ITERATIONS);
  return [FORMAT, VERSION, ITERATIONS, base64url(salt), base64url(hash)].join('$');
}

export async function verifyPasswordRecord(record, password) {
  try {
    const [format, version, iterations, encodedSalt, encodedHash, extra] = String(record).split('$');
    if (extra !== undefined || format !== FORMAT || version !== VERSION || iterations !== String(ITERATIONS)) return false;

    const salt = fromBase64url(encodedSalt);
    const expectedHash = fromBase64url(encodedHash);
    if (salt.length !== SALT_BYTES || expectedHash.length !== HASH_BITS / 8) return false;

    return equalBytes(expectedHash, await derive(password, salt, ITERATIONS));
  } catch {
    return false;
  }
}

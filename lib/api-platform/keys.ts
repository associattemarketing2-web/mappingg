import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// API key format:  mgk_<key id: 16 hex>_<secret: 43 base64url chars (32 random bytes)>
//
// - The key id is a public identifier (shown in the admin, safe to log). It is
//   used only to FIND the key record — never as proof of anything.
// - Only a SHA-256 hash of the whole key is stored. The key carries 256 bits of
//   randomness, so a fast hash is the right tool (no password-style stretching
//   needed); the plaintext is shown once, at creation or rotation.
// - Verification compares hashes in constant time.

export const KEY_PREFIX = 'mgk_';
const KEY_RE = /^mgk_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$/;

export interface NewKey {
  /** Public key id (stored, shown in the admin). */
  id: string;
  /** The full secret key — return it to the admin ONCE, never store or log it. */
  secret: string;
  /** SHA-256 hex of the full key — the only form that is stored. */
  hash: string;
  /** Last 4 characters, so the admin can tell keys apart. */
  last4: string;
}

export const hashKey = (key: string) => createHash('sha256').update(key, 'utf8').digest('hex');

export function generateKey(): NewKey {
  const id = randomBytes(8).toString('hex');
  const secret = `${KEY_PREFIX}${id}_${randomBytes(32).toString('base64url')}`;
  return { id, secret, hash: hashKey(secret), last4: secret.slice(-4) };
}

/** The key id of a well-formed key, or null. Says nothing about validity. */
export function parseKey(key: string): { id: string } | null {
  const m = KEY_RE.exec(key);
  return m ? { id: m[1] } : null;
}

/** Constant-time comparison of a presented key against a stored hash. */
export function keyMatches(presented: string, storedHash: string): boolean {
  const a = Buffer.from(hashKey(presented), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The key from `Authorization: Bearer <key>`. Anything else (another scheme,
 * a malformed value, the key in a query string) is treated as missing.
 */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? m[1] : null;
}

/** Non-reversible client fingerprint for abuse limits and logs (no raw IPs stored). */
export function clientFingerprint(ip: string): string {
  return createHash('sha256').update(`${process.env.AUTH_SECRET || 'mappingg'}|api|${ip}`).digest('hex').slice(0, 16);
}

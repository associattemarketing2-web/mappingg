import crypto from 'node:crypto';
import pg from 'pg';

// Database + encryption helpers for the gateway. Same Postgres database as the
// website (DATABASE_URL); the website reads wl_accounts / wl_chats /
// wl_messages directly and asks this gateway to send.
//
// Login keys of a linked WhatsApp (wl_auth) and the media keys kept to
// re-download a photo / document (wl_messages.raw) are encrypted with
// AES-256-GCM using WA_GATEWAY_KEY. Without that key they are useless.

/** Same TLS rules as lib/pg.ts on the website. */
function tlsConfig(connectionString) {
  try {
    const url = new URL(connectionString);
    const mode = url.searchParams.get('sslmode');
    if (mode === 'disable') return { connectionString };
    if (mode && ['prefer', 'require', 'verify-ca', 'verify-full'].includes(mode)) {
      url.searchParams.delete('sslmode');
      return { connectionString: url.toString(), ssl: true };
    }
  } catch { /* fall through */ }
  if (/localhost|127\.0\.0\.1/.test(connectionString)) return { connectionString };
  return { connectionString, ssl: { rejectUnauthorized: false } };
}

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

// Same pooler fallback as lib/pg.ts: Prisma's pooler (pooled.db.prisma.io) at
// times fails every connection with "Failed to connect to upstream database"
// while the direct host (db.prisma.io) works. Then use the direct host for 10
// minutes and go back. The direct host allows only a few connections per user,
// so the pool stays small.
const POOLED_HOST = 'pooled.db.prisma.io';
const DIRECT_HOST = 'db.prisma.io';
const DIRECT_FOR_MS = 10 * 60_000;
const POOLER_DOWN = /failed to connect to upstream database/i;
let directUntil = 0;

function makePool() {
  let url = process.env.DATABASE_URL;
  if (Date.now() < directUntil) {
    try { const u = new URL(url); if (u.hostname === POOLED_HOST) { u.hostname = DIRECT_HOST; url = u.toString(); } } catch { /* as is */ }
  }
  const p = new pg.Pool({ ...tlsConfig(url), max: 4, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 15_000, keepAlive: true });
  p.on('error', (e) => console.error('[db] idle client error', e.message));
  return p;
}
let pool = makePool();

/** On a pooler outage, move to the direct host. True when the query is worth retrying there. */
function switchToDirectHost(e) {
  if (!POOLER_DOWN.test(String(e?.message || ''))) return false;
  try { if (new URL(process.env.DATABASE_URL).hostname !== POOLED_HOST) return false; } catch { return false; }
  const wasDirect = Date.now() < directUntil;
  directUntil = Date.now() + DIRECT_FOR_MS;
  if (wasDirect) return false;
  console.warn('[db] connection pooler is down — using the direct database host for 10 minutes');
  const old = pool;
  pool = makePool();
  old.end().catch(() => undefined);
  return true;
}

export async function q(text, params) {
  if (directUntil && Date.now() > directUntil) { // the direct-host window has ended: back to the pooler
    directUntil = 0;
    const old = pool;
    pool = makePool();
    old.end().catch(() => undefined);
  }
  try {
    return await pool.query(text, params);
  } catch (e) {
    if (switchToDirectHost(e)) return pool.query(text, params);
    throw e;
  }
}

export const closePool = () => pool.end();

/** Tables (kept in step with lib/wa-linked.ts on the website). */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS wl_accounts (
  id text PRIMARY KEY,
  label text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  wa_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'new',
  last_error text NOT NULL DEFAULT '',
  owner_email text NOT NULL DEFAULT '',
  members text[] NOT NULL DEFAULT '{}',
  connected_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wl_auth (
  account_id text NOT NULL,
  k text NOT NULL,
  v text NOT NULL,
  PRIMARY KEY (account_id, k)
);
CREATE TABLE IF NOT EXISTS wl_chats (
  account_id text NOT NULL,
  jid text NOT NULL,
  phone text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  is_group boolean NOT NULL DEFAULT false,
  last_text text NOT NULL DEFAULT '',
  last_at timestamptz,
  last_from_me boolean NOT NULL DEFAULT false,
  unread int NOT NULL DEFAULT 0,
  assigned_to text NOT NULL DEFAULT '',
  PRIMARY KEY (account_id, jid)
);
CREATE INDEX IF NOT EXISTS wl_chats_recent ON wl_chats (account_id, last_at DESC NULLS LAST);
CREATE TABLE IF NOT EXISTS wl_messages (
  account_id text NOT NULL,
  id text NOT NULL,
  jid text NOT NULL,
  from_me boolean NOT NULL,
  sender text NOT NULL DEFAULT '',
  kind text NOT NULL,
  body text NOT NULL DEFAULT '',
  media jsonb,
  status text NOT NULL DEFAULT '',
  ts timestamptz NOT NULL,
  history boolean NOT NULL DEFAULT false,
  sent_by text NOT NULL DEFAULT '',
  raw text,
  PRIMARY KEY (account_id, id)
);
CREATE INDEX IF NOT EXISTS wl_messages_chat ON wl_messages (account_id, jid, ts DESC);
`;

export async function migrate() {
  await q(SCHEMA);
}

/* ------------------------------ encryption ------------------------------ */

const secret = process.env.WA_GATEWAY_KEY || '';
if (secret.length < 24) throw new Error('WA_GATEWAY_KEY is not set (use a long random string, e.g. openssl rand -hex 32)');
const KEY = crypto.createHash('sha256').update(secret).digest();

/** "v1.<iv>.<tag>.<data>" (base64url). */
export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decrypt(blob) {
  const [v, iv, tag, data] = String(blob).split('.');
  if (v !== 'v1') throw new Error('Unknown encryption format');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}

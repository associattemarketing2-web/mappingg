import { query } from './pg';
import { getCurrentUser } from './auth';
import { hasPermission, listEmployees } from './staff';

// s-admin → Communication → WhatsApp Inbox: WhatsApp numbers linked by QR scan
// (linked device, like WhatsApp Web). The always-on gateway in /wa-gateway
// holds the connections and writes chats/messages to these tables; this
// website reads them and asks the gateway to send. The gateway secret never
// reaches the browser.
//
// Who sees what: the super admin sees every number. A teammate with the
// WhatsApp permission sees the numbers they linked or were added to, plus any
// chat assigned to them.
//
// Env (server-only): WA_GATEWAY_URL (e.g. https://wa-gateway.up.railway.app), WA_GATEWAY_SECRET.

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS wl_accounts (
  id text PRIMARY KEY, label text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '', wa_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'new', last_error text NOT NULL DEFAULT '', owner_email text NOT NULL DEFAULT '',
  members text[] NOT NULL DEFAULT '{}', connected_at timestamptz, last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wl_chats (
  account_id text NOT NULL, jid text NOT NULL, phone text NOT NULL DEFAULT '', name text NOT NULL DEFAULT '',
  is_group boolean NOT NULL DEFAULT false, last_text text NOT NULL DEFAULT '', last_at timestamptz,
  last_from_me boolean NOT NULL DEFAULT false, unread int NOT NULL DEFAULT 0, assigned_to text NOT NULL DEFAULT '',
  PRIMARY KEY (account_id, jid)
);
CREATE INDEX IF NOT EXISTS wl_chats_recent ON wl_chats (account_id, last_at DESC NULLS LAST);
CREATE TABLE IF NOT EXISTS wl_messages (
  account_id text NOT NULL, id text NOT NULL, jid text NOT NULL, from_me boolean NOT NULL, sender text NOT NULL DEFAULT '',
  kind text NOT NULL, body text NOT NULL DEFAULT '', media jsonb, status text NOT NULL DEFAULT '', ts timestamptz NOT NULL,
  history boolean NOT NULL DEFAULT false, sent_by text NOT NULL DEFAULT '', raw text,
  PRIMARY KEY (account_id, id)
);
CREATE INDEX IF NOT EXISTS wl_messages_chat ON wl_messages (account_id, jid, ts DESC);
`;

let ready: Promise<void> | null = null;
export function ensureTables(): Promise<void> {
  ready ??= query(SCHEMA).then(() => undefined).catch((e) => { ready = null; throw e; });
  return ready;
}

export const gatewayConfigured = () => Boolean(process.env.WA_GATEWAY_URL && process.env.WA_GATEWAY_SECRET);

export class GatewayError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

/** Calls the gateway. Throws GatewayError with a readable message. */
export async function gateway(path: string, init: { method?: string; body?: unknown; raw?: boolean; timeoutMs?: number } = {}): Promise<any> {
  if (!gatewayConfigured()) throw new GatewayError('The WhatsApp server is not set up yet (WA_GATEWAY_URL / WA_GATEWAY_SECRET).', 503);
  let res: Response;
  try {
    res = await fetch(`${process.env.WA_GATEWAY_URL!.replace(/\/+$/, '')}${path}`, {
      method: init.method || (init.body ? 'POST' : 'GET'),
      headers: { 'x-gateway-secret': process.env.WA_GATEWAY_SECRET!, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 25_000),
      cache: 'no-store',
    });
  } catch (e) {
    throw new GatewayError(`The WhatsApp server is not reachable (${(e as Error).name === 'TimeoutError' ? 'timed out' : (e as Error).message}).`, 503);
  }
  if (init.raw) {
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new GatewayError(b.error || `WhatsApp server error ${res.status}`, res.status); }
    return res;
  }
  const b = await res.json().catch(() => ({}));
  if (!res.ok) throw new GatewayError(b.error || `WhatsApp server error ${res.status}`, res.status >= 500 ? 502 : res.status);
  return b;
}

export interface Viewer { email: string; admin: boolean }

/** The signed-in user, when allowed into the WhatsApp Inbox at all. */
export async function viewer(): Promise<Viewer | null> {
  if (!(await hasPermission('whatsapp'))) return null;
  const me = await getCurrentUser();
  if (!me) return null;
  return { email: me.email.toLowerCase(), admin: me.role === 'admin' };
}

export interface Account {
  id: string; label: string; phone: string; wa_name: string; status: string; last_error: string;
  owner_email: string; members: string[]; connected_at: string | null; last_seen_at: string | null; created_at: string;
}

/** Numbers this viewer manages in full (sees every chat). */
export async function accountsFor(v: Viewer): Promise<Account[]> {
  await ensureTables();
  const r = await query<Account>(
    `SELECT * FROM wl_accounts WHERE $1 OR owner_email = $2 OR $2 = ANY(members) ORDER BY created_at`,
    [v.admin, v.email],
  );
  return r.rows;
}

/** Can this viewer manage the number (log out, delete, change who can see it)? */
export const canManage = (v: Viewer, a: Account) => v.admin || a.owner_email === v.email;

/** Can this viewer read / reply in this chat? Full access to the number, or the chat is assigned to them. */
export async function canUseChat(v: Viewer, accountId: string, jid: string): Promise<boolean> {
  await ensureTables();
  const r = await query(
    `SELECT 1 FROM wl_accounts a LEFT JOIN wl_chats c ON c.account_id = a.id AND c.jid = $3
     WHERE a.id = $2 AND ($1 OR a.owner_email = $4 OR $4 = ANY(a.members) OR c.assigned_to = $4)`,
    [v.admin, accountId, jid, v.email],
  );
  return r.rows.length > 0;
}

export async function accountFor(v: Viewer, id: string): Promise<Account | null> {
  return (await accountsFor(v)).find((a) => a.id === id) || null;
}

/** People a chat can be assigned to / a number shared with: the admin(s) + teammates with the WhatsApp permission. */
export async function team(): Promise<{ email: string; name: string }[]> {
  const out = new Map<string, string>();
  try {
    const admins = await query<{ email: string; name: string }>(`SELECT doc->>'email' AS email, COALESCE(doc->>'name', '') AS name FROM users WHERE doc->>'role' = 'admin'`);
    for (const a of admins.rows) if (a.email) out.set(a.email.toLowerCase(), a.name || '');
  } catch { /* users table shape differs — fall back to employees only */ }
  for (const e of await listEmployees().catch(() => [])) {
    if (e.email && e.permissions?.includes('whatsapp')) out.set(e.email.toLowerCase(), e.name || '');
  }
  return [...out].map(([email, name]) => ({ email, name }));
}

export const waDigits = (s: string) => String(s || '').replace(/\D/g, '');

/** Search text taken literally in LIKE (%, _ and \ are not wildcards). */
export const escapeLike = (s: string) => s.split('').map((ch) => ('%_\\'.includes(ch) ? `\\${ch}` : ch)).join('');

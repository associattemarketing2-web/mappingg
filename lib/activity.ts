import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { query } from './pg';
import { getDb } from './mongodb';

// Account activity log for the super admin's Accounts page: sign-ups, logins,
// sign-outs, compare-list changes, developer project edits and staff actions on
// an account. Stored in its own (id, doc) table, created on first use.
//
// Logging must never break the request it describes, so every write swallows
// its own errors.

export type ActivityType =
  | 'signup' | 'login' | 'logout'
  | 'compare' | 'enquiry' | 'contact'
  | 'project_added' | 'project_edited' | 'project_deleted' | 'project_approved' | 'project_rejected'
  | 'approved' | 'rejected' | 'reset' | 'password_reset' | 'notes' | 'deleted' | 'access' | 'project_admin_edit' | 'profile_edited';

export interface ActivityEvent {
  id: string;
  user_id: string;
  email: string;
  name?: string;
  role?: string;
  type: ActivityType;
  detail?: string;
  /** Staff member who did it (for admin actions on an account). */
  actor?: string;
  at: string;
  ip?: string;
  device?: string;
  /** True for events rebuilt from existing data rather than logged live. */
  derived?: boolean;
}

let ready: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  ready ??= query(`
    CREATE TABLE IF NOT EXISTS "account_activity" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
    CREATE INDEX IF NOT EXISTS account_activity_user ON "account_activity" ((doc->>'user_id'));
    CREATE INDEX IF NOT EXISTS account_activity_at ON "account_activity" ((doc->>'at') DESC);
  `).then(() => undefined).catch((e) => { ready = null; throw e; });
  return ready;
}

/** Short "Chrome on Android"-style label from a user-agent string. */
function deviceOf(ua: string): string {
  if (!ua) return '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

function requestInfo(): { ip?: string; device?: string } {
  try {
    const h = headers();
    const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || undefined;
    return { ip, device: deviceOf(h.get('user-agent') || '') || undefined };
  } catch {
    return {};
  }
}

export async function logActivity(e: {
  user_id: string; email: string; name?: string; role?: string;
  type: ActivityType; detail?: string; actor?: string;
}): Promise<void> {
  try {
    await ensureTable();
    const id = randomUUID();
    const doc: ActivityEvent = { id, ...e, email: e.email.toLowerCase(), at: new Date().toISOString(), ...requestInfo() };
    await query(`INSERT INTO "account_activity" (id, doc) VALUES ($1, $2::jsonb)`, [id, JSON.stringify(doc)]);
  } catch (err) {
    console.warn('[activity] could not log', e.type, err instanceof Error ? err.message : err);
  }
}

/** Records a successful sign-in: an activity row plus last_login_at / login_count on the account. */
export async function recordLogin(user: { id: string; email: string; name?: string; role?: string }, method: 'password' | 'google') {
  try {
    const db = await getDb();
    await db.collection('users').updateOne(
      { id: user.id },
      { $set: { last_login_at: new Date().toISOString() }, $inc: { login_count: 1 } },
    );
  } catch { /* never block sign-in */ }
  await logActivity({ ...user, user_id: user.id, type: 'login', detail: method === 'google' ? 'Signed in with Google' : 'Signed in with email' });
}

export async function listActivity(opts: { userId?: string; limit?: number } = {}): Promise<ActivityEvent[]> {
  try {
    await ensureTable();
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
    const res = opts.userId
      ? await query<{ doc: ActivityEvent }>(`SELECT doc FROM "account_activity" WHERE doc->>'user_id' = $1 ORDER BY doc->>'at' DESC LIMIT ${limit}`, [opts.userId])
      : await query<{ doc: ActivityEvent }>(`SELECT doc FROM "account_activity" ORDER BY doc->>'at' DESC LIMIT ${limit}`);
    return res.rows.map((r) => r.doc);
  } catch {
    return [];
  }
}

/** Most recent logged activity time per account. */
export async function lastActivityByUser(): Promise<Map<string, string>> {
  try {
    await ensureTable();
    const res = await query<{ uid: string; at: string }>(
      `SELECT doc->>'user_id' AS uid, max(doc->>'at') AS at FROM "account_activity" GROUP BY 1`,
    );
    return new Map(res.rows.map((r) => [r.uid, r.at]));
  } catch {
    return new Map();
  }
}

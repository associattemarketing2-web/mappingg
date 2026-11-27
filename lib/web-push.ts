import { createHash } from 'node:crypto';
import webpush, { type PushSubscription } from 'web-push';
import { query } from './pg';
import { getMongoDb, usingMongo } from './mongodb';

// Real device notifications (Web Push) for the admin team — they arrive on the
// laptop / phone like a WhatsApp message, even when the Mappingg tab is closed.
//
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — key pair (npx web-push generate-vapid-keys)
//   VAPID_SUBJECT — "mailto:…" contact the push services can reach
//
// Each browser that turns alerts on stores one row in push_subscriptions.
// notifyAdmin() (lib/mailer.ts) calls pushToAdmins(), so every alert that is
// emailed to the team also pops up on their devices. Never throws.

export interface PushRow {
  id: string;
  user_id: string;
  email: string;
  role: string;
  sub: PushSubscription;
  device?: string;
  created_at: string;
}
export interface PushMessage { title: string; body?: string; url?: string; tag?: string }

const TABLE = 'push_subscriptions';

export function pushConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let vapidSet = false;
function setup(): boolean {
  if (!pushConfigured()) return false;
  if (!vapidSet) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@mappingg.com',
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string,
      process.env.VAPID_PRIVATE_KEY as string,
    );
    vapidSet = true;
  }
  return true;
}

let ready: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (usingMongo()) return Promise.resolve();
  ready ??= query(`CREATE TABLE IF NOT EXISTS "${TABLE}" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb)`)
    .then(() => undefined).catch((e) => { ready = null; throw e; });
  return ready;
}

/** Stable id per browser endpoint, so re-subscribing just updates the row. */
const idOf = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex').slice(0, 32);

export async function saveSubscription(row: Omit<PushRow, 'id' | 'created_at'>): Promise<void> {
  await ensureTable();
  const id = idOf(row.sub.endpoint);
  const doc: PushRow = { id, ...row, created_at: new Date().toISOString() };
  if (usingMongo()) {
    await (await getMongoDb()).collection(TABLE).replaceOne({ _id: id as never }, doc, { upsert: true });
  } else {
    await query(`INSERT INTO "${TABLE}" (id, doc) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc`, [id, JSON.stringify(doc)]);
  }
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await ensureTable();
  const id = idOf(endpoint);
  if (usingMongo()) await (await getMongoDb()).collection(TABLE).deleteOne({ _id: id as never });
  else await query(`DELETE FROM "${TABLE}" WHERE id = $1`, [id]);
}

async function listSubscriptions(): Promise<PushRow[]> {
  await ensureTable();
  if (usingMongo()) return (await (await getMongoDb()).collection(TABLE).find({}).toArray()) as unknown as PushRow[];
  const r = await query<{ doc: PushRow }>(`SELECT doc FROM "${TABLE}"`);
  return r.rows.map((x) => x.doc);
}

/** Send to every subscribed device of the given rows; drops dead subscriptions. */
async function sendTo(rows: PushRow[], m: PushMessage): Promise<number> {
  if (!setup() || !rows.length) return 0;
  const payload = JSON.stringify({ title: m.title, body: m.body || '', url: m.url || '/dashboard/s-admin', tag: m.tag });
  let sent = 0;
  await Promise.all(rows.map(async (r) => {
    try {
      await webpush.sendNotification(r.sub, payload, { TTL: 24 * 3600, urgency: 'high' });
      sent++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      // 404/410 = the browser unsubscribed or the site data was cleared.
      if (code === 404 || code === 410) await removeSubscription(r.sub.endpoint).catch(() => {});
      else console.warn('[push] send failed', code || (err instanceof Error ? err.message : err));
    }
  }));
  return sent;
}

/** Push an alert to every super-admin device that turned notifications on. */
export async function pushToAdmins(m: PushMessage): Promise<number> {
  if (!pushConfigured()) return 0;
  try {
    const rows = (await listSubscriptions()).filter((r) => r.role === 'admin');
    return await sendTo(rows, m);
  } catch (err) {
    console.warn('[push] failed', err instanceof Error ? err.message : err);
    return 0;
  }
}

/** Push to one user's own devices (used by the "Send test" button). */
export async function pushToUser(userId: string, m: PushMessage): Promise<number> {
  if (!pushConfigured()) return 0;
  try {
    return await sendTo((await listSubscriptions()).filter((r) => r.user_id === userId), m);
  } catch (err) {
    console.warn('[push] failed', err instanceof Error ? err.message : err);
    return 0;
  }
}

/** Plain text from the HTML snippets notifyAdmin() builds for email. */
export function plainText(html: unknown, max = 180): string {
  const s = String(html ?? '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

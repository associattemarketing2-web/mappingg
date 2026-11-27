import { createHash } from 'node:crypto';
import webpush from 'web-push';
import { getDb, usingMongo } from './mongodb';
import { query } from './pg';
import { getStaffByEmail, type Permission } from './staff';

// Phone push notifications for the team. A teammate turns them on in the admin
// (components/PushToggle.tsx); their browser / installed app's push
// subscription is kept here, one row per device. The service worker
// (public/sw.js) shows each push and opens its link when tapped.
//   pushToStaff(msg, perm) — the admins, plus employees who have `perm`
//   pushToUser(email, msg) — one teammate's devices
// Sending never throws and never blocks the request that triggered it.
// Env: WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY, WEB_PUSH_SUBJECT (mailto: or https: URL).

export interface PushMessage {
  title: string;
  body?: string;
  /** Opened when the notification is tapped (same-site path). */
  url?: string;
  /** Same tag = replaces the earlier notification instead of stacking. */
  tag?: string;
}

interface PushSub {
  _id?: string;
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  email: string;
  role: string;
  device?: string;
  created_at: string;
  last_ok_at?: string;
}

// NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT are accepted too (same key pair, older names).
const PUB = () => process.env.WEB_PUSH_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
const PRIV = () => process.env.WEB_PUSH_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY || '';
export const pushConfigured = () => Boolean(PUB() && PRIV());
export const pushPublicKey = () => PUB();

let vapidSet = false;
function vapid(): boolean {
  if (!pushConfigured()) return false;
  if (!vapidSet) {
    webpush.setVapidDetails(process.env.WEB_PUSH_SUBJECT || process.env.VAPID_SUBJECT || 'mailto:admin@mappingg.com', PUB(), PRIV());
    vapidSet = true;
  }
  return true;
}

let ready: Promise<void> | null = null;
async function subs() {
  if (!usingMongo()) {
    ready ??= query(`CREATE TABLE IF NOT EXISTS "push_subs" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);`)
      .then(() => undefined).catch((e) => { ready = null; throw e; });
    await ready;
  }
  return (await getDb()).collection<PushSub & { _id: string }>('push_subs');
}

const idOf = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex').slice(0, 40);

/** Saves (or refreshes) one device's subscription for a teammate. */
export async function saveSubscription(user: { email: string; role: string }, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, device?: string): Promise<void> {
  const id = idOf(sub.endpoint);
  const col = await subs();
  const doc: PushSub = {
    id, endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    email: user.email.toLowerCase(), role: user.role, device: device?.slice(0, 120), created_at: new Date().toISOString(),
  };
  if (await col.findOne({ id })) await col.updateOne({ id }, { $set: { keys: doc.keys, email: doc.email, role: doc.role, device: doc.device } });
  else await col.insertOne({ ...doc, _id: id });
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await (await subs()).deleteOne({ id: idOf(endpoint) });
}

export async function hasSubscription(endpoint: string): Promise<boolean> {
  return !!(await (await subs()).findOne({ id: idOf(endpoint) }));
}

async function sendTo(list: PushSub[], msg: PushMessage): Promise<void> {
  if (!list.length || !vapid()) return;
  const payload = JSON.stringify({
    title: msg.title.slice(0, 120),
    body: (msg.body || '').replace(/\s+/g, ' ').trim().slice(0, 240),
    url: msg.url && msg.url.startsWith('/') ? msg.url : '/dashboard/s-admin',
    tag: msg.tag,
  });
  const col = await subs();
  await Promise.all(list.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 6 * 3600, urgency: 'high' });
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      // The device unsubscribed / the app was removed: forget it.
      if (code === 404 || code === 410) await col.deleteOne({ id: s.id }).catch(() => {});
      else console.warn('[push] send failed', code || '', (e as Error).message);
    }
  }));
}

/** Who may get a staff push: admins always; employees only with the permission. */
async function allowed(s: PushSub, perm?: Permission): Promise<boolean> {
  if (s.role === 'admin') return true;
  if (!perm) return false;
  const staff = await getStaffByEmail(s.email).catch(() => null);
  return !!staff && staff.role === 'employee' && staff.permissions.includes(perm);
}

async function toStaff(msg: PushMessage, perm?: Permission): Promise<void> {
  const all = await (await subs()).find({}).toArray();
  const ok = await Promise.all(all.map((s) => allowed(s, perm)));
  await sendTo(all.filter((_, i) => ok[i]), msg);
}

/** Push to the admins and to employees who have `perm`. Fire-and-forget. */
export function pushToStaff(msg: PushMessage, perm?: Permission): void {
  if (!pushConfigured()) return;
  void toStaff(msg, perm).catch((e) => console.warn('[push]', (e as Error).message));
}

/** Push to every device of one teammate. Fire-and-forget. */
export function pushToUser(email: string, msg: PushMessage): void {
  if (!pushConfigured() || !email) return;
  void (async () => sendTo(await (await subs()).find({ email: email.toLowerCase() }).toArray(), msg))()
    .catch((e) => console.warn('[push]', (e as Error).message));
}

/** A test notification to one teammate's devices (the "Send a test" button). Resolves with how many devices. */
export async function pushTest(email: string): Promise<number> {
  const list = await (await subs()).find({ email: email.toLowerCase() }).toArray();
  await sendTo(list, { title: 'Mappingg notifications are on ✅', body: 'You will get new leads, WhatsApp messages and opened links here.', url: '/dashboard/s-admin', tag: 'test' });
  return list.length;
}

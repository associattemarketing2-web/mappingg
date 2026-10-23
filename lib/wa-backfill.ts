import { getDb } from './mongodb';
import { listActivity } from './activity';
import { logMessage, messages, waDigits, type OtpPurpose } from './wa-store';

// WhatsApp messages sent before message logging existed (lib/wa-store.ts) are
// rebuilt from the account records, so the s-admin WhatsApp panel shows the
// full history:
//   - sign-up OTP     → every account with mobile_verified (only set after a WhatsApp code),
//                       including deleted accounts still in the recycle bin
//   - sign-in OTP     → "Signed in with a WhatsApp code" activity
//   - reset OTP       → "Password reset with a WhatsApp code" activity
//   - buyer welcome   → buyer accounts created since the welcome template went live
// Rebuilt rows are marked `derived` (delivery status unknown) and use fixed ids,
// so running this again never adds duplicates. Runs once per server process.

/** When the "byres_account_created" welcome template started being sent. */
const WELCOME_SINCE = '2026-10-23T05:00:00.000Z';

const PURPOSE_LABEL: Record<OtpPurpose, string> = { signup: 'sign-up', login: 'WhatsApp sign-in', reset: 'password reset' };

type User = { id?: string; _id?: string; mobile?: string; name?: string; role?: string; created_at?: string; mobile_verified?: unknown };

async function run(): Promise<number> {
  const db = await getDb();
  const users = (await db.collection<{ _id: string; [k: string]: unknown }>('users')
    .find({ role: { $in: ['buyer', 'developer', 'agent'] } }, { projection: { id: 1, mobile: 1, name: 1, role: 1, created_at: 1, mobile_verified: 1 } })
    .toArray()) as unknown as User[];
  // Accounts deleted since (e.g. test sign-ups) are still in the recycle bin — their messages were sent all the same.
  const trash = await db.collection<{ _id: string; [k: string]: unknown }>('trash').find({ kind: 'account' }).toArray();
  for (const t of trash) {
    for (const d of (t.docs as { collection?: string; doc?: User }[] | undefined) || []) {
      if (d.collection === 'users' && d.doc && ['buyer', 'developer', 'agent'].includes(String(d.doc.role))) users.push(d.doc);
    }
  }
  const byId = new Map(users.map((u) => [String(u.id || u._id), u]));
  const have = new Set((await (await messages()).find({ derived: true }, { projection: { id: 1 } }).toArray()).map((m) => m.id));

  type Row = { id: string; phone: string; at: string; name?: string; purpose: OtpPurpose | 'buyer_welcome' };
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const u of users) {
    const uid = String(u.id || u._id);
    if (seen.has(uid)) continue;
    seen.add(uid);
    const phone = waDigits(u.mobile);
    if (phone.length < 11 || !u.created_at) continue;
    if (u.mobile_verified === true) rows.push({ id: `bf-otp-signup-${uid}`, phone, at: u.created_at, name: u.name, purpose: 'signup' });
    if (u.role === 'buyer' && u.created_at >= WELCOME_SINCE) rows.push({ id: `bf-welcome-${uid}`, phone, at: u.created_at, name: u.name, purpose: 'buyer_welcome' });
  }
  for (const e of await listActivity({ limit: 1000 })) {
    const purpose: OtpPurpose | null = e.type === 'login' && e.detail === 'Signed in with a WhatsApp code' ? 'login'
      : e.type === 'password_reset' && e.detail === 'Password reset with a WhatsApp code' ? 'reset' : null;
    const phone = waDigits(byId.get(e.user_id)?.mobile);
    if (purpose && phone.length >= 11) rows.push({ id: `bf-otp-${e.id}`, phone, at: e.at, name: e.name, purpose });
  }

  let added = 0;
  rows.sort((a, b) => a.at.localeCompare(b.at));
  for (const r of rows) {
    if (have.has(r.id)) continue;
    const welcome = r.purpose === 'buyer_welcome';
    const saved = await logMessage({
      id: r.id, phone: r.phone, direction: 'out', author: 'system', kind: welcome ? 'template' : 'otp',
      template: welcome ? 'byres_account_created' : (process.env.WHATSAPP_TEMPLATE || 'mapping_mobile_verification'),
      purpose: r.purpose, status: 'sent', derived: true, created_at: r.at,
      body: welcome ? 'Buyer account created — congratulations message' : `Verification code for ${PURPOSE_LABEL[r.purpose as OtpPurpose]} (code hidden)`,
    }, { name: r.name });
    if (saved) added++;
  }
  if (added) console.log(`[wa-backfill] rebuilt ${added} earlier WhatsApp message(s) from account records`);
  return added;
}

let once: Promise<number> | null = null;
/** Rebuilds the earlier history once per server process. Never throws. */
export function backfillWhatsAppHistory(): Promise<number> {
  once ??= run().catch((e) => { console.error('[wa-backfill] failed', (e as Error).message); once = null; return 0; });
  return once;
}

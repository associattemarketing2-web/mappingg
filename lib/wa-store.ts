import { randomUUID } from 'node:crypto';
import { getDb, usingMongo } from './mongodb';
import { query } from './pg';

// Every WhatsApp message Mappingg sends or receives, for the s-admin WhatsApp
// panel. Two collections:
//   wa_chats    one row per WhatsApp number (digits only, e.g. "919876543210"):
//               name, auto-reply switch, last message, unread count, lead link.
//   wa_messages one row per message, in or out. OTP codes are never stored —
//               only that a code was sent, for which purpose, and its status.
// Logging never throws: a database hiccup must not stop a message going out.

export type WaDirection = 'in' | 'out';
/** customer = the person on WhatsApp; ai = automatic reply; staff = typed in s-admin; system = templates (OTP, welcome). */
export type WaAuthor = 'customer' | 'ai' | 'staff' | 'system';
export type WaKind = 'text' | 'template' | 'otp' | 'media' | 'other';
export type WaStatus = 'received' | 'accepted' | 'sent' | 'delivered' | 'read' | 'failed';
export type OtpPurpose = 'signup' | 'login' | 'reset';

export interface WaMessage {
  _id?: string;
  id: string;
  phone: string;
  direction: WaDirection;
  author: WaAuthor;
  /** Staff member's email (author 'staff'). */
  by?: string;
  kind: WaKind;
  body: string;
  template?: string;
  purpose?: OtpPurpose | 'buyer_welcome' | 'bulk';
  /** Bulk send batch id (s-admin → WhatsApp → Bulk send). */
  campaign?: string;
  status: WaStatus;
  error?: string;
  /** WhatsApp's own message id (wamid…), used for delivery updates and de-duplication. */
  wa_id?: string;
  edited_at?: string;
  deleted?: boolean;
  /** Rebuilt from account records (sent before message logging existed); delivery status unknown. */
  derived?: boolean;
  created_at: string;
}

export interface WaChat {
  _id?: string;
  id: string;
  phone: string;
  /** From the CRM lead (what they told us), else empty. */
  name?: string;
  /** Their WhatsApp profile name. */
  wa_name?: string;
  /** Automatic AI replies on (default) or off (staff answer by hand). */
  auto_reply: boolean;
  last_text?: string;
  last_author?: WaAuthor;
  last_at?: string;
  /** When the customer last wrote — free-text replies only reach them within 24 hours of it. */
  last_in_at?: string;
  unread: number;
  lead_id?: string;
  /** True once anything other than an OTP / automated template was exchanged. */
  has_chat?: boolean;
  created_at: string;
  updated_at: string;
}

let ready: Promise<void> | null = null;
function ensureTables(): Promise<void> {
  if (usingMongo()) return Promise.resolve();
  ready ??= query(`
    CREATE TABLE IF NOT EXISTS "wa_chats" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
    CREATE TABLE IF NOT EXISTS "wa_messages" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
    CREATE INDEX IF NOT EXISTS wa_messages_phone ON "wa_messages" ((doc->>'phone'));
    CREATE INDEX IF NOT EXISTS wa_messages_wa_id ON "wa_messages" ((doc->>'wa_id'));
  `).then(() => undefined).catch((e) => { ready = null; throw e; });
  return ready;
}

export async function chats() {
  await ensureTables();
  return (await getDb()).collection<WaChat & { _id: string }>('wa_chats');
}
export async function messages() {
  await ensureTables();
  return (await getDb()).collection<WaMessage & { _id: string }>('wa_messages');
}

/** "+91 9876543210" / "919876543210" → "919876543210". */
export const waDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** "919876543210" → "+91 98765 43210" for display. */
export function prettyPhone(digits: string): string {
  const d = waDigits(digits);
  if (d.length === 12 && d.startsWith('91')) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return d ? `+${d}` : '';
}

const preview = (m: Pick<WaMessage, 'kind' | 'body'>) => (m.kind === 'otp' ? 'Verification code' : m.body).replace(/\s+/g, ' ').slice(0, 140);

/** Saves one message and updates its chat. Resolves the stored message, or null on a database error. */
export async function logMessage(
  m: Omit<WaMessage, 'id' | 'created_at'> & { created_at?: string; id?: string },
  chat?: { name?: string },
): Promise<WaMessage | null> {
  try {
    const now = m.created_at || new Date().toISOString();
    const id = m.id || randomUUID();
    const doc: WaMessage = { ...m, phone: waDigits(m.phone), id, created_at: now };
    await (await messages()).insertOne({ _id: id, ...doc });
    const c = await chats();
    // An older message (e.g. rebuilt history) must not replace a newer "last message".
    const current = await c.findOne({ _id: doc.phone }, { projection: { last_at: 1 } });
    const newest = !current?.last_at || current.last_at <= now;
    const set: Record<string, unknown> = {
      ...(newest ? { last_text: preview(doc), last_author: doc.author, last_at: now } : {}),
      updated_at: new Date().toISOString(),
      ...(chat?.name ? { wa_name: chat.name.slice(0, 80) } : {}),
      ...(doc.direction === 'in' && newest ? { last_in_at: now } : {}),
      // Chats list = real conversations; OTP / welcome templates alone don't make one.
      ...(doc.author !== 'system' ? { has_chat: true } : {}),
    };
    await c.updateOne(
      { _id: doc.phone },
      { $set: set, $inc: { unread: doc.direction === 'in' ? 1 : 0 }, $setOnInsert: { id: doc.phone, phone: doc.phone, auto_reply: true, created_at: now } },
      { upsert: true },
    );
    return doc;
  } catch (e) {
    console.error('[wa-store] could not log message', (e as Error).message);
    return null;
  }
}

/** Delivery update from WhatsApp (sent → delivered → read, or failed). */
export async function updateStatus(waId: string, status: WaStatus, error?: string): Promise<void> {
  try {
    const rank: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
    const col = await messages();
    const m = await col.findOne({ wa_id: waId });
    // Updates can arrive out of order — never move "read" back to "delivered".
    if (!m || (rank[m.status] ?? 0) >= (rank[status] ?? 0) && status !== 'failed') return;
    await col.updateOne({ _id: m.id }, { $set: { status, ...(error ? { error: error.slice(0, 300) } : {}) } });
  } catch (e) {
    console.error('[wa-store] status update failed', (e as Error).message);
  }
}

export async function getChat(phone: string): Promise<WaChat | null> {
  return (await chats()).findOne({ _id: waDigits(phone) });
}

/** The newest `limit` messages of a chat, oldest first. */
export async function chatMessages(phone: string, limit = 300): Promise<WaMessage[]> {
  const rows = await (await messages()).find({ phone: waDigits(phone) }).sort({ created_at: -1 }).limit(limit).toArray();
  return rows.reverse().map(({ _id, ...m }) => m as WaMessage);
}

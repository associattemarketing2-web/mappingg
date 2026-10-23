import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/mongodb';
import { getCurrentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/staff';
import { chatMessages, chats, getChat, messages, prettyPhone, waDigits, type WaChat, type WaMessage } from '@/lib/wa-store';
import { whatsappConfigured, whatsappText } from '@/lib/whatsapp';
import { aiConfigured, draftReply } from '@/lib/wa-ai';
import { backfillWhatsAppHistory } from '@/lib/wa-backfill';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// s-admin WhatsApp panel (needs the 'whatsapp' permission; the owner always has it).
//   GET                 → chats list + headline numbers
//   GET ?phone=…        → one chat's messages (marks it read)
//   GET ?view=otp       → every OTP sent, with counts per purpose / status / day
//   GET ?view=auto      → automated messages (welcome templates, AI replies)
//   POST {action}       → send | auto_reply | edit | delete | draft

const fail = (message: string, status = 400) => NextResponse.json({ error: { message } }, { status });
const DAY = 86_400_000;
const strip = <T extends { _id?: string }>({ _id, ...rest }: T) => rest;

function chatRow(c: WaChat, lead?: Record<string, unknown> | null) {
  return {
    phone: c.phone, phone_display: prettyPhone(c.phone), name: c.name || c.wa_name || '', wa_name: c.wa_name || '',
    auto_reply: c.auto_reply !== false, last_text: c.last_text || '', last_author: c.last_author || null, last_at: c.last_at || null,
    last_in_at: c.last_in_at || null, unread: Number(c.unread) || 0, has_chat: Boolean(c.has_chat),
    lead: lead ? { id: String(lead.id), status: String(lead.status || 'new'), name: String(lead.name || '') } : null,
  };
}

async function leadsById(ids: string[]) {
  if (!ids.length) return new Map<string, Record<string, unknown>>();
  const rows = await (await getDb()).collection<{ _id: string; [k: string]: unknown }>('contact_leads')
    .find({ id: { $in: ids } }, { projection: { id: 1, status: 1, name: 1 } }).toArray();
  return new Map(rows.map((r) => [String(r.id), r]));
}

const istDay = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  if (!(await hasPermission('whatsapp'))) return fail('Not authorized', 401);
  const p = req.nextUrl.searchParams;
  // Messages sent before logging existed are rebuilt from account records (once per process).
  await backfillWhatsAppHistory();
  const col = await messages();

  const phone = waDigits(p.get('phone'));
  if (phone) {
    const chat = await getChat(phone);
    if (!chat) return fail('Chat not found', 404);
    if (chat.unread) await (await chats()).updateOne({ _id: phone }, { $set: { unread: 0 } });
    const lead = chat.lead_id ? (await leadsById([chat.lead_id])).get(chat.lead_id) : null;
    return NextResponse.json({ data: { chat: chatRow({ ...chat, unread: 0 }, lead), messages: await chatMessages(phone) } });
  }

  const view = p.get('view');
  if (view === 'otp' || view === 'auto') {
    const rows = (await col.find(view === 'otp' ? { kind: 'otp' } : { $or: [{ kind: 'template' }, { author: 'ai' }] }).sort({ created_at: -1 }).limit(3000).toArray()).map(strip);
    const now = Date.now();
    const by = <K extends string>(f: (m: WaMessage) => K) => rows.reduce<Record<string, number>>((acc, m) => { const k = f(m); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    const days: Record<string, number> = {};
    for (let i = 13; i >= 0; i--) days[istDay(new Date(now - i * DAY).toISOString())] = 0;
    for (const m of rows) { const d = istDay(m.created_at); if (d in days) days[d]++; }
    return NextResponse.json({
      data: {
        rows: rows.slice(0, 500).map((m) => ({ ...m, phone_display: prettyPhone(m.phone) })),
        total: rows.length,
        today: rows.filter((m) => istDay(m.created_at) === istDay(new Date().toISOString())).length,
        last7: rows.filter((m) => now - Date.parse(m.created_at) < 7 * DAY).length,
        by_purpose: by((m) => (view === 'otp' ? m.purpose || 'signup' : m.author === 'ai' ? 'ai_reply' : m.purpose || m.template || 'template')),
        by_status: by((m) => (m.status === 'failed' ? 'failed' : ['delivered', 'read'].includes(m.status) ? m.status : 'sent')),
        days,
      },
    });
  }

  // Every number we have messaged or heard from — OTP / template-only numbers too.
  const list = await (await chats()).find({}).sort({ last_at: -1 }).limit(2000).toArray();
  const leads = await leadsById(list.map((c) => c.lead_id).filter((x): x is string => Boolean(x)));
  const db = await getDb();
  const waLeads = await db.collection('contact_leads').countDocuments({ source: 'WhatsApp chat' });
  const today = istDay(new Date().toISOString());
  return NextResponse.json({
    data: {
      chats: list.map((c) => chatRow(c, c.lead_id ? leads.get(c.lead_id) : null)),
      stats: {
        chats: list.filter((c) => c.has_chat).length,
        numbers: list.length,
        unread: list.reduce((s, c) => s + (Number(c.unread) || 0), 0),
        active_today: list.filter((c) => c.last_in_at && istDay(c.last_in_at) === today).length,
        otp_total: await col.countDocuments({ kind: 'otp' }),
        ai_replies: await col.countDocuments({ author: 'ai' }),
        leads: waLeads,
      },
      config: { whatsapp: whatsappConfigured(), ai: aiConfigured(), webhook: Boolean(process.env.WHATSAPP_WEBHOOK_SECRET) },
    },
  });
}

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send'), phone: z.string().min(6).max(20), text: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal('auto_reply'), phone: z.string().min(6).max(20), on: z.boolean() }),
  z.object({ action: z.literal('edit'), id: z.string().min(1).max(64), text: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal('delete'), id: z.string().min(1).max(64) }),
  z.object({ action: z.literal('draft'), phone: z.string().min(6).max(20) }),
]);

export async function POST(req: NextRequest) {
  if (!(await hasPermission('whatsapp'))) return fail('Not authorized', 401);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('Invalid request');
  const d = parsed.data;
  const me = await getCurrentUser();

  if (d.action === 'send') {
    const phone = waDigits(d.phone);
    if (!(await getChat(phone))) return fail('Chat not found', 404);
    const r = await whatsappText(phone, d.text, 'staff', me?.email);
    if (!r.ok) return NextResponse.json({ error: { message: r.error || 'Could not send' }, data: { message: r.message } }, { status: 502 });
    return NextResponse.json({ data: { message: r.message } });
  }
  if (d.action === 'auto_reply') {
    const res = await (await chats()).updateOne({ _id: waDigits(d.phone) }, { $set: { auto_reply: d.on, updated_at: new Date().toISOString() } });
    if (!res.matchedCount) return fail('Chat not found', 404);
    return NextResponse.json({ data: { auto_reply: d.on } });
  }
  if (d.action === 'draft') {
    if (!aiConfigured()) return fail('AI replies are not set up (ANTHROPIC_API_KEY).', 503);
    try {
      const text = await draftReply(waDigits(d.phone));
      return NextResponse.json({ data: { text: text || '' } });
    } catch (e) {
      console.error('[admin/whatsapp] draft failed', (e as Error).message);
      return fail('The AI could not write a reply right now.', 502);
    }
  }

  // Edit / delete: only our own sent messages, and only in Mappingg's record —
  // the WhatsApp Business API cannot change a message already on the customer's phone.
  const col = await messages();
  const m = await col.findOne({ _id: d.id });
  if (!m) return fail('Message not found', 404);
  if (m.direction !== 'out' || m.kind === 'otp' || m.author === 'system') return fail('Only replies sent from this panel or by the AI can be changed.');
  const now = new Date().toISOString();
  if (d.action === 'edit') {
    await col.updateOne({ _id: d.id }, { $set: { body: d.text, edited_at: now, edited_by: me?.email || '' } });
  } else {
    await col.updateOne({ _id: d.id }, { $set: { deleted: true, deleted_at: now, deleted_by: me?.email || '' } });
  }
  const updated = await col.findOne({ _id: d.id });
  return NextResponse.json({ data: { message: updated ? strip(updated) : null } });
}

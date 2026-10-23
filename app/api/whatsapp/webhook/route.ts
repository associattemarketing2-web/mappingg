import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { logMessage, messages, updateStatus, waDigits, type WaKind, type WaStatus } from '@/lib/wa-store';
import { autoReply } from '@/lib/wa-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The AI reply is written before we answer (serverless functions stop once the response is sent).
export const maxDuration = 60;

// Incoming WhatsApp messages and delivery updates, forwarded by GABS.
// Set the webhook URL in GABS to:
//   https://www.mappingg.com/api/whatsapp/webhook?token=<WHATSAPP_WEBHOOK_SECRET>
// Accepts the standard WhatsApp Cloud API payload (entry[].changes[].value with
// messages[] / contacts[] / statuses[]); GET answers the hub.challenge check.
// Raw payloads are logged (first 1 KB) so the format can be checked in the server logs.

function tokenOk(req: NextRequest, given: string | null): boolean {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET || '';
  const t = given || req.nextUrl.searchParams.get('token') || req.headers.get('x-webhook-token') || '';
  if (!secret || !t) return false;
  const a = Buffer.from(secret), b = Buffer.from(t);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get('hub.mode') === 'subscribe' && tokenOk(req, p.get('hub.verify_token'))) {
    return new NextResponse(p.get('hub.challenge') || '', { status: 200 });
  }
  return NextResponse.json({ ok: tokenOk(req, null) }, { status: tokenOk(req, null) ? 200 : 403 });
}

type Obj = Record<string, any>;

/** Every `value` block carrying messages/statuses, wherever the provider nests it. */
function blocks(body: unknown): Obj[] {
  const out: Obj[] = [];
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 6) return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    const o = v as Obj;
    if (Array.isArray(o.messages) || Array.isArray(o.statuses)) { out.push(o); return; }
    for (const k of Object.keys(o)) walk(o[k], depth + 1);
  };
  walk(body, 0);
  return out;
}

/** The text a person sees for any message type. */
function textOf(m: Obj): { kind: WaKind; body: string } {
  switch (m.type) {
    case 'text': return { kind: 'text', body: String(m.text?.body ?? '') };
    case 'button': return { kind: 'text', body: String(m.button?.text ?? m.button?.payload ?? '') };
    case 'interactive': return { kind: 'text', body: String(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '') };
    case 'image': case 'video': case 'document': case 'audio': case 'sticker': {
      const cap = m[m.type]?.caption || m[m.type]?.filename || '';
      return { kind: 'media', body: `[${m.type}]${cap ? ` ${cap}` : ''}` };
    }
    case 'location': return { kind: 'media', body: `[location] ${[m.location?.name, m.location?.address].filter(Boolean).join(', ') || `${m.location?.latitude}, ${m.location?.longitude}`}` };
    case 'reaction': return { kind: 'other', body: `[reacted ${m.reaction?.emoji || ''}]` };
    default: return { kind: m.text?.body ? 'text' : 'other', body: String(m.text?.body ?? m.body ?? m.message ?? `[${m.type || 'message'}]`) };
  }
}

const STATUS: Record<string, WaStatus> = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed', undelivered: 'failed' };

export async function POST(req: NextRequest) {
  if (!tokenOk(req, null)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const raw = await req.text();
  console.log('[wa-webhook]', raw.slice(0, 1000));
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }

  const own = waDigits(process.env.WHATSAPP_SENDER || '918228828200');
  const toAnswer = new Set<string>();
  const col = await messages();

  for (const v of blocks(body)) {
    for (const s of (v.statuses as Obj[] | undefined) || []) {
      const st = STATUS[String(s.status || '').toLowerCase()];
      if (s.id && st) await updateStatus(String(s.id), st, s.errors?.[0]?.title || s.errors?.[0]?.message);
    }
    const names = new Map<string, string>();
    for (const c of (v.contacts as Obj[] | undefined) || []) if (c.wa_id) names.set(waDigits(c.wa_id), String(c.profile?.name || ''));
    for (const m of (v.messages as Obj[] | undefined) || []) {
      const phone = waDigits(m.from);
      if (!phone || phone === own) continue;
      // WhatsApp delivers at least once — skip a message we already have.
      if (m.id && await col.findOne({ wa_id: String(m.id) })) continue;
      const { kind, body: text } = textOf(m);
      const ts = Number(m.timestamp);
      await logMessage({
        phone, direction: 'in', author: 'customer', kind, body: text.slice(0, 4096), status: 'received',
        wa_id: m.id ? String(m.id) : undefined,
        created_at: ts > 1e9 && Math.abs(Date.now() - ts * 1000) < 3_600_000 ? new Date(ts * 1000).toISOString() : undefined,
      }, { name: names.get(phone) });
      if (kind !== 'other') toAnswer.add(phone);
    }
  }

  for (const phone of toAnswer) {
    try { await autoReply(phone); } catch (e) { console.error('[wa-webhook] auto-reply failed', (e as Error).message); }
  }
  return NextResponse.json({ ok: true });
}

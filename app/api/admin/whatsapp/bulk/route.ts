import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/staff';
import { messages, prettyPhone, waDigits, type WaMessage } from '@/lib/wa-store';
import { buyerWelcomeTemplate, whatsappBulkText, whatsappBulkWelcome, whatsappConfigured } from '@/lib/whatsapp';
import { extractRecipients, MAX_BULK_BYTES } from '@/lib/wa-bulk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// s-admin → WhatsApp → Bulk send (needs the 'whatsapp' permission).
//   POST multipart {file?, text?}  → numbers read from the file / pasted list (nothing is sent)
//   POST {action:'send', mode, …}  → sends the buyer welcome template, or a typed message, to one batch of up to 25 numbers;
//                                    the panel calls this batch after batch and shows progress
//   GET                            → past bulk sends with delivery counts
//   GET ?campaign=…                → every message of one bulk send

const fail = (message: string, status = 400) => NextResponse.json({ error: { message } }, { status });
const BATCH = 25;
const PARALLEL = 5;

// mode 'template' = the buyer welcome template (the one sent when a buyer signs up);
// mode 'text' = a message typed in the panel ({name} becomes each recipient's name).
const sendSchema = z.object({
  action: z.literal('send'),
  campaign: z.string().regex(/^[\w-]{6,64}$/),
  mode: z.enum(['template', 'text']).default('template'),
  text: z.string().trim().max(4000).default(''),
  recipients: z.array(z.object({ phone: z.string().min(8).max(20), name: z.string().max(80).default('') })).min(1).max(BATCH),
});

export async function POST(req: NextRequest) {
  if (!(await hasPermission('whatsapp'))) return fail('Not authorized', 401);

  if ((req.headers.get('content-type') || '').includes('multipart/form-data')) {
    const form = await req.formData().catch(() => null);
    if (!form) return fail('Could not read the upload');
    const file = form.get('file');
    const text = String(form.get('text') || '');
    try {
      if (file && typeof file !== 'string') {
        if (file.size > MAX_BULK_BYTES) return fail('File is larger than 10 MB');
        return NextResponse.json({ data: { file_name: file.name, ...extractRecipients(Buffer.from(await file.arrayBuffer()), file.name) } });
      }
      if (!text.trim()) return fail('Upload a file or paste numbers');
      return NextResponse.json({ data: { file_name: '', ...extractRecipients(Buffer.from(text.slice(0, MAX_BULK_BYTES), 'utf8'), '') } });
    } catch (e) {
      const msg = (e as Error).message;
      return fail(/not a zip|out of range|Offset/i.test(msg) ? 'This file could not be read. Try saving it again as CSV or .xlsx.' : msg);
    }
  }

  const parsed = sendSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || 'Invalid request');
  if (!whatsappConfigured()) return fail('WhatsApp is not set up on the server (WHATSAPP_API_URL / WHATSAPP_API_KEY).', 503);
  const d = parsed.data;
  if (d.mode === 'text' && !d.text) return fail('Type the message to send');
  const me = await getCurrentUser();

  const queue = d.recipients.map((r) => ({ phone: waDigits(r.phone), name: r.name.trim() }));
  const results: { phone: string; ok: boolean; error?: string }[] = [];
  async function worker() {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const res = d.mode === 'text'
        ? await whatsappBulkText(r.phone, r.name || undefined, d.text.replace(/\{name\}/gi, r.name || 'there'), d.campaign, me?.email)
        : await whatsappBulkWelcome(r.phone, r.name || undefined, d.campaign, me?.email);
      results.push({ phone: r.phone, ok: res.ok, ...(res.ok ? {} : { error: res.error || 'Not sent' }) });
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return NextResponse.json({ data: { results } });
}

export async function GET(req: NextRequest) {
  if (!(await hasPermission('whatsapp'))) return fail('Not authorized', 401);
  const col = await messages();
  const campaign = req.nextUrl.searchParams.get('campaign');
  if (campaign) {
    const rows = await col.find({ purpose: 'bulk', campaign }).sort({ created_at: 1 }).limit(10_000).toArray();
    return NextResponse.json({
      data: { rows: rows.map((m) => ({ phone: m.phone, phone_display: prettyPhone(m.phone), status: m.status, error: m.error || '', created_at: m.created_at })) },
    });
  }
  const rows = await col.find({ purpose: 'bulk' }).sort({ created_at: -1 }).limit(20_000).toArray();
  const byId = new Map<string, { id: string; template: string; text: string; by: string; started: string; total: number; failed: number; delivered: number; read: number }>();
  for (const m of rows as WaMessage[]) {
    const id = m.campaign || 'unknown';
    let c = byId.get(id);
    if (!c) {
      c = { id, template: m.template || '', text: m.kind === 'text' ? m.body.slice(0, 140) : '', by: m.by || '', started: m.created_at, total: 0, failed: 0, delivered: 0, read: 0 };
      byId.set(id, c);
    }
    c.total++;
    if (m.created_at < c.started) c.started = m.created_at;
    if (m.status === 'failed') c.failed++;
    else if (m.status === 'read') { c.read++; c.delivered++; } else if (m.status === 'delivered') c.delivered++;
  }
  return NextResponse.json({ data: { template: buyerWelcomeTemplate(), campaigns: [...byId.values()].slice(0, 50) } });
}

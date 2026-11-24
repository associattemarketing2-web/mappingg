import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/staff';
import { chats, messages, prettyPhone, waDigits, type WaMessage } from '@/lib/wa-store';
import {
  approvedTemplates, buyerWelcomeTemplate, whatsappBulkTemplate, whatsappBulkText, whatsappBulkWelcome, whatsappConfigured, whatsappProvider,
  type WaTemplate,
} from '@/lib/whatsapp';
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
  // whatapi.in: the approved template picked in the panel; params are its {{1}}… values ({name} = recipient's name).
  template: z.object({
    name: z.string().min(1).max(512),
    language: z.string().min(2).max(15),
    params: z.array(z.string().max(1000)).max(20).default([]),
    url_param: z.string().max(500).default(''),
  }).optional(),
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
  if (!whatsappConfigured()) return fail('WhatsApp is not set up on the server (WHATSAPP_META_TOKEN / WHATSAPP_PHONE_NUMBER_ID).', 503);
  const d = parsed.data;
  if (d.mode === 'text' && !d.text) return fail('Type the message to send');
  // whatapi.in: only an approved template of the account, with every {{n}} filled in.
  const tpl = d.mode === 'template' ? d.template : undefined;
  if (d.mode === 'template' && whatsappProvider() === 'meta') {
    if (!tpl) return fail('Pick a template');
    let list: WaTemplate[];
    try { list = await approvedTemplates(); } catch (e) { return fail((e as Error).message, 502); }
    const t = list.find((x) => x.name === tpl.name && x.language === tpl.language);
    if (!t) return fail(`Template "${tpl.name}" is not approved on this WhatsApp account`);
    if (tpl.params.length !== t.vars || tpl.params.some((v) => !v.trim())) return fail(`Fill all ${t.vars} values of the template`);
    if (t.urlVars && !tpl.url_param.trim()) return fail('Fill the button link value of the template');
  }
  const me = await getCurrentUser();

  const queue = d.recipients.map((r) => ({ phone: waDigits(r.phone), name: r.name.trim() }));
  const results: { phone: string; ok: boolean; error?: string }[] = [];

  // WhatsApp rule: a typed (free-text) message only reaches someone who messaged us in the last 24 hours.
  // whatapi.in still answers "queued" for everyone else and WhatsApp silently drops it — so refuse those
  // numbers here with the real reason instead of showing a fake "Sent".
  if (d.mode === 'text' && whatsappProvider() === 'meta') {
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const open = new Set(
      (await (await chats()).find({ _id: { $in: queue.map((r) => r.phone) } }, { projection: { last_in_at: 1 } }).toArray())
        .filter((c) => c.last_in_at && c.last_in_at >= since).map((c) => String(c._id)),
    );
    for (let i = queue.length - 1; i >= 0; i--) {
      if (open.has(queue[i].phone)) continue;
      results.push({ phone: queue[i].phone, ok: false, error: 'Not sent: this number has not messaged you in the last 24 hours, so WhatsApp drops typed messages. Use the Template tab.' });
      queue.splice(i, 1);
    }
  }
  async function worker() {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const fill = (v: string) => v.replace(/\{name\}/gi, r!.name || 'there');
      const res = d.mode === 'text'
        ? await whatsappBulkText(r.phone, r.name || undefined, fill(d.text), d.campaign, me?.email)
        : tpl
          ? await whatsappBulkTemplate(r.phone, r.name || undefined,
            { name: tpl.name, language: tpl.language, params: tpl.params.map(fill), urlParam: fill(tpl.url_param) || undefined }, d.campaign, me?.email)
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
  let templates: WaTemplate[] = [];
  let templatesError = '';
  try { templates = await approvedTemplates(req.nextUrl.searchParams.get('fresh') === '1'); } catch (e) { templatesError = (e as Error).message; }
  return NextResponse.json({
    data: { template: buyerWelcomeTemplate(), provider: whatsappProvider(), templates, templates_error: templatesError, campaigns: [...byId.values()].slice(0, 50) },
  });
}

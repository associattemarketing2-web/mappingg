import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/staff';
import { approvedTemplates, fallbackPayload, whatsappConfigured, whatsappProvider, type WaPayload } from '@/lib/whatsapp';
import { cancelSchedule, createSchedule, processDue, scheduleRow, schedules, MAX_RECIPIENTS, type WaSchedule } from '@/lib/wa-schedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// s-admin → WhatsApp → Send & schedule (needs the 'whatsapp' permission).
//   GET                              → schedules (newest first); also sends anything that is due
//   POST {action:'create', …}        → saves a schedule; messages timed "now" are due at once
//   POST {action:'tick', id}         → sends the due part of one schedule (send-now progress)
//   POST {action:'cancel', id, run_id?}
//   POST {action:'delete', id}       → only once nothing is left to send
const fail = (message: string, status = 400) => NextResponse.json({ error: { message } }, { status });

const header = z.union([
  z.object({ type: z.literal('text'), params: z.array(z.string().max(1000)).max(5) }),
  // An empty link (fallback templates only) means "use this message's own file".
  z.object({ type: z.enum(['image', 'video', 'document']), link: z.union([z.string().url().max(1000), z.literal('')]), filename: z.string().max(200).optional() }),
]);
const templateRef = z.object({
  name: z.string().min(1).max(512), language: z.string().min(2).max(15),
  params: z.array(z.string().max(1000)).max(20).default([]), url_param: z.string().max(500).optional(), header: header.optional(),
});
const payload = z.object({
  kind: z.enum(['text', 'image', 'video', 'document', 'template']),
  text: z.string().max(4096).optional(),
  media: z.object({ url: z.string().url().max(1000), filename: z.string().max(200).optional() }).optional(),
  template: templateRef.optional(),
  fallback: templateRef.optional(),
});
const timing = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('now') }),
  z.object({ mode: z.literal('at'), times: z.array(z.string().max(40)).min(1).max(200) }),
  z.object({ mode: z.literal('repeat'), start: z.string().max(40), every: z.number().positive().max(1000), unit: z.enum(['minutes', 'hours', 'days']), count: z.number().int().min(1).max(200) }),
]);
const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    title: z.string().max(120).default(''),
    recipients: z.array(z.object({ phone: z.string().min(8).max(20), name: z.string().max(80).optional() })).min(1).max(MAX_RECIPIENTS),
    messages: z.array(z.object({ payload, timing })).min(1).max(10),
  }),
  z.object({ action: z.literal('tick'), id: z.string().uuid() }),
  z.object({ action: z.literal('cancel'), id: z.string().uuid(), run_id: z.string().max(40).optional() }),
  z.object({ action: z.literal('delete'), id: z.string().uuid() }),
]);

/** Checks one message is complete and, for templates, approved with every value filled in. */
async function checkPayload(p: WaPayload): Promise<string> {
  if (p.kind !== 'template') {
    if (p.kind === 'text' && !p.text?.trim()) return 'Type the message';
    if (p.kind !== 'text' && !p.media?.url) return `Upload the ${p.kind === 'image' ? 'photo' : p.kind} (or paste its link)`;
    // The "not messaged in 24 h" template, as it will actually be sent.
    const fb = fallbackPayload(p);
    if (!fb) return '';
    const err = await checkPayload(fb);
    return err ? `24-hour template: ${err}` : '';
  }
  const t = p.template;
  if (!t) return 'Pick a template';
  if (whatsappProvider() !== 'meta') return '';
  const list = await approvedTemplates();
  const a = list.find((x) => x.name === t.name && x.language === t.language);
  if (!a) return `Template "${t.name}" is not approved on this WhatsApp account`;
  if (t.params.length !== a.vars || t.params.some((v) => !v.trim())) return `Fill all ${a.vars} values of template "${t.name}"`;
  if (a.urlVars && !t.url_param?.trim()) return `Fill the button link value of template "${t.name}"`;
  if (a.header === 'TEXT' && a.headerVars && (t.header?.type !== 'text' || t.header.params.length !== a.headerVars || t.header.params.some((v) => !v.trim()))) return `Fill the header value of template "${t.name}"`;
  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(a.header) && (t.header?.type !== a.header.toLowerCase() || !('link' in t.header) || !t.header.link)) {
    return `Template "${t.name}" needs a ${a.header.toLowerCase()} for its header`;
  }
  return '';
}

export async function GET() {
  if (!(await hasPermission('whatsapp'))) return fail('Not authorized', 401);
  // Opening / refreshing the panel also sends anything that has come due.
  await processDue({ budgetMs: 20_000 });
  const rows = (await (await schedules()).find({}).sort({ created_at: -1 }).limit(100).toArray()) as WaSchedule[];
  return NextResponse.json({ data: { schedules: rows.map(scheduleRow), cron: Boolean(process.env.CRON_SECRET || process.env.WHATSAPP_WEBHOOK_SECRET) } });
}

export async function POST(req: NextRequest) {
  if (!(await hasPermission('whatsapp'))) return fail('Not authorized', 401);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || 'Invalid request');
  const d = parsed.data;

  if (d.action === 'create') {
    if (!whatsappConfigured()) return fail('WhatsApp is not set up on the server (WHATSAPP_META_TOKEN / WHATSAPP_PHONE_NUMBER_ID).', 503);
    for (const [i, m] of d.messages.entries()) {
      let err = '';
      try { err = await checkPayload(m.payload as WaPayload); } catch (e) { err = (e as Error).message; }
      if (err) return fail(d.messages.length > 1 ? `Message ${i + 1}: ${err}` : err);
    }
    try {
      const me = await getCurrentUser();
      const s = await createSchedule({ title: d.title, recipients: d.recipients, messages: d.messages as WaSchedule['messages'], by: me?.email });
      return NextResponse.json({ data: { schedule: scheduleRow(s), due_now: s.runs.some((r) => Date.parse(r.at) <= Date.now()) } });
    } catch (e) {
      return fail((e as Error).message);
    }
  }
  if (d.action === 'tick') {
    const r = await processDue({ onlyId: d.id, budgetMs: 45_000 });
    const s = (await (await schedules()).findOne({ _id: d.id })) as WaSchedule | null;
    return NextResponse.json({ data: { results: r.results, pending: r.pending, schedule: s ? scheduleRow(s) : null } });
  }
  if (d.action === 'cancel') {
    if (!(await cancelSchedule(d.id, d.run_id))) return fail('Schedule not found', 404);
    return NextResponse.json({ data: { ok: true } });
  }
  const col = await schedules();
  const s = await col.findOne({ _id: d.id });
  if (!s) return fail('Schedule not found', 404);
  if (s.runs.some((r) => r.status === 'pending' || r.status === 'running')) return fail('Cancel it first — some sends are still waiting');
  await col.deleteOne({ _id: d.id });
  return NextResponse.json({ data: { ok: true } });
}

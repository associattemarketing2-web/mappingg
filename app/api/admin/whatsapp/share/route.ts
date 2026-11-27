import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/staff';
import { createShare, deleteShare, getShareById, listShares, projectChoices, projectMedia, shareRecipients, shareUrl } from '@/lib/wa-share';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// s-admin → WhatsApp → Bulk send → "Share a project" (needs the 'whatsapp' permission).
//   GET ?projects=1    → projects for the picker
//   GET ?pin=<id>      → that project's details + photos / brochures / plans / videos
//   GET ?id=<share>    → one share + every number it went to (opened or not)
//   GET                → recent shares with sent / opened counts
//   POST {action:'create', pin_id?, title?, note?, show_details, items}
//   POST {action:'delete', id}
const fail = (message: string, status = 400) => NextResponse.json({ error: { message } }, { status });
const ok = (data: unknown) => NextResponse.json({ data }, { headers: { 'Cache-Control': 'private, no-store' } });

const item = z.object({
  kind: z.enum(['photo', 'brochure', 'floor_plan', 'payment_plan', 'video', 'file']),
  url: z.string().min(1).max(1000).refine((u) => /^(https?:\/\/|\/)/.test(u), 'Invalid file link'),
  name: z.string().max(200).default(''),
});
const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'), pin_id: z.string().max(80).optional(), title: z.string().max(120).optional(),
    note: z.string().max(1000).optional(), show_details: z.boolean().default(true), items: z.array(item).max(60).default([]),
  }),
  z.object({ action: z.literal('delete'), id: z.string().uuid() }),
]);

export async function GET(req: NextRequest) {
  if (!(await hasPermission('whatsapp'))) return fail('Not authorized', 401);
  const sp = req.nextUrl.searchParams;
  try {
    if (sp.get('projects')) return ok({ projects: await projectChoices() });
    const pin = sp.get('pin');
    if (pin) {
      const m = await projectMedia(pin);
      return m ? ok(m) : fail('Project not found', 404);
    }
    const id = sp.get('id');
    if (id) {
      const s = await getShareById(id);
      if (!s || s.deleted) return fail('Share not found', 404);
      return ok({ share: { ...s, url: shareUrl(s.code) }, recipients: await shareRecipients(id) });
    }
    return ok({ shares: await listShares() });
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}

export async function POST(req: NextRequest) {
  if (!(await hasPermission('whatsapp'))) return fail('Not authorized', 401);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || 'Invalid request');
  const d = parsed.data;
  try {
    if (d.action === 'delete') { await deleteShare(d.id); return ok({ ok: true }); }
    const me = await getCurrentUser();
    const s = await createShare({ pin_id: d.pin_id || undefined, title: d.title, note: d.note, show_details: d.show_details, items: d.items, by: me?.email });
    return ok({ share: { ...s, url: shareUrl(s.code), sent: 0, opened: 0 } });
  } catch (e) {
    return fail((e as Error).message);
  }
}

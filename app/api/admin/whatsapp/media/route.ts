import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/staff';
import { mediaUrl, PART_BYTES, savePart, startUpload } from '@/lib/wa-media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// s-admin → WhatsApp: upload a photo / video / document to send.
//   POST {kind, name, mime, size}       → { id, part_bytes, parts }
//   PUT  ?id=…&idx=n   (raw bytes)       → { complete, url } — url once every part is in
const fail = (message: string, status = 400) => NextResponse.json({ error: { message } }, { status });

const startSchema = z.object({
  kind: z.enum(['image', 'video', 'document']),
  name: z.string().min(1).max(200),
  mime: z.string().max(120).default(''),
  size: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
  if (!(await hasPermission('whatsapp'))) return fail('Not authorized', 401);
  const parsed = startSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('Invalid upload');
  const d = parsed.data;
  try {
    const me = await getCurrentUser();
    const m = await startUpload(d.kind, d.name, d.mime, d.size, me?.email);
    return NextResponse.json({ data: { id: m.id, part_bytes: PART_BYTES, parts: m.parts } });
  } catch (e) {
    return fail((e as Error).message);
  }
}

export async function PUT(req: NextRequest) {
  if (!(await hasPermission('whatsapp'))) return fail('Not authorized', 401);
  const id = req.nextUrl.searchParams.get('id') || '';
  const idx = Number(req.nextUrl.searchParams.get('idx'));
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length > PART_BYTES) return fail('Part too large');
  try {
    const m = await savePart(id, idx, bytes);
    return NextResponse.json({ data: { complete: m.complete, url: m.complete ? mediaUrl(m) : '', name: m.name, mime: m.mime } });
  } catch (e) {
    return fail((e as Error).message);
  }
}

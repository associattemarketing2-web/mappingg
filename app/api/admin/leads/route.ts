import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/mongodb';
import { hasPermission } from '@/lib/staff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// CRM leads (contact-form submissions). Admin-only; needs the 'leads' permission
// (the owner always has it).
const STATUSES = ['new', 'contacted', 'won', 'lost'] as const;

function strip<T extends Record<string, any>>(doc: T) {
  const { _id, ...rest } = doc;
  return rest;
}

export async function GET() {
  if (!(await hasPermission('leads'))) {
    return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  }
  const db = await getDb();
  const rows = await db.collection('contact_leads').find({}).sort({ created_at: -1 }).limit(5000).toArray();
  return NextResponse.json({ data: rows.map((r) => strip(r as Record<string, any>)) });
}

const patchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(STATUSES).optional(),
  notes: z.string().max(4000).optional(),
});

export async function PATCH(req: NextRequest) {
  if (!(await hasPermission('leads'))) {
    return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: 'Invalid request' } }, { status: 400 });
  }
  const { id, status, notes } = parsed.data;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status) patch.status = status;
  if (typeof notes === 'string') patch.notes = notes;

  const db = await getDb();
  const res = await db.collection('contact_leads').updateOne({ id }, { $set: patch });
  if (!res.matchedCount) return NextResponse.json({ error: { message: 'Lead not found' } }, { status: 404 });
  const row = await db.collection('contact_leads').findOne({ id });
  return NextResponse.json({ data: row ? strip(row as Record<string, any>) : null });
}

export async function DELETE(req: NextRequest) {
  if (!(await hasPermission('leads'))) {
    return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  }
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: { message: 'Missing id' } }, { status: 400 });
  const db = await getDb();
  await db.collection('contact_leads').deleteOne({ id });
  return NextResponse.json({ data: { ok: true } });
}

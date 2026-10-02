import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getStaffUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { runDbOp } from '@/lib/db-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Super-admin review queue for projects submitted by developers from their
// dashboard. A submission is a `pin` with `pending_review: true` (hidden from
// the public map). Approving makes it live; rejecting keeps it hidden.
type PinDoc = { _id?: string; [k: string]: unknown };

const actionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(['approve', 'reject']),
});

export async function GET() {
  if (!(await getStaffUser())) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });

  const db = await getDb();
  const rows = (await db
    .collection<PinDoc>('pins')
    .find(
      { pending_review: true },
      { projection: { id: 1, title: 1, location: 1, status: 1, type: 1, price: 1, developer: 1, description: 1, lat: 1, lng: 1, owner_user_id: 1, created_at: 1 } },
    )
    .sort({ created_at: -1 })
    .toArray()) as PinDoc[];

  // Attach the submitting developer's name/email for context.
  const ownerIds = [...new Set(rows.map((r) => r.owner_user_id).filter(Boolean))];
  const owners = ownerIds.length
    ? (await db.collection('users').find({ id: { $in: ownerIds } }, { projection: { id: 1, name: 1, email: 1 } }).toArray())
    : [];
  const byId = new Map(owners.map((o) => [String(o.id), o]));

  const data = rows.map((p) => ({
    id: String(p.id), title: String(p.title || ''), location: String(p.location || ''),
    status: String(p.status || ''), type: String(p.type || ''), price: String(p.price || ''),
    developer: String(p.developer || ''), description: String(p.description || ''),
    lat: p.lat ?? null, lng: p.lng ?? null, hasLocation: p.lat != null && p.lng != null,
    owner: (() => { const o = byId.get(String(p.owner_user_id)); return o ? { name: String(o.name || ''), email: String(o.email || '') } : null; })(),
    created_at: String(p.created_at || ''),
  }));
  return NextResponse.json({ data }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req: NextRequest) {
  if (!(await getStaffUser())) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });

  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { message: 'Invalid request' } }, { status: 400 });
  const { id, action } = parsed.data;

  // Use runDbOp so the public-map read cache is invalidated on approval.
  const values = action === 'approve'
    ? { pending_review: false, rejected: false, hidden: false }
    : { pending_review: false, rejected: true, hidden: true };
  const res = await runDbOp(
    { table: 'pins', action: 'update', filters: [{ op: 'eq', col: 'id', val: id }], values },
    true,
  );
  if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ data: { id, action } }, { headers: { 'Cache-Control': 'private, no-store' } });
}

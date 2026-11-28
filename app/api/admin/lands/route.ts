import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { hasPermission } from '@/lib/staff';
import { logActivity } from '@/lib/activity';
import { idsParam, moveToTrash } from '@/lib/trash';
import { getLand, landInput, listLands, reviewLand, updateLand } from '@/lib/lands';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Super admin → Land: every land listing added by channel partners.
// Viewing needs the Accounts permission (the owner always has it); approving,
// rejecting, editing and deleting are super-admin only.

const fail = (message: string, status = 400) => NextResponse.json({ error: { message } }, { status });

async function owner() {
  const me = await getCurrentUser();
  return me && me.role === 'admin' ? me : null;
}

export async function GET() {
  if (!(await hasPermission('accounts'))) return fail('Not authorized', 401);
  const lands = await listLands();
  // Channel partners and whether each may add land (for the "Land access" list).
  const db = await getDb();
  const cps = await db.collection('users')
    .find({ role: 'agent' }, { projection: { id: 1, name: 1, email: 1, mobile: 1, can_add_land: 1, verification: 1, verified: 1, profile: 1 } })
    .sort({ created_at: -1 }).limit(5000).toArray();
  return NextResponse.json({
    data: lands,
    partners: cps.map((u) => ({
      id: String(u.id), name: String(u.name || ''), email: String(u.email || ''), mobile: String(u.mobile || ''),
      agency: String((u.profile as Record<string, string> | undefined)?.agency || ''),
      can_add_land: u.can_add_land === true,
      verified: u.verification === 'approved' || (u.verification === undefined && u.verified === true),
    })),
  });
}

const reviewSchema = z.object({
  id: z.string().min(1).max(80),
  decision: z.enum(['approve', 'reject', 'reset']),
  note: z.string().trim().max(1000).optional().default(''),
});

export async function PATCH(req: NextRequest) {
  const me = await owner();
  if (!me) return fail('Only the super admin can approve land.', 403);
  const parsed = reviewSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail('Invalid request');
  const { id, decision, note } = parsed.data;
  if (decision === 'reject' && !note) return fail('Please write a reason — the partner will see it.');
  const land = await reviewLand(id, decision, note, me.email);
  if (!land) return fail('Land not found', 404);
  if (decision !== 'reset') {
    await logActivity({
      user_id: land.cp_id, email: land.cp_email, name: land.cp_name, role: 'agent', actor: me.email,
      type: decision === 'approve' ? 'land_approved' : 'land_rejected',
      detail: decision === 'approve' ? `Land approved: ${land.title}` : `Land not approved: ${land.title} — ${note}`,
    });
  }
  return NextResponse.json({ data: land });
}

export async function PUT(req: NextRequest) {
  const me = await owner();
  if (!me) return fail('Only the super admin can edit land.', 403);
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!id || !(await getLand(id))) return fail('Land not found', 404);
  const parsed = landInput.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || 'Please check the details');
  // A staff correction keeps the current approval status.
  return NextResponse.json({ data: await updateLand(id, parsed.data, { resetReview: false }) });
}

export async function DELETE(req: NextRequest) {
  const me = await owner();
  if (!me) return fail('Only the super admin can delete land.', 403);
  const ids = idsParam(req.nextUrl.searchParams);
  if (!ids.length) return fail('Missing id');
  const db = await getDb();
  let deleted = 0;
  for (const id of ids) {
    const cur = await getLand(id);
    if (!cur) continue;
    await moveToTrash({ kind: 'land', label: cur.title, sub: `${cur.location} · by ${cur.cp_name || cur.cp_email}`, docs: [{ collection: 'lands', doc: { ...cur, _id: cur.id } }], deletedBy: me.email });
    await db.collection('lands').deleteOne({ id });
    deleted++;
  }
  return NextResponse.json({ data: { ok: true, deleted } });
}

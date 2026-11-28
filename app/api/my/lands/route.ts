import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { logActivity } from '@/lib/activity';
import { moveToTrash } from '@/lib/trash';
import { verificationOf } from '@/lib/verification';
import { cpLandAccess, createLand, forDeveloper, getLand, landInput, listLands, updateLand } from '@/lib/lands';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Land for signed-in accounts (see lib/lands.ts):
//   • channel partner → only the land they added (+ whether they may add land)
//   • approved developer → every approved land listing, with the CP's contact
// Staff use /api/admin/lands.

const fail = (message: string, status = 400) => NextResponse.json({ error: { message } }, { status });

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return fail('Please sign in', 401);
  if (me.role === 'agent') {
    const access = await cpLandAccess(me.id);
    return NextResponse.json({ data: await listLands({ cp_id: me.id }), can_add: access.ok, reason: access.reason || '' });
  }
  if (me.role === 'developer') {
    const db = await getDb();
    const doc = await db.collection('users').findOne({ id: me.id });
    if (verificationOf(doc) !== 'approved') return fail('Your account is waiting for approval.', 403);
    return NextResponse.json({ data: (await listLands({ status: 'approved' })).map(forDeveloper) });
  }
  return fail('Not available for this account', 403);
}

async function cpOnly() {
  const me = await getCurrentUser();
  if (!me || me.role !== 'agent') return { error: fail('Only channel partners can manage land.', 403) };
  const access = await cpLandAccess(me.id);
  if (!access.ok || !access.user) return { error: fail(access.reason || 'Not allowed', 403) };
  return { me, user: access.user };
}

export async function POST(req: NextRequest) {
  const g = await cpOnly();
  if ('error' in g) return g.error;
  const parsed = landInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || 'Please check the details');
  const land = await createLand(parsed.data, g.user);
  await logActivity({ user_id: g.me.id, email: g.me.email, name: String(g.user.name || ''), role: 'agent', type: 'land_added', detail: `Added land: ${land.title} (${land.location})` });
  return NextResponse.json({ data: land }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const g = await cpOnly();
  if ('error' in g) return g.error;
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  const cur = id ? await getLand(id) : null;
  if (!cur || cur.cp_id !== g.me.id) return fail('Land not found', 404);
  const parsed = landInput.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || 'Please check the details');
  // Any change by the CP goes back to the team for approval.
  const land = await updateLand(id, parsed.data, { resetReview: true });
  await logActivity({ user_id: g.me.id, email: g.me.email, name: String(g.user.name || ''), role: 'agent', type: 'land_edited', detail: `Edited land: ${parsed.data.title}` });
  return NextResponse.json({ data: land });
}

export async function DELETE(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me || me.role !== 'agent') return fail('Only channel partners can manage land.', 403);
  const id = req.nextUrl.searchParams.get('id') || '';
  const cur = id ? await getLand(id) : null;
  if (!cur || cur.cp_id !== me.id) return fail('Land not found', 404);
  // Kept in Backups → Recycle bin so the team can restore it.
  await moveToTrash({ kind: 'land', label: cur.title, sub: `${cur.location} · by ${cur.cp_name || cur.cp_email}`, docs: [{ collection: 'lands', doc: { ...cur, _id: cur.id } }], deletedBy: me.email });
  const db = await getDb();
  await db.collection('lands').deleteOne({ id });
  await logActivity({ user_id: me.id, email: me.email, name: cur.cp_name, role: 'agent', type: 'land_deleted', detail: `Deleted land: ${cur.title}` });
  return NextResponse.json({ data: { ok: true } });
}

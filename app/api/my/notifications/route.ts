import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Notification bell in the developer dashboard: the review status of every
// project this developer added — waiting for approval, approved (live on the
// map) or not approved (with the super admin's reason). Built from the
// developer's own pins. "Unread" = changed since they last opened the bell.
type Doc = { _id?: string; [k: string]: any };

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'developer') return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });

  const db = await getDb();
  const [me, pins] = await Promise.all([
    db.collection('users').findOne({ id: user.id }, { projection: { notif_seen_at: 1 } }),
    db.collection<Doc>('pins').find(
      { owner_user_id: user.id },
      { projection: { id: 1, title: 1, location: 1, created_at: 1, updated_at: 1, pending_review: 1, rejected: 1, reviewed_at: 1, review_note: 1 } },
    ).toArray(),
  ]);
  const seen = String(me?.notif_seen_at || '');

  const items = pins.map((p) => {
    const name = `“${String(p.title || 'Untitled project')}”${p.location ? ` in ${String(p.location)}` : ''}`;
    const state: 'pending' | 'approved' | 'rejected' = p.pending_review ? 'pending' : p.rejected ? 'rejected' : 'approved';
    const at = String((state === 'pending' ? p.updated_at || p.created_at : p.reviewed_at || p.updated_at || p.created_at) || '');
    const detail = state === 'pending'
      ? `${name} is waiting for approval by the Mappingg team`
      : state === 'approved'
        ? `${name} was approved — it is now live on the map`
        : `${name} was not approved${p.review_note ? `: ${String(p.review_note)}` : ''}. Edit it and send it again.`;
    return { id: `${p.id}-${state}-${at}`, project_id: String(p.id), state, detail, at };
  })
    .filter((i) => i.at)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 40)
    // Pending items only count as new when just submitted; decisions are what developers wait for.
    .map((i) => ({ ...i, unread: i.state !== 'pending' && (!seen || i.at > seen) }));

  const counts = {
    pending: pins.filter((p) => p.pending_review).length,
    approved: pins.filter((p) => !p.pending_review && !p.rejected).length,
    rejected: pins.filter((p) => !p.pending_review && p.rejected).length,
  };
  return NextResponse.json(
    { data: { counts, unread: items.filter((i) => i.unread).length, items } },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

/** Mark everything as read for this developer. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'developer') return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  const db = await getDb();
  await db.collection('users').updateOne({ id: user.id }, { $set: { notif_seen_at: new Date().toISOString() } });
  return NextResponse.json({ data: { ok: true } });
}

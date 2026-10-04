import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { hasPermission } from '@/lib/staff';
import { listActivity } from '@/lib/activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Notification bell in the admin top bar: projects developers added or edited
// (built from the pins themselves, so nothing is missed), projects they deleted
// (from the activity log) and new developer / partner sign-ups. "Unread" =
// newer than the time this staff member last opened the bell, stored on their
// own user record.
type Doc = { _id?: string; [k: string]: any };
interface Item { id: string; type: string; user_id: string; name: string; role?: string; detail: string; at: string; project_id?: string }

export async function GET() {
  if (!(await hasPermission('intake')) && !(await hasPermission('accounts'))) {
    return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  }
  const me = await getCurrentUser();
  const db = await getDb();
  const [mine, pins, people, logged] = await Promise.all([
    me ? db.collection('users').findOne({ id: me.id }, { projection: { notif_seen_at: 1 } }) : null,
    db.collection<Doc>('pins').find({ owner_user_id: { $exists: true } }, { projection: { id: 1, title: 1, location: 1, owner_user_id: 1, created_at: 1, updated_at: 1, pending_review: 1, rejected: 1 } }).toArray(),
    db.collection<Doc>('users').find({ role: { $in: ['developer', 'agent'] } }, { projection: { id: 1, name: 1, email: 1, role: 1, created_at: 1 } }).toArray(),
    listActivity({ limit: 300 }),
  ]);
  const seen = String(mine?.notif_seen_at || '');
  const who = new Map(people.map((u) => [String(u.id), u]));
  const nameOf = (id: string, fallback = 'A developer') => { const u = who.get(id); return u ? String(u.name || u.email) : fallback; };

  const items: Item[] = [];
  for (const p of pins) {
    const uid = String(p.owner_user_id);
    const title = `“${String(p.title || 'Untitled project')}”${p.location ? ` in ${String(p.location)}` : ''}`;
    const edited = p.updated_at && p.created_at && String(p.updated_at) > String(p.created_at) && p.pending_review;
    const state = p.pending_review ? 'waiting for approval' : p.rejected ? 'not approved' : 'live on the map';
    items.push({
      id: `pin-${p.id}-${edited ? p.updated_at : p.created_at}`, type: edited ? 'project_edited' : 'project_added',
      user_id: uid, name: nameOf(uid), role: 'developer', project_id: String(p.id),
      detail: `${edited ? 'Edited' : 'Added'} ${title} — ${state}`, at: String(edited ? p.updated_at : p.created_at || ''),
    });
  }
  for (const u of people) {
    if (!u.created_at) continue;
    items.push({ id: `signup-${u.id}`, type: 'signup', user_id: String(u.id), name: String(u.name || u.email), role: String(u.role),
      detail: `New ${u.role === 'developer' ? 'developer' : 'channel partner'} account`, at: String(u.created_at) });
  }
  for (const e of logged) {
    if (e.type !== 'project_deleted') continue;
    items.push({ id: e.id, type: e.type, user_id: e.user_id, name: e.name || nameOf(e.user_id, e.email), role: e.role, detail: e.detail || 'Deleted a project', at: e.at });
  }

  const list = items.filter((i) => i.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30)
    .map((i) => ({ ...i, unread: !!seen && i.at > seen || (!seen && Date.now() - new Date(i.at).getTime() < 7 * 86400000) }));
  const pendingProjects = pins.filter((p) => p.pending_review).length;
  return NextResponse.json(
    { data: { pendingProjects, unread: list.filter((i) => i.unread).length, items: list } },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

/** Mark everything as read for the signed-in staff member. */
export async function POST() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  const db = await getDb();
  await db.collection('users').updateOne({ id: me.id }, { $set: { notif_seen_at: new Date().toISOString() } });
  return NextResponse.json({ data: { ok: true } });
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { getDb, usingMongo, getMongoDb } from '@/lib/mongodb';
import { query } from '@/lib/pg';
import { hasPermission } from '@/lib/staff';
import { invalidateTable } from '@/lib/db-engine';
import { logActivity } from '@/lib/activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Super admin → Accounts → a developer → "Projects access".
// Assigning a project to a developer account makes it theirs (owner_user_id):
// it then shows in their dashboard, Map Editor and Projects intake exactly like
// the projects they added themselves. Assigning never changes the project
// itself — a live project stays live; only the developer's own later edits go
// through the usual review. Unassigning just unlinks it (the project stays).
type Doc = { _id?: string; [k: string]: any };
const unauthorized = () => NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
const NO_STORE = { 'Cache-Control': 'private, no-store' };
const FIELDS = { id: 1, number: 1, title: 1, developer: 1, location: 1, hidden: 1, pending_review: 1, rejected: 1, owner_user_id: 1, assigned_at: 1 };
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function developerAccount(id: string) {
  const u = await (await getDb()).collection<Doc>('users').findOne({ id }, { projection: { id: 1, email: 1, name: 1, role: 1 } });
  return u && u.role === 'developer' ? u : null;
}

function row(p: Doc, owners: Map<string, Doc>) {
  const owner = p.owner_user_id ? owners.get(String(p.owner_user_id)) : null;
  return {
    id: String(p.id), number: p.number ?? null, title: String(p.title || ''), developer: String(p.developer || ''), location: String(p.location || ''),
    state: p.pending_review ? 'pending' : p.rejected ? 'rejected' : p.hidden ? 'hidden' : 'live',
    owner: p.owner_user_id ? { id: String(p.owner_user_id), name: String(owner?.name || ''), email: String(owner?.email || '') } : null,
    assigned: !!p.assigned_at,
  };
}

async function withOwners(pins: Doc[]) {
  const ids = [...new Set(pins.map((p) => p.owner_user_id).filter(Boolean).map(String))];
  const users = ids.length ? await (await getDb()).collection<Doc>('users').find({ id: { $in: ids } }, { projection: { id: 1, name: 1, email: 1 } }).toArray() : [];
  const owners = new Map(users.map((u) => [String(u.id), u]));
  return pins.map((p) => row(p, owners));
}

// GET ?dev=<user id>            → the projects this developer has (added + assigned)
// GET ?dev=<user id>&q=<text>   → also: map projects matching title / developer / location / pin number
export async function GET(req: NextRequest) {
  if (!(await hasPermission('accounts'))) return unauthorized();
  const dev = String(req.nextUrl.searchParams.get('dev') || '');
  const q = String(req.nextUrl.searchParams.get('q') || '').trim().slice(0, 80);
  if (!dev || !(await developerAccount(dev))) return NextResponse.json({ error: { message: 'Developer account not found' } }, { status: 404 });
  const pins = (await getDb()).collection<Doc>('pins');
  const mine = await pins.find({ owner_user_id: dev }, { projection: FIELDS }).toArray();
  let results: Doc[] = [];
  if (q.length >= 2) {
    const re = { $regex: escapeRe(q), $options: 'i' };
    const or: Doc[] = [{ title: re }, { developer: re }, { location: re }];
    if (/^\d{1,6}$/.test(q)) or.push({ number: Number(q) }, { number: q });
    results = await pins.find({ $or: or }, { projection: FIELDS }).limit(300).toArray();
    results.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  }
  return NextResponse.json({ data: { projects: await withOwners(mine), results: await withOwners(results) } }, { headers: NO_STORE });
}

const postSchema = z.object({
  dev: z.string().min(1).max(100),
  action: z.enum(['assign', 'unassign']),
  pin_ids: z.array(z.string().min(1).max(100)).min(1).max(500),
});

export async function POST(req: NextRequest) {
  if (!(await hasPermission('accounts'))) return unauthorized();
  const actor = await getCurrentUser();
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { message: 'Invalid request.' } }, { status: 400 });
  const { dev, action, pin_ids } = parsed.data;
  const account = await developerAccount(dev);
  if (!account) return NextResponse.json({ error: { message: 'Developer account not found' } }, { status: 404 });

  const pins = (await getDb()).collection<Doc>('pins');
  const now = new Date().toISOString();
  let changed: Doc[] = [];
  if (action === 'assign') {
    // Only pins that aren't already this developer's. Moving a project away from
    // another developer is allowed (the admin sees the current owner first).
    changed = (await pins.find({ id: { $in: pin_ids } }, { projection: { id: 1, title: 1, owner_user_id: 1 } }).toArray()).filter((p) => String(p.owner_user_id || '') !== dev);
    if (changed.length) {
      await pins.updateMany({ id: { $in: changed.map((p) => String(p.id)) } }, { $set: { owner_user_id: dev, assigned_at: now, assigned_by: actor?.email || '' } });
    }
  } else {
    changed = await pins.find({ id: { $in: pin_ids }, owner_user_id: dev }, { projection: { id: 1, title: 1 } }).toArray();
    const ids = changed.map((p) => String(p.id));
    if (ids.length) {
      // The Mongo-compatible layer has no $unset, so remove the keys in SQL.
      if (usingMongo()) {
        await (await getMongoDb()).collection('pins').updateMany({ id: { $in: ids }, owner_user_id: dev }, { $unset: { owner_user_id: '', assigned_at: '', assigned_by: '' } });
      } else {
        await query(`UPDATE "pins" SET doc = doc - 'owner_user_id' - 'assigned_at' - 'assigned_by' WHERE id = ANY($1::text[]) AND doc->>'owner_user_id' = $2`, [ids, dev]);
      }
    }
  }
  if (changed.length) {
    invalidateTable('pins');
    const names = changed.slice(0, 5).map((p) => `“${String(p.title || 'Untitled')}”`).join(', ') + (changed.length > 5 ? ` and ${changed.length - 5} more` : '');
    await logActivity({
      user_id: dev, email: String(account.email || ''), name: String(account.name || ''), role: 'developer',
      type: action === 'assign' ? 'project_assigned' : 'project_unassigned',
      detail: action === 'assign' ? `Given access to ${changed.length} project${changed.length === 1 ? '' : 's'}: ${names}` : `Access removed from ${changed.length} project${changed.length === 1 ? '' : 's'}: ${names}`,
      actor: actor?.email || '',
    }).catch(() => {});
  }
  return NextResponse.json({ data: { changed: changed.length } }, { headers: NO_STORE });
}

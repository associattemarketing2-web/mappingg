import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { runDbOp } from '@/lib/db-engine';
import { hasPermission } from '@/lib/staff';
import { mediaUrl } from '@/lib/pin-media';
import { logActivity } from '@/lib/activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Projects added by developers from their dashboard (pins with an
// owner_user_id). New and edited ones wait as `pending_review` (hidden from the
// public map) until the super admin approves them. Staff with the "intake"
// permission can view the list; only the super admin (owner) can decide.
type PinDoc = { _id?: string; [k: string]: unknown };

const actionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(1000).optional(),
});

const stateOf = (p: PinDoc): 'pending' | 'approved' | 'rejected' =>
  p.pending_review ? 'pending' : p.rejected ? 'rejected' : 'approved';

// Every field a developer can fill in, in the order the super admin reviews them.
const DETAIL_FIELDS: [string, string][] = [
  ['title', 'Project name'], ['developer', 'Developer / company'], ['type', 'Property type'], ['status', 'Project status'],
  ['location', 'Location'], ['price', 'Starting price'], ['configuration', 'Configuration'], ['sqft', 'Carpet area'],
  ['size', 'Project size'], ['possession_timeline', 'Possession'], ['launch_date', 'Launch date'],
  ['whats_available', "What's available"], ['rera_number', 'MahaRERA number'], ['key_usp', 'Key USP'],
  ['description', 'Description'], ['youtube_video_url', 'Project video'], ['lat', 'Latitude'], ['lng', 'Longitude'],
];
const IMAGE_FIELDS: [string, string][] = [['image', 'Logo / photo'], ['brochure_image', 'Brochure']];
const str = (v: unknown) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).trim();
const customList = (v: unknown) => (Array.isArray(v) ? v : [])
  .filter((c) => c && (c.label || c.value))
  .map((c) => ({ label: str(c.label) || 'Custom field', value: str(c.value) }));

/** Full details of one developer project + what changed in the latest edit. */
async function detail(id: string) {
  const db = await getDb();
  const p = await db.collection<PinDoc>('pins').findOne({ id, owner_user_id: { $exists: true } });
  if (!p) return null;
  const img = (field: string, doc: PinDoc) => {
    const v = typeof doc[field] === 'string' ? (doc[field] as string) : '';
    return v ? (v.startsWith('data:') ? mediaUrl('pins', id, field, v) : v) : '';
  };
  const fields = DETAIL_FIELDS.map(([k, label]) => ({ key: k, label, value: str(p[k]) }));
  const images = IMAGE_FIELDS.map(([k, label]) => ({ key: k, label, url: img(k, p) }));

  // For an edit waiting for approval: compare with the version saved just before it.
  let changes: { label: string; before: string; after: string }[] | null = null;
  let previousAt = '';
  const sent = String(p.submitted_at || p.updated_at || '');
  const edited = !!(p.pending_review && sent && p.created_at && sent > String(p.created_at));
  if (edited) {
    const hist = await db.collection<PinDoc>('pins_history')
      .find({ pin_id: id, operation: 'update' }, { projection: { row_data: 1, changed_at: 1 } })
      .sort({ changed_at: -1 }).limit(20).toArray();
    // The newest snapshot taken at (or just before) the developer's latest edit.
    const cutoff = new Date(new Date(sent).getTime() + 5000).toISOString();
    const prev = hist.find((h) => String(h.changed_at) <= cutoff);
    if (prev?.row_data) {
      const before = prev.row_data as PinDoc;
      previousAt = String(prev.changed_at || '');
      changes = [];
      for (const [k, label] of DETAIL_FIELDS) {
        if (str(before[k]) !== str(p[k])) changes.push({ label, before: str(before[k]), after: str(p[k]) });
      }
      for (const [k, label] of IMAGE_FIELDS) {
        if (str(before[k]) !== str(p[k])) changes.push({ label, before: before[k] ? 'Previous image' : '', after: p[k] ? 'New image (see below)' : '' });
      }
      const cb = JSON.stringify(customList(before.custom_fields)), ca = JSON.stringify(customList(p.custom_fields));
      if (cb !== ca) changes.push({ label: 'Custom fields', before: customList(before.custom_fields).map((c) => `${c.label}: ${c.value}`).join('; '), after: customList(p.custom_fields).map((c) => `${c.label}: ${c.value}`).join('; ') });
    }
  }
  return {
    id, number: p.number ?? null, edited, previousAt, changes,
    fields, images, custom: customList(p.custom_fields),
    lat: typeof p.lat === 'number' ? p.lat : p.lat != null ? Number(p.lat) : null,
    lng: typeof p.lng === 'number' ? p.lng : p.lng != null ? Number(p.lng) : null,
  };
}

export async function GET(req: NextRequest) {
  if (!(await hasPermission('intake'))) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  const one = req.nextUrl.searchParams.get('id');
  if (one) {
    const d = await detail(one);
    if (!d) return NextResponse.json({ error: { message: 'Project not found' } }, { status: 404 });
    return NextResponse.json({ data: d }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  const db = await getDb();
  const rows = (await db
    .collection<PinDoc>('pins')
    .find(
      { owner_user_id: { $exists: true } },
      {
        projection: {
          id: 1, number: 1, title: 1, location: 1, status: 1, type: 1, price: 1, configuration: 1, sqft: 1,
          possession_timeline: 1, developer: 1, description: 1, lat: 1, lng: 1, image: 1, owner_user_id: 1,
          pending_review: 1, rejected: 1, hidden: 1, created_at: 1, updated_at: 1, submitted_at: 1, reviewed_at: 1, reviewed_by: 1, review_note: 1, admin_edited_at: 1, admin_edited_by: 1,
        },
      },
    )
    .sort({ created_at: -1 })
    .toArray()) as PinDoc[];

  // Who added each project.
  const ownerIds = [...new Set(rows.map((r) => r.owner_user_id).filter(Boolean))];
  const owners = ownerIds.length
    ? await db.collection('users').find({ id: { $in: ownerIds } }, { projection: { id: 1, name: 1, email: 1, mobile: 1, profile: 1 } }).toArray()
    : [];
  const byId = new Map(owners.map((o) => [String(o.id), o]));

  const data = rows.map((p) => {
    const o = byId.get(String(p.owner_user_id));
    const img = typeof p.image === 'string' ? p.image : '';
    return {
      id: String(p.id), number: p.number ?? null, title: String(p.title || ''), location: String(p.location || ''),
      status: String(p.status || ''), type: String(p.type || ''), price: String(p.price || ''),
      configuration: [p.configuration, p.sqft].filter(Boolean).join(' · '), possession: String(p.possession_timeline || ''),
      developer: String(p.developer || ''), description: String(p.description || ''),
      image: img ? (img.startsWith('data:') ? mediaUrl('pins', String(p.id), 'image', img) : img) : '',
      hasLocation: p.lat != null && p.lng != null,
      state: stateOf(p),
      edited: !!(p.pending_review && p.created_at && String(p.submitted_at || p.updated_at || '') > String(p.created_at)),
      admin_edited_at: String(p.admin_edited_at || ''), admin_edited_by: String(p.admin_edited_by || ''),
      owner: o
        ? { id: String(o.id), name: String(o.name || ''), email: String(o.email || ''), mobile: String(o.mobile || ''), company: String((o.profile as Record<string, string> | undefined)?.company || '') }
        : { id: String(p.owner_user_id || ''), name: '', email: '', mobile: '', company: '' },
      created_at: String(p.created_at || ''), updated_at: String(p.updated_at || ''),
      reviewed_at: String(p.reviewed_at || ''), reviewed_by: String(p.reviewed_by || ''), review_note: String(p.review_note || ''),
    };
  });
  return NextResponse.json({ data }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: { message: 'Only the super admin can approve or reject projects.' } }, { status: 403 });
  }
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { message: 'Invalid request' } }, { status: 400 });
  const { id, action, reason } = parsed.data;
  if (action === 'reject' && !reason) {
    return NextResponse.json({ error: { message: 'Please write a reason — the developer will see it.' } }, { status: 400 });
  }

  const db = await getDb();
  const pin = await db.collection<PinDoc>('pins').findOne({ id, owner_user_id: { $exists: true } }, { projection: { id: 1, title: 1, owner_user_id: 1 } });
  if (!pin) return NextResponse.json({ error: { message: 'Project not found' } }, { status: 404 });

  const now = new Date().toISOString();
  const review = { reviewed_at: now, reviewed_by: me.email };
  // runDbOp keeps the public-map cache in sync and records pin history.
  const values = action === 'approve'
    ? { pending_review: false, rejected: false, hidden: false, review_note: '', ...review }
    : { pending_review: false, rejected: true, hidden: true, review_note: reason, ...review };
  const res = await runDbOp({ table: 'pins', action: 'update', filters: [{ op: 'eq', col: 'id', val: id }], values }, true);
  if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });

  const owner = await db.collection('users').findOne({ id: String(pin.owner_user_id) }, { projection: { id: 1, email: 1, name: 1, role: 1 } });
  if (owner) {
    await logActivity({
      user_id: String(owner.id), email: String(owner.email), name: owner.name ? String(owner.name) : undefined, role: String(owner.role || 'developer'),
      type: action === 'approve' ? 'project_approved' : 'project_rejected', actor: me.email,
      detail: action === 'approve'
        ? `“${String(pin.title || 'Project')}” approved — now live on the map`
        : `“${String(pin.title || 'Project')}” not approved: ${reason}`,
    });
  }
  return NextResponse.json({ data: { id, action } }, { headers: { 'Cache-Control': 'private, no-store' } });
}

// ---- Super admin corrects a developer's project ------------------------------
const textField = (max: number) => z.string().trim().max(max).optional();
const editSchema = z.object({
  id: z.string().min(1),
  values: z.object({
    title: z.string().trim().min(2).max(160).optional(),
    developer: textField(160), type: textField(60), status: textField(40), location: textField(200),
    price: textField(120), configuration: textField(160), sqft: textField(120), size: textField(120),
    possession_timeline: textField(120), launch_date: textField(120), whats_available: textField(400),
    rera_number: textField(80), key_usp: textField(400), description: textField(6000),
    youtube_video_url: textField(400),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    // New image as a data: URL (or an https URL); '' removes it; leave out to keep.
    image: z.string().max(4_000_000).optional(),
    brochure_image: z.string().max(4_000_000).optional(),
    custom_fields: z.array(z.object({
      id: z.string().max(80).optional(), label: z.string().trim().max(120), value: z.string().trim().max(1000), visible: z.boolean().optional(),
    })).max(40).optional(),
  }).strict(),
});

export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me || me.role !== 'admin') {
    return NextResponse.json({ error: { message: 'Only the super admin can edit developer projects.' } }, { status: 403 });
  }
  const parsed = editSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { message: 'Some details are invalid — please check and try again.' } }, { status: 400 });
  const { id, values } = parsed.data;
  if (values.image && !/^(data:image\/|https?:\/\/)/.test(values.image)) return NextResponse.json({ error: { message: 'Logo must be an image.' } }, { status: 400 });
  if (values.brochure_image && !/^(data:image\/|https?:\/\/)/.test(values.brochure_image)) return NextResponse.json({ error: { message: 'Brochure must be an image.' } }, { status: 400 });

  const db = await getDb();
  const pin = await db.collection<PinDoc>('pins').findOne({ id, owner_user_id: { $exists: true } }, { projection: { id: 1, title: 1, owner_user_id: 1 } });
  if (!pin) return NextResponse.json({ error: { message: 'Project not found' } }, { status: 404 });

  const patch: Record<string, unknown> = { ...values, admin_edited_at: new Date().toISOString(), admin_edited_by: me.email };
  if (patch.custom_fields) {
    patch.custom_fields = (patch.custom_fields as { id?: string; label: string; value: string; visible?: boolean }[])
      .filter((c) => c.label || c.value)
      .map((c, i) => ({ id: c.id || `cf-${Date.now()}-${i}`, label: c.label, value: c.value, visible: c.visible !== false }));
  }
  // runDbOp: saves the previous version to history and refreshes the public map cache.
  const res = await runDbOp({ table: 'pins', action: 'update', filters: [{ op: 'eq', col: 'id', val: id }], values: patch }, true);
  if (res.error) return NextResponse.json({ error: res.error }, { status: res.status });

  const owner = await db.collection('users').findOne({ id: String(pin.owner_user_id) }, { projection: { id: 1, email: 1, name: 1, role: 1 } });
  if (owner) {
    const changed = Object.keys(values).length;
    await logActivity({
      user_id: String(owner.id), email: String(owner.email), name: owner.name ? String(owner.name) : undefined, role: String(owner.role || 'developer'),
      type: 'project_admin_edit', actor: me.email,
      detail: `Mappingg corrected ${changed} detail${changed === 1 ? '' : 's'} of “${String(values.title || pin.title || 'Project')}”`,
    });
  }
  return NextResponse.json({ data: { id } }, { headers: { 'Cache-Control': 'private, no-store' } });
}

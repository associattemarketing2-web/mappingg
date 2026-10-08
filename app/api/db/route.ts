import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, getStaffUser } from '@/lib/auth';
import { runDbOp, type DbOp } from '@/lib/db-engine';
import { withMediaUrls } from '@/lib/pin-media';
import { logActivity } from '@/lib/activity';
import { canEditProjects } from '@/lib/verification';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { warmPinThumbs } from '@/lib/media-cache';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const filterSchema = z.union([
  z.object({ op: z.literal('eq'), col: z.string(), val: z.unknown() }),
  z.object({ op: z.literal('in'), col: z.string(), vals: z.array(z.unknown()) }),
]);

const opSchema = z.object({
  table: z.string().regex(/^[a-z_]+$/), // whitelist-safe identifier, blocks injection
  action: z.enum(['select', 'insert', 'update', 'delete', 'upsert']),
  columns: z.string().optional(),
  filters: z.array(filterSchema).optional(),
  order: z.object({ col: z.string(), ascending: z.boolean() }).optional(),
  limit: z.number().int().min(0).max(10000).optional(),
  single: z.boolean().optional(),
  values: z.union([z.record(z.unknown()), z.array(z.record(z.unknown()))]).optional(),
  returning: z.boolean().optional(),
});

const PUBLIC_TABLES = new Set([
  'pins',
  'infra_markers',
  'roads',
  'map_settings',
  'infra_types',
  'area_boundaries',
]);

function withoutHistoryImages(data: unknown): unknown {
  const strip = (h: unknown) => {
    if (!h || typeof h !== 'object') return h;
    const entry = h as Record<string, unknown>;
    const row = entry.row_data as Record<string, unknown> | undefined;
    if (!row || typeof row !== 'object') return h;
    const { image, brochure_image, ...rest } = row;
    return { ...entry, row_data: { ...rest, has_image: !!image, has_brochure: !!brochure_image } };
  };
  return Array.isArray(data) ? data.map(strip) : strip(data);
}

function invalid(details?: unknown) {
  return NextResponse.json({ data: null, error: { message: 'Invalid request', details } }, { status: 400 });
}

async function handle(op: DbOp, devEditorView = false, ip = '') {
  const staff = await getStaffUser();
  const current = staff ? null : await getCurrentUser();
  // The one write open to anonymous visitors is a map enquiry (leads insert) —
  // cap it per IP so it can't be used to flood the CRM.
  if (!staff && op.table === 'leads' && op.action === 'insert') {
    const limited = rateLimit(`lead:${ip}`, 20, 10 * 60_000);
    if (limited) return limited;
  }
  // A signed-in developer is scoped to their own pins everywhere: they see only
  // their projects on the live map and in the map editor, and any pin they
  // create/edit/delete is owner-stamped and held for super-admin review. Buyers,
  // agents and anonymous visitors are unaffected.
  // Developers with editing access are limited to their own pins in their
  // dashboard's Map Editor (it sends X-Mg-Scope: dev-editor) and for every
  // write. On the public live map they read every live pin, like any visitor.
  // View-only developers (access: 'viewer') are always treated as a visitor.
  const isEditorDev = current?.role === 'developer' && (await canEditProjects(current.id));
  const developerId = isEditorDev && (devEditorView || op.action !== 'select') ? current!.id : undefined;
  const scopedPins = !!developerId && op.table === 'pins';

  const result = await runDbOp(op, !!staff, { developerId });

  // A developer adding / editing / removing a pin on their dashboard map is
  // recorded for the super admin (Developer projects tab + notification bell).
  if (scopedPins && current && !result.error && op.action !== 'select') {
    const vals = Array.isArray(op.values) ? op.values : op.values ? [op.values] : [];
    let title = vals.length === 1 && vals[0].title ? `“${String(vals[0].title)}”` : vals.length > 1 ? `${vals.length} projects` : 'a project';
    if (op.action === 'delete') {
      // A developer's delete is only a request (see db-engine) — name the project in the log.
      const idf = op.filters?.find((f) => f.col === 'id' && f.op === 'eq');
      const pin = idf && 'val' in idf ? await (await getDb()).collection('pins').findOne({ id: String(idf.val) }, { projection: { title: 1 } }) : null;
      if (pin?.title) title = `“${String(pin.title)}”`;
    }
    const type = op.action === 'delete' ? 'project_delete_requested' : op.action === 'insert' ? 'project_added' : 'project_edited';
    const verb = type === 'project_delete_requested' ? 'Asked to delete' : type === 'project_added' ? 'Added' : 'Edited';
    await logActivity({
      user_id: current.id, email: current.email, role: current.role, type,
      detail: `${verb} ${title}${type === 'project_delete_requested' ? ' — waiting for super admin approval' : ' on the map — waiting for approval'}`,
    });
  }
  // A map is loading its pins: pre-encode the marker thumbnails it is about to
  // request, in a few batched queries (no-op if done in the last few minutes).
  if (op.table === 'pins' && op.action === 'select' && !result.error && !scopedPins) warmPinThumbs();

  // Stored images (pin logos, brochures, infra icons) go out as cacheable URLs, not inline base64.
  let data = result.data ? withMediaUrls(op.table, result.data) : result.data;
  // History lists only show each entry's number/name; the stored copy keeps its
  // images in the database (and backups), and restores happen server-side.
  if (op.table === 'pins_history' && op.action === 'select' && data) data = withoutHistoryImages(data);
  const res = NextResponse.json({ data, error: result.error }, { status: result.status });

  // Cache only shared, non-personalised reads of public tables. A developer's
  // owner-scoped pins are personal, so they are never publicly cached.
  if (op.action === 'select' && PUBLIC_TABLES.has(op.table) && !staff && !scopedPins) {
    res.headers.set('Cache-Control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=300');
  } else {
    res.headers.set('Cache-Control', 'private, no-store');
  }
  return res;
}

// Reads — cacheable by the browser/CDN. The op is passed as a JSON query param.
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('op');
  if (!raw) return invalid('missing op');
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return invalid('bad op json');
  }
  const parsed = opSchema.safeParse(parsedJson);
  if (!parsed.success) return invalid(parsed.error.flatten());
  if (parsed.data.action !== 'select') return invalid('GET only supports select');
  const devEditor = req.headers.get('x-mg-scope') === 'dev-editor' || req.nextUrl.searchParams.get('scope') === 'dev-editor';
  return handle(parsed.data as DbOp, devEditor);
}

// Writes (and any non-select op).
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: { message: 'Invalid JSON' } }, { status: 400 });
  }
  const parsed = opSchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error.flatten());
  return handle(parsed.data as DbOp, req.headers.get('x-mg-scope') === 'dev-editor', clientIp(req));
}

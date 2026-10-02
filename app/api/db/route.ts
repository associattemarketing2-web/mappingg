import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getStaffUser } from '@/lib/auth';
import { runDbOp, type DbOp } from '@/lib/db-engine';
import { withMediaUrls } from '@/lib/pin-media';

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

async function handle(op: DbOp) {
  const user = await getStaffUser();
  const result = await runDbOp(op, !!user);
  // Stored images (pin logos, brochures, infra icons) go out as cacheable URLs, not inline base64.
  let data = result.data ? withMediaUrls(op.table, result.data) : result.data;
  // History lists only show each entry's number/name; the stored copy keeps its
  // images in the database (and backups), and restores happen server-side.
  if (op.table === 'pins_history' && op.action === 'select' && data) data = withoutHistoryImages(data);
  const res = NextResponse.json({ data, error: result.error }, { status: result.status });

  // Cache only anonymous reads of public tables. Everything else stays private.
  if (op.action === 'select' && PUBLIC_TABLES.has(op.table) && !user) {
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
  return handle(parsed.data as DbOp);
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
  return handle(parsed.data as DbOp);
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getStaffUser } from '@/lib/auth';
import { runPartnersDb, type DbOp } from '@/lib/partners-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Generic query gateway for the partners admin panel. Every table here is
// admin-only (the public builder submit page uses RPCs, never .from()), so the
// whole endpoint requires a valid session.
const filterSchema = z.union([
  z.object({ op: z.literal('eq'), col: z.string(), val: z.unknown() }),
  z.object({ op: z.literal('in'), col: z.string(), vals: z.array(z.unknown()) }),
]);

const opSchema = z.object({
  table: z.string().regex(/^[a-z_]+$/),
  action: z.enum(['select', 'insert', 'update', 'delete', 'upsert']),
  columns: z.string().optional(),
  filters: z.array(filterSchema).optional(),
  order: z.object({ col: z.string(), ascending: z.boolean() }).optional(),
  limit: z.number().int().min(0).max(10000).optional(),
  single: z.boolean().optional(),
  values: z.union([z.record(z.unknown()), z.array(z.record(z.unknown()))]).optional(),
  returning: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const user = await getStaffUser();
  if (!user) {
    return NextResponse.json({ data: null, error: { message: 'Not authorized' } }, { status: 401 });
  }
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ data: null, error: { message: 'Invalid JSON' } }, { status: 400 });
  }
  const parsed = opSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: { message: 'Invalid request', details: parsed.error.flatten() } }, { status: 400 });
  }
  const result = await runPartnersDb(parsed.data as DbOp);
  return NextResponse.json({ data: result.data, error: result.error }, {
    status: result.status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

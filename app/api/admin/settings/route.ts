import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/mongodb';
import { hasPermission } from '@/lib/staff';
import { invalidateTable } from '@/lib/db-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Site-wide settings live in the single `map_settings` row (id === 1), the same
// row the map app reads. Exposed here so the admin can edit SEO/analytics values.
const schema = z.object({
  // Rendered into inline <script>s in the root layout, so only real IDs are
  // accepted (empty = use the site's default ID from lib/site-settings.ts).
  gtm_container_id: z.string().trim().regex(/^(GTM-[A-Z0-9]{1,20})?$/i, 'Use a GTM container ID like GTM-ABC1234').optional(),
  search_console_verification: z.string().trim().max(200).regex(/^[A-Za-z0-9_\-]*$/).optional(),
  ga_measurement_id: z.string().trim().regex(/^(G-[A-Z0-9]{4,20})?$/i, 'Use a GA4 measurement ID like G-ABC1234').optional(),
  youtube_video_url: z.string().max(400).optional(),
});

export async function GET() {
  if (!(await hasPermission('settings'))) {
    return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  }
  const db = await getDb();
  const row = await db.collection('map_settings').findOne({ id: 1 });
  const { _id, ...rest } = (row || { id: 1 }) as Record<string, unknown>;
  return NextResponse.json({ data: rest });
}

export async function POST(req: NextRequest) {
  if (!(await hasPermission('settings'))) {
    return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { message: 'Invalid settings' } }, { status: 400 });
  }
  const db = await getDb();
  await db.collection('map_settings').updateOne(
    { id: 1 },
    { $set: { ...parsed.data, updated_at: new Date().toISOString() }, $setOnInsert: { id: 1, _id: '1' } },
    { upsert: true },
  );
  invalidateTable('map_settings');
  const row = await db.collection('map_settings').findOne({ id: 1 });
  const { _id, ...rest } = (row || { id: 1 }) as Record<string, unknown>;
  return NextResponse.json({ data: rest });
}

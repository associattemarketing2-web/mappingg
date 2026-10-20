import { NextRequest, NextResponse } from 'next/server';
import { getStaffUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { createdOnDay, dayKeyIST } from '@/lib/insights';
import { localitiesOf } from '@/lib/locality';
import { projectSlug } from '@/lib/seo/slug';
import { isPropertyProject } from '@/lib/seo/project-filter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/admin/pins-by-day?date=YYYY-MM-DD — the projects (pins) created on one
// India-time day, for the "Projects created day by day" heatmap on the super-admin
// dashboard. Same pins and same day rule as /api/admin/stats (all pins, hidden
// ones included), so the list always matches the square's count. Read-only.
export async function GET(req: NextRequest) {
  const staff = await getStaffUser();
  if (!staff) return NextResponse.json({ data: null, error: { message: 'Not authorized' } }, { status: 401 });

  const date = req.nextUrl.searchParams.get('date') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00Z'))) {
    return NextResponse.json({ data: null, error: { message: 'date must be YYYY-MM-DD' } }, { status: 400 });
  }
  if (date > dayKeyIST(new Date())) {
    return NextResponse.json({ data: { date, projects: [] }, error: null }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  const db = await getDb();
  const rows = await db.collection('pins').find({}, {
    projection: {
      id: 1, number: 1, title: 1, developer: 1, location: 1, status: 1, type: 1, price: 1, configuration: 1,
      rera_number: 1, created_at: 1, hidden: 1, pending_review: 1, rejected: 1, source: 1, intake_project_id: 1, owner_user_id: 1,
    },
  }).toArray() as Record<string, any>[];

  const projects = createdOnDay(rows, date).map((p) => {
    const project = isPropertyProject(p);
    const locality = localitiesOf(p.location)[0] || '';
    return {
      id: String(p.id),
      number: p.number ?? null,
      title: String(p.title || ''),
      developer: String(p.developer || ''),
      location: String(p.location || ''),
      status: String(p.status || ''),
      type: String(p.type || ''),
      price: String(p.price || ''),
      configuration: String(p.configuration || ''),
      rera: String(p.rera_number || ''),
      created_at: String(p.created_at || ''),
      hidden: p.hidden === true,
      pending: p.pending_review === true,
      rejected: p.rejected === true,
      // Where it came from: Projects Intake, a developer's dashboard, or added by hand on the map.
      origin: p.intake_project_id || p.source === 'intake' ? 'intake' : p.owner_user_id ? 'developer' : 'map',
      // Public project page — only for live property projects (not office/land markers, not hidden).
      page: project && p.number != null && p.hidden !== true && p.pending_review !== true && p.rejected !== true
        ? `/projects/${projectSlug(p.title, locality, Number(p.number))}` : null,
    };
  });
  return NextResponse.json({ data: { date, projects }, error: null }, { headers: { 'Cache-Control': 'private, no-store' } });
}

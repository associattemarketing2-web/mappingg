import { NextResponse } from 'next/server';
import { getStaffUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { countPosts } from '@/lib/blog';
import { getPublicSettings } from '@/lib/site-settings';
import { lastWeeks, perDay, perWeek } from '@/lib/insights';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await getStaffUser())) {
    return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  }

  let pins = 0, leads = 0, infra = 0, roads = 0, employees = 0, dbOk = true;
  let buyers = 0, developers = 0, agents = 0, pending = 0, contactLeads = 0;
  // Chart data for the Dashboard (public projects only; no images loaded).
  let byStatus: { key: string; count: number }[] = [];
  let byType: { key: string; count: number }[] = [];
  let newProjects: { week: string; count: number }[] = [];
  let enquiries: { week: string; count: number }[] = [];
  let addedThisMonth = 0, hiddenPins = 0;
  let daily: ReturnType<typeof perDay> = { today: '', days: [] };
  const postsP = countPosts();
  const settingsP = getPublicSettings();
  try {
    const db = await getDb();
    // One parallel wave instead of ~6 sequential round-trips. The row lists the
    // charts need anyway also give the totals, so no separate COUNT queries.
    const [rows, users, mapLeadDates, contactLeadDates, infraN, roadsN] = await Promise.all([
      db.collection('pins').find({}, { projection: { status: 1, type: 1, created_at: 1, hidden: 1 } }).toArray(),
      db.collection('users').find({}, { projection: { role: 1, verification: 1, verified: 1 } }).toArray(),
      db.collection('leads').find({}, { projection: { created_at: 1 } }).toArray(),
      db.collection('contact_leads').find({}, { projection: { created_at: 1 } }).toArray(),
      db.collection('infra_markers').countDocuments({}),
      db.collection('roads').countDocuments({}),
    ]);
    pins = rows.length;
    leads = mapLeadDates.length;
    contactLeads = contactLeadDates.length;
    infra = infraN;
    roads = roadsN;
    const byRole = (role: string) => users.filter((u) => u.role === role).length;
    employees = byRole('employee');
    buyers = byRole('buyer');
    developers = byRole('developer');
    agents = byRole('agent');
    // Same rule as PENDING_FILTER (lib/verification.ts), applied in memory.
    pending = users.filter((u) =>
      (u.role === 'developer' || u.role === 'agent') &&
      (u.verification === 'pending' || (u.verification === undefined && u.verified === false)),
    ).length;

    const pub = rows.filter((r) => r.hidden !== true);
    hiddenPins = rows.length - pub.length;
    // Donut slice order keeps green (available) and red (sold) apart for colour-blind readers.
    byStatus = ['available', 'construction', 'sold', 'upcoming'].map((key) => ({ key, count: pub.filter((r) => (r.status || 'available') === key).length }));
    const types = new Map<string, number>();
    for (const r of pub) { const t = String(r.type || 'Other').trim() || 'Other'; types.set(t, (types.get(t) || 0) + 1); }
    byType = [...types.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));
    const weeks = lastWeeks(12);
    newProjects = perWeek(rows.map((r) => r.created_at), weeks);
    // Day by day (IST) for the calendar heatmap: was anything created that day?
    daily = perDay(rows.map((r) => r.created_at), 26);
    enquiries = perWeek([...mapLeadDates, ...contactLeadDates].map((l) => l.created_at), weeks);
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    addedThisMonth = rows.filter((r) => new Date(String(r.created_at || '')) >= monthStart).length;
  } catch {
    dbOk = false;
  }
  const [posts, settings] = await Promise.all([postsP, settingsP]);

  return NextResponse.json({
    data: {
      dbOk,
      pins, leads, infra, roads, employees,
      enquiriesTotal: leads + contactLeads,
      charts: { byStatus, byType, newProjects, enquiries, addedThisMonth, hiddenPins, daily },
      accounts: { buyers, developers, agents, pending },
      posts,
      seo: {
        gsc: !!settings.search_console_verification,
        gtm: !!settings.gtm_container_id,
      },
    },
  });
}

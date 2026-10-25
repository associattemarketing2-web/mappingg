import { NextResponse } from 'next/server';
import { getStaffUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { countPosts } from '@/lib/blog';
import { getPublicSettings } from '@/lib/site-settings';
import { dayKeyIST, lastWeeks, perDay, perWeek } from '@/lib/insights';
import { cityFrom, CITY_LABELS, type CityKey } from '@/lib/seo/city';
import { placesOf } from '@/lib/seo/entities';

type Activity = { kind: string; title: string; detail: string; at: string };
/** % growth of a running total this month: added this month vs the total at its start. */
function growth(dates: unknown[], start: Date): number | null {
  const added = dates.filter((d) => new Date(String(d || '')) >= start).length;
  const before = dates.length - added;
  return before ? Math.round((added / before) * 100) : null;
}
const newest = <T extends { created_at?: unknown }>(rows: T[], n: number) =>
  [...rows].filter((r) => r.created_at).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, n);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const staff = await getStaffUser();
  if (!staff) {
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
  // Overview extras: per-city type/locality split, a 30-day enquiry trend,
  // month-on-month growth of each total and a short recent-activity feed.
  type CityStat = { key: string; label: string; count: number; center: [number, number] | null; byType: { key: string; count: number }[]; byLocality: { key: string; count: number }[] };
  let cities: CityStat[] = [];
  let leadsDaily: { date: string; count: number }[] = [];
  let growthPct: Record<string, number | null> = {};
  let directory = 0;
  let recent: Activity[] = [];
  const postsP = countPosts();
  const settingsP = getPublicSettings();
  // Site-wide numbers are for the super admin only; employees just get their own lead counts.
  if (staff.role !== 'admin') {
    const db = await getDb();
    const mine = { assigned_to: staff.id };
    const [leads, contactLeads] = await Promise.all([db.collection('leads').countDocuments(mine), db.collection('contact_leads').countDocuments(mine)]);
    return NextResponse.json({ data: { dbOk: true, leads, enquiriesTotal: leads + contactLeads } });
  }
  const leadScope = {};
  try {
    const db = await getDb();
    // One parallel wave instead of ~6 sequential round-trips. The row lists the
    // charts need anyway also give the totals, so no separate COUNT queries.
    const [rows, users, mapLeadDates, contactLeadDates, infraN, roadsN, devRows, postRows] = await Promise.all([
      db.collection('pins').find({}, { projection: { status: 1, type: 1, created_at: 1, hidden: 1, title: 1, location: 1, lat: 1, lng: 1 } }).toArray(),
      db.collection('users').find({}, { projection: { role: 1, verification: 1, verified: 1, name: 1, email: 1, created_at: 1 } }).toArray(),
      // Employees only count the leads transferred to them.
      db.collection('leads').find(leadScope, { projection: { created_at: 1, name: 1, project: 1 } }).toArray(),
      db.collection('contact_leads').find(leadScope, { projection: { created_at: 1, name: 1, subject: 1 } }).toArray(),
      db.collection('infra_markers').countDocuments({}),
      db.collection('roads').countDocuments({}),
      db.collection('developers').find({}, { projection: { name: 1, created_at: 1, updated_at: 1 } }).toArray(),
      db.collection('posts').find({}, { projection: { title: 1, status: 1, created_at: 1, published_at: 1 } }).toArray(),
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

    // Per city: projects by type and by locality, plus a map centre (median pin).
    const byCity = new Map<CityKey, typeof pub>();
    for (const r of pub) {
      const c = cityFrom(r.location, r.lat, r.lng);
      byCity.set(c, [...(byCity.get(c) || []), r]);
    }
    const tally = (keys: string[]) => {
      const m = new Map<string, number>();
      for (const k of keys) m.set(k, (m.get(k) || 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));
    };
    const median = (xs: number[]) => { const a = xs.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : NaN; };
    cities = [...byCity.entries()].sort((a, b) => b[1].length - a[1].length).map(([key, list]) => {
      const lat = median(list.map((r) => Number(r.lat))), lng = median(list.map((r) => Number(r.lng)));
      return {
        key, label: CITY_LABELS[key], count: list.length,
        center: Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] as [number, number] : null,
        byType: tally(list.map((r) => String(r.type || 'Other').trim() || 'Other')),
        byLocality: tally(list.map((r) => placesOf(String(r.location || ''))[0]).filter(Boolean)).slice(0, 8),
      };
    });

    // Enquiries per day (India time), last 30 days.
    const allLeads = [...mapLeadDates, ...contactLeadDates];
    const perDayLeads = new Map<string, number>();
    for (const l of allLeads) {
      const d = new Date(String(l.created_at || ''));
      if (Number.isNaN(d.getTime())) continue;
      const k = dayKeyIST(d);
      perDayLeads.set(k, (perDayLeads.get(k) || 0) + 1);
    }
    const todayIst = new Date(dayKeyIST(new Date()) + 'T00:00:00Z');
    leadsDaily = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(todayIst); d.setUTCDate(d.getUTCDate() - 29 + i);
      const date = d.toISOString().slice(0, 10);
      return { date, count: perDayLeads.get(date) || 0 };
    });

    directory = devRows.length;
    const livePosts = postRows.filter((p) => p.status === 'published').map((p) => ({ ...p, created_at: p.published_at || p.created_at }) as typeof p);
    growthPct = {
      pins: growth(rows.map((r) => r.created_at), monthStart),
      developers: growth(devRows.map((r) => r.created_at), monthStart),
      enquiries: growth(allLeads.map((r) => r.created_at), monthStart),
      posts: growth(livePosts.map((p) => p.created_at), monthStart),
    };

    recent = [
      ...newest(rows, 4).map((r) => ({ kind: 'project', title: 'New project added', detail: [r.title, r.location].filter(Boolean).join(', ') || 'Untitled project', at: String(r.created_at) })),
      ...newest(livePosts, 3).map((p) => ({ kind: 'blog', title: 'Blog post published', detail: String(p.title || 'Untitled post'), at: String(p.created_at) })),
      ...newest(devRows.map((d) => ({ ...d, created_at: d.updated_at || d.created_at, added_at: d.created_at }) as typeof d), 3)
        .map((d) => ({ kind: 'developer', title: d.updated_at && d.updated_at !== d.added_at ? 'Developer updated' : 'Developer added', detail: String(d.name || 'Developer'), at: String(d.created_at) })),
      ...newest(allLeads, 4).map((l) => ({ kind: 'enquiry', title: 'New enquiry received', detail: [l.name, l.project?.title || l.subject].filter(Boolean).join(' — ') || 'Website enquiry', at: String(l.created_at) })),
      ...newest(users.filter((u) => u.role === 'employee'), 2).map((u) => ({ kind: 'employee', title: 'Employee added', detail: String(u.name || u.email || 'Team member'), at: String(u.created_at) })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
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
      overview: { cities, leadsDaily, growth: growthPct, directory, recent },
      accounts: { buyers, developers, agents, pending },
      posts,
      defaultCity: settings.admin_default_city ?? null,
      seo: {
        gsc: !!settings.search_console_verification,
        gtm: !!settings.gtm_container_id,
        ga: !!settings.ga_measurement_id,
      },
    },
  });
}

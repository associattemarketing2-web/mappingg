import { createHash, randomUUID } from 'node:crypto';
import { query } from './pg';
import { getMongoDb, usingMongo } from './mongodb';

// First-party website analytics for the super-admin dashboard: page views,
// clicks, active visitors, top pages, traffic sources and devices.
//
// Cookieless and anonymous: a visitor is a hash of (secret salt + India date +
// IP + browser), so the same person counts once per day, can't be followed
// across days, and no personal data is stored. Bots and signed-in staff are
// never recorded. Events older than RETENTION_DAYS are pruned automatically.

export type EventKind = 'pv' | 'click' | 'hb';
export interface SiteEvent {
  at: string; kind: EventKind; path: string; vid: string;
  label?: string; href?: string; source?: string; device?: string;
}

const RETENTION_DAYS = 180;
const ACTIVE_MINUTES = 5;
const IST_OFFSET_MS = 330 * 60_000;
const istDate = (d = new Date()) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

let ready: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (usingMongo()) {
    ready ??= getMongoDb().then(async (db) => {
      await db.collection('site_events').createIndex({ at: -1 });
    }).catch((e) => { ready = null; throw e; });
    return ready;
  }
  ready ??= query(`
    CREATE TABLE IF NOT EXISTS site_events (
      id bigserial PRIMARY KEY,
      at timestamptz NOT NULL DEFAULT now(),
      kind text NOT NULL,
      path text NOT NULL,
      vid text NOT NULL,
      label text, href text, source text, device text
    );
    CREATE INDEX IF NOT EXISTS site_events_at ON site_events (at DESC);
    CREATE INDEX IF NOT EXISTS site_events_kind_at ON site_events (kind, at DESC);
  `).then(() => undefined).catch((e) => { ready = null; throw e; });
  return ready;
}

/** Anonymous per-day visitor id. */
export function visitorId(ip: string, ua: string): string {
  return createHash('sha256').update(`${process.env.AUTH_SECRET || 'mg'}|${istDate()}|${ip}|${ua}`).digest('hex').slice(0, 20);
}

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp|telegram|curl|wget|python|axios|node-fetch|go-http|postman|monitor|uptime/i;
export const isBot = (ua: string) => !ua || BOT.test(ua);

export function deviceOf(ua: string, width?: number): string {
  if (/ipad|tablet/i.test(ua) || (width && width >= 600 && width < 1024 && /mobile|android/i.test(ua))) return 'Tablet';
  if (/mobi|android|iphone/i.test(ua) || (width && width < 600)) return 'Mobile';
  return 'Desktop';
}

/** Group a referrer / utm_source into a readable channel. */
export function sourceOf(referrer: string, utm: string, ownHost: string): string {
  // Campaign tags use the same names as referrers, so "utm_source=google" and a Google visit group together.
  const u = (utm || '').toLowerCase().trim();
  const NAMED: Record<string, string> = { google: 'Google', whatsapp: 'WhatsApp', facebook: 'Facebook', fb: 'Facebook', instagram: 'Instagram', ig: 'Instagram', linkedin: 'LinkedIn', youtube: 'YouTube', twitter: 'X / Twitter', x: 'X / Twitter' };
  if (u) return NAMED[u] || u.slice(0, 40);
  if (!referrer) return 'Direct';
  let host = '';
  try { host = new URL(referrer).hostname.replace(/^www\./, '').toLowerCase(); } catch { return 'Direct'; }
  if (!host || host === ownHost.replace(/^www\./, '')) return '';
  if (/google\./.test(host)) return 'Google';
  if (/bing\.com|duckduckgo|yahoo\./.test(host)) return 'Other search';
  if (/whatsapp|wa\.me|l\.wl\.co/.test(host)) return 'WhatsApp';
  if (/facebook|fb\.com|fb\.me/.test(host)) return 'Facebook';
  if (/instagram/.test(host)) return 'Instagram';
  if (/linkedin|lnkd\.in/.test(host)) return 'LinkedIn';
  if (/t\.co|twitter|x\.com/.test(host)) return 'X / Twitter';
  if (/youtube|youtu\.be/.test(host)) return 'YouTube';
  return host.slice(0, 60);
}

let lastPrune = 0;
export async function recordEvents(events: SiteEvent[]): Promise<void> {
  if (!events.length) return;
  await ensureTable();
  if (usingMongo()) {
    await (await getMongoDb()).collection('site_events').insertMany(events.map((e) => ({ _id: randomUUID() as never, ...e, at: new Date(e.at) })));
  } else {
    const vals: unknown[] = [];
    const rows = events.map((e, i) => {
      vals.push(e.at, e.kind, e.path, e.vid, e.label ?? null, e.href ?? null, e.source ?? null, e.device ?? null);
      const b = i * 8;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8})`;
    });
    await query(`INSERT INTO site_events (at, kind, path, vid, label, href, source, device) VALUES ${rows.join(', ')}`, vals);
  }
  // Keep the table small: drop old events about once an hour.
  if (Date.now() - lastPrune > 3_600_000) {
    lastPrune = Date.now();
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
    if (usingMongo()) await (await getMongoDb()).collection('site_events').deleteMany({ at: { $lt: cutoff } }).catch(() => {});
    else await query('DELETE FROM site_events WHERE at < $1', [cutoff]).catch(() => {});
  }
}

// ----------------------------------------------------------------- reporting

export interface TrafficReport {
  days: number;
  activeNow: number;
  activePages: { path: string; visitors: number }[];
  totals: { visitors: number; pageviews: number; clicks: number; prevVisitors: number; prevPageviews: number; prevClicks: number };
  today: { visitors: number; pageviews: number; clicks: number };
  daily: { date: string; visitors: number; pageviews: number; clicks: number }[];
  topPages: { path: string; views: number; visitors: number }[];
  topClicks: { label: string; href: string; clicks: number }[];
  sources: { source: string; visitors: number }[];
  devices: { device: string; visitors: number }[];
  since: string | null;
}

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v) || 0;

export async function trafficReport(days: number): Promise<TrafficReport> {
  await ensureTable();
  const now = Date.now();
  // Range = the last `days` India-time days including today; prev = the same length before it.
  const todayIst = istDate();
  const startIst = new Date(Date.parse(todayIst + 'T00:00:00Z') - (days - 1) * 86_400_000);
  const start = new Date(startIst.getTime() - IST_OFFSET_MS);
  const prevStart = new Date(start.getTime() - days * 86_400_000);
  const activeSince = new Date(now - ACTIVE_MINUTES * 60_000);
  const todayStart = new Date(Date.parse(todayIst + 'T00:00:00Z') - IST_OFFSET_MS);

  let rows: SiteEvent[] | null = null;
  if (usingMongo()) {
    const docs = await (await getMongoDb()).collection('site_events').find({ at: { $gte: prevStart } }).toArray();
    rows = docs.map((d) => ({ ...(d as unknown as SiteEvent), at: new Date(d.at as Date).toISOString() }));
  }

  // Small helper so each figure is one SQL query on Postgres, or JS over `rows` on Mongo.
  const inRange = (e: SiteEvent, a: Date, b?: Date) => { const t = Date.parse(e.at); return t >= a.getTime() && (!b || t < b.getTime()); };

  if (rows) {
    const cur = rows.filter((e) => inRange(e, start));
    const prev = rows.filter((e) => inRange(e, prevStart, start));
    const uniq = (l: SiteEvent[]) => new Set(l.map((e) => e.vid)).size;
    const count = (l: SiteEvent[], k: EventKind) => l.filter((e) => e.kind === k).length;
    const active = rows.filter((e) => inRange(e, activeSince));
    const lastPath = new Map<string, string>();
    active.sort((a, b) => a.at.localeCompare(b.at)).forEach((e) => lastPath.set(e.vid, e.path));
    const group = <K extends string>(l: SiteEvent[], key: (e: SiteEvent) => K | '' | undefined) => {
      const m = new Map<K, Set<string>>();
      l.forEach((e) => { const k = key(e); if (k) { if (!m.has(k)) m.set(k, new Set()); m.get(k)!.add(e.vid); } });
      return [...m.entries()].map(([k, s]) => ({ k, v: s.size })).sort((a, b) => b.v - a.v);
    };
    const daily = new Map<string, SiteEvent[]>();
    cur.forEach((e) => { const d = istDate(new Date(e.at)); if (!daily.has(d)) daily.set(d, []); daily.get(d)!.push(e); });
    const pages = new Map<string, { views: number; v: Set<string> }>();
    cur.filter((e) => e.kind === 'pv').forEach((e) => { const p = pages.get(e.path) || { views: 0, v: new Set() }; p.views++; p.v.add(e.vid); pages.set(e.path, p); });
    const clicks = new Map<string, { label: string; href: string; clicks: number }>();
    cur.filter((e) => e.kind === 'click').forEach((e) => { const k = `${e.label}|${e.href}`; const c = clicks.get(k) || { label: e.label || '', href: e.href || '', clicks: 0 }; c.clicks++; clicks.set(k, c); });
    const todayEv = rows.filter((e) => inRange(e, todayStart));
    return finish({
      activeNow: lastPath.size,
      activePages: [...[...lastPath.values()].reduce((m, p) => m.set(p, (m.get(p) || 0) + 1), new Map<string, number>())].map(([path, visitors]) => ({ path, visitors })).sort((a, b) => b.visitors - a.visitors),
      totals: { visitors: uniq(cur), pageviews: count(cur, 'pv'), clicks: count(cur, 'click'), prevVisitors: uniq(prev), prevPageviews: count(prev, 'pv'), prevClicks: count(prev, 'click') },
      today: { visitors: uniq(todayEv), pageviews: count(todayEv, 'pv'), clicks: count(todayEv, 'click') },
      dailyRows: [...daily.entries()].map(([date, l]) => ({ date, visitors: uniq(l), pageviews: count(l, 'pv'), clicks: count(l, 'click') })),
      topPages: [...pages.entries()].map(([path, p]) => ({ path, views: p.views, visitors: p.v.size })).sort((a, b) => b.views - a.views).slice(0, 15),
      topClicks: [...clicks.values()].sort((a, b) => b.clicks - a.clicks).slice(0, 15),
      sources: group(cur.filter((e) => e.kind === 'pv'), (e) => e.source).map((x) => ({ source: x.k, visitors: x.v })).slice(0, 10),
      devices: group(cur, (e) => e.device).map((x) => ({ device: x.k, visitors: x.v })),
      since: rows.length ? rows.reduce((m, e) => (e.at < m ? e.at : m), rows[0].at) : null,
    });
  }

  const q = async (sql: string, args: unknown[]) => (await query(sql, args)).rows as Row[];
  const DAY = `to_char(at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`;
  const [totals, prev, today, active, daily, pages, clicks, sources, devices, first] = await Promise.all([
    q(`SELECT count(DISTINCT vid) v, count(*) FILTER (WHERE kind='pv') pv, count(*) FILTER (WHERE kind='click') c FROM site_events WHERE at >= $1`, [start]),
    q(`SELECT count(DISTINCT vid) v, count(*) FILTER (WHERE kind='pv') pv, count(*) FILTER (WHERE kind='click') c FROM site_events WHERE at >= $1 AND at < $2`, [prevStart, start]),
    q(`SELECT count(DISTINCT vid) v, count(*) FILTER (WHERE kind='pv') pv, count(*) FILTER (WHERE kind='click') c FROM site_events WHERE at >= $1`, [todayStart]),
    q(`SELECT path, count(*) v FROM (SELECT DISTINCT ON (vid) vid, path FROM site_events WHERE at >= $1 ORDER BY vid, at DESC) x GROUP BY path ORDER BY v DESC`, [activeSince]),
    q(`SELECT ${DAY} d, count(DISTINCT vid) v, count(*) FILTER (WHERE kind='pv') pv, count(*) FILTER (WHERE kind='click') c FROM site_events WHERE at >= $1 GROUP BY 1`, [start]),
    q(`SELECT path, count(*) views, count(DISTINCT vid) v FROM site_events WHERE kind='pv' AND at >= $1 GROUP BY path ORDER BY views DESC LIMIT 15`, [start]),
    q(`SELECT coalesce(label,'') label, coalesce(href,'') href, count(*) c FROM site_events WHERE kind='click' AND at >= $1 GROUP BY 1, 2 ORDER BY c DESC LIMIT 15`, [start]),
    q(`SELECT source, count(DISTINCT vid) v FROM site_events WHERE kind='pv' AND source IS NOT NULL AND source <> '' AND at >= $1 GROUP BY source ORDER BY v DESC LIMIT 10`, [start]),
    q(`SELECT device, count(DISTINCT vid) v FROM site_events WHERE device IS NOT NULL AND at >= $1 GROUP BY device ORDER BY v DESC`, [start]),
    q(`SELECT min(at) f FROM site_events`, []),
  ]);
  return finish({
    activeNow: active.reduce((a, r) => a + n(r.v), 0),
    activePages: active.map((r) => ({ path: String(r.path), visitors: n(r.v) })),
    totals: { visitors: n(totals[0]?.v), pageviews: n(totals[0]?.pv), clicks: n(totals[0]?.c), prevVisitors: n(prev[0]?.v), prevPageviews: n(prev[0]?.pv), prevClicks: n(prev[0]?.c) },
    today: { visitors: n(today[0]?.v), pageviews: n(today[0]?.pv), clicks: n(today[0]?.c) },
    dailyRows: daily.map((r) => ({ date: String(r.d), visitors: n(r.v), pageviews: n(r.pv), clicks: n(r.c) })),
    topPages: pages.map((r) => ({ path: String(r.path), views: n(r.views), visitors: n(r.v) })),
    topClicks: clicks.map((r) => ({ label: String(r.label), href: String(r.href), clicks: n(r.c) })),
    sources: sources.map((r) => ({ source: String(r.source), visitors: n(r.v) })),
    devices: devices.map((r) => ({ device: String(r.device), visitors: n(r.v) })),
    since: first[0]?.f ? new Date(first[0].f as string).toISOString() : null,
  });

  // Fill in days with no traffic so the chart has one bar per day.
  function finish(r: Omit<TrafficReport, 'days' | 'daily'> & { dailyRows: TrafficReport['daily'] }): TrafficReport {
    const byDate = new Map(r.dailyRows.map((d) => [d.date, d]));
    const daily = Array.from({ length: days }, (_, i) => {
      const date = new Date(startIst.getTime() + i * 86_400_000).toISOString().slice(0, 10);
      return byDate.get(date) || { date, visitors: 0, pageviews: 0, clicks: 0 };
    });
    const { dailyRows: _unused, ...rest } = r;
    return { days, daily, ...rest };
  }
}

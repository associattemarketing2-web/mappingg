import { createHash, randomUUID } from 'node:crypto';
import { query } from './pg';
import { getMongoDb, usingMongo } from './mongodb';

// First-party website analytics for the super-admin dashboard: page views,
// clicks, searches, active visitors, top pages, traffic sources, devices and
// where visitors are (country / state / city).
//
// Cookieless and anonymous: a visitor is a hash of (secret salt + India date +
// IP + browser), so the same person counts once per day, can't be followed
// across days, and no personal data is stored. Location comes from an offline
// IP database (fast-geoip) at the moment of the visit; the IP itself is never
// stored or sent anywhere. Bots and signed-in staff are
// never recorded. Events older than RETENTION_DAYS are pruned automatically.

export type EventKind = 'pv' | 'click' | 'hb' | 'search';
export interface SiteEvent {
  at: string; kind: EventKind; path: string; vid: string;
  label?: string; href?: string; source?: string; device?: string;
  country?: string; region?: string; city?: string; lat?: number; lng?: number;
}

const RETENTION_DAYS = 180;
const ACTIVE_MINUTES = 5;
/** The realtime map / per-minute chart look back this far (like Google Analytics' realtime view). */
export const REALTIME_MINUTES = 30;
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
    ALTER TABLE site_events ADD COLUMN IF NOT EXISTS country text;
    ALTER TABLE site_events ADD COLUMN IF NOT EXISTS region text;
    ALTER TABLE site_events ADD COLUMN IF NOT EXISTS city text;
    ALTER TABLE site_events ADD COLUMN IF NOT EXISTS lat real;
    ALTER TABLE site_events ADD COLUMN IF NOT EXISTS lng real;
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

// ---------------------------------------------------------------- location

/** Indian states / UTs by ISO 3166-2 code (what the IP database returns). */
const IN_STATES: Record<string, string> = {
  AN: 'Andaman & Nicobar', AP: 'Andhra Pradesh', AR: 'Arunachal Pradesh', AS: 'Assam', BR: 'Bihar', CH: 'Chandigarh',
  CT: 'Chhattisgarh', CG: 'Chhattisgarh', DN: 'Dadra & Nagar Haveli and Daman & Diu', DH: 'Dadra & Nagar Haveli and Daman & Diu',
  DD: 'Dadra & Nagar Haveli and Daman & Diu', DL: 'Delhi', GA: 'Goa', GJ: 'Gujarat', HR: 'Haryana', HP: 'Himachal Pradesh',
  JK: 'Jammu & Kashmir', JH: 'Jharkhand', KA: 'Karnataka', KL: 'Kerala', LA: 'Ladakh', LD: 'Lakshadweep', MP: 'Madhya Pradesh',
  MH: 'Maharashtra', MN: 'Manipur', ML: 'Meghalaya', MZ: 'Mizoram', NL: 'Nagaland', OR: 'Odisha', OD: 'Odisha', PY: 'Puducherry',
  PB: 'Punjab', RJ: 'Rajasthan', SK: 'Sikkim', TN: 'Tamil Nadu', TG: 'Telangana', TS: 'Telangana', TR: 'Tripura',
  UP: 'Uttar Pradesh', UT: 'Uttarakhand', UK: 'Uttarakhand', WB: 'West Bengal',
};
let countryNames: Intl.DisplayNames | null = null;
export function countryName(code: string): string {
  try { countryNames ??= new Intl.DisplayNames(['en'], { type: 'region' }); return countryNames.of(code) || code; } catch { return code; }
}
export const regionName = (country: string, code: string) => (country === 'IN' && IN_STATES[code]) || code;

/** Rough centre of each Indian state / UT — a map position for visits saved without city coordinates. */
const IN_STATE_CENTRE: Record<string, [number, number]> = {
  AN: [11.7, 92.7], AP: [15.9, 79.7], AR: [28.2, 94.7], AS: [26.2, 92.9], BR: [25.1, 85.3], CH: [30.7, 76.8], CT: [21.3, 81.9], CG: [21.3, 81.9],
  DN: [20.4, 73.0], DH: [20.4, 73.0], DD: [20.4, 72.8], DL: [28.6, 77.2], GA: [15.3, 74.1], GJ: [22.3, 71.2], HR: [29.1, 76.1], HP: [31.1, 77.2],
  JK: [33.8, 75.0], JH: [23.6, 85.3], KA: [15.3, 75.7], KL: [10.5, 76.3], LA: [34.2, 77.6], LD: [10.6, 72.6], MP: [22.9, 78.7], MH: [19.7, 75.7],
  MN: [24.7, 93.9], ML: [25.5, 91.4], MZ: [23.2, 92.9], NL: [26.2, 94.6], OR: [20.9, 85.1], OD: [20.9, 85.1], PY: [11.9, 79.8], PB: [31.1, 75.3],
  RJ: [27.0, 74.2], SK: [27.5, 88.5], TN: [11.1, 78.7], TG: [18.1, 79.0], TS: [18.1, 79.0], TR: [23.9, 91.9], UP: [26.8, 80.9], UT: [30.1, 79.0],
  UK: [30.1, 79.0], WB: [22.99, 87.9],
};

// Recent lookups are cached — a visitor sends several events per minute.
type Geo = { country?: string; region?: string; city?: string; lat?: number; lng?: number };
const geoCache = new Map<string, Geo>();
const PRIVATE_IP = /^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fc|fd|fe80|unknown$)/i;
export async function locate(ip: string): Promise<Geo> {
  const key = ip.replace(/^::ffff:/, '');
  if (!key || PRIVATE_IP.test(key)) return {};
  const hit = geoCache.get(key);
  if (hit) return hit;
  let out: Geo = {};
  try {
    const geoip = (await import('fast-geoip')).default as { lookup(ip: string): Promise<{ country?: string; region?: string; city?: string; ll?: [number, number] } | null> };
    const g = await geoip.lookup(key);
    // ll is the city's centre point (for the visitors map), not the visitor's own position.
    if (g?.country) out = { country: g.country, region: g.region || undefined, city: g.city || undefined, lat: g.ll?.[0], lng: g.ll?.[1] };
  } catch { /* location is a nice-to-have */ }
  if (geoCache.size > 5000) geoCache.clear();
  geoCache.set(key, out);
  return out;
}

let lastPrune = 0;
export async function recordEvents(events: SiteEvent[]): Promise<void> {
  if (!events.length) return;
  await ensureTable();
  if (usingMongo()) {
    await (await getMongoDb()).collection('site_events').insertMany(events.map((e) => ({ _id: randomUUID() as never, ...e, at: new Date(e.at) })));
  } else {
    const COLS = 13;
    const vals: unknown[] = [];
    const rows = events.map((e, i) => {
      vals.push(e.at, e.kind, e.path, e.vid, e.label ?? null, e.href ?? null, e.source ?? null, e.device ?? null, e.country ?? null, e.region ?? null, e.city ?? null, e.lat ?? null, e.lng ?? null);
      return `(${Array.from({ length: COLS }, (_, c) => '$' + (i * COLS + c + 1)).join(', ')})`;
    });
    await query(`INSERT INTO site_events (at, kind, path, vid, label, href, source, device, country, region, city, lat, lng) VALUES ${rows.join(', ')}`, vals);
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

export interface GeoCountry { code: string; name: string; visitors: number }
/** `code` is ISO 3166-2 ("IN-MH") so it can be drawn on a map. */
export interface GeoRegion { code: string; countryCode: string; name: string; country: string; visitors: number }
export interface GeoCity { name: string; region: string; country: string; countryCode: string; lat: number | null; lng: number | null; visitors: number }

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
  countries: GeoCountry[];
  regions: GeoRegion[];
  cities: GeoCity[];
  /** Visitors in the last REALTIME_MINUTES: total, per minute (oldest first, last = this minute) and where they are. */
  realtime: { visitors: number; perMinute: number[]; countries: GeoCountry[]; regions: GeoRegion[]; cities: GeoCity[] };
  searches: { term: string; count: number; visitors: number }[];
  totalSearches: number;
  since: string | null;
}

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v) || 0;
const GEO_LIMIT = 50;
const country = (code: string, visitors: number): GeoCountry => ({ code, name: countryName(code), visitors });
const region = (c: string, r: string, visitors: number): GeoRegion => ({ code: `${c}-${r}`, countryCode: c, name: regionName(c, r), country: countryName(c), visitors });
const city = (c: string, r: string, name: string, lat: number | undefined, lng: number | undefined, visitors: number): GeoCity => {
  // Older visits have no coordinates — place them at their state's centre so they still show on the map.
  const centre = lat == null && c === 'IN' ? IN_STATE_CENTRE[r] : undefined;
  return { name, region: regionName(c, r), country: countryName(c), countryCode: c, lat: lat ?? centre?.[0] ?? null, lng: lng ?? centre?.[1] ?? null, visitors };
};

export async function trafficReport(days: number): Promise<TrafficReport> {
  await ensureTable();
  const now = Date.now();
  // Range = the last `days` India-time days including today; prev = the same length before it.
  const todayIst = istDate();
  const startIst = new Date(Date.parse(todayIst + 'T00:00:00Z') - (days - 1) * 86_400_000);
  const start = new Date(startIst.getTime() - IST_OFFSET_MS);
  const prevStart = new Date(start.getTime() - days * 86_400_000);
  const activeSince = new Date(now - ACTIVE_MINUTES * 60_000);
  const rtSince = new Date(now - REALTIME_MINUTES * 60_000);
  const minuteOf = (at: number) => REALTIME_MINUTES - 1 - Math.floor((now - at) / 60_000);
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
    const geoOf = (l: SiteEvent[]) => {
      const ll = new Map<string, [number, number]>();
      l.forEach((e) => { if (e.city && e.lat != null && e.lng != null) ll.set(`${e.country}|${e.region || ''}|${e.city}`, [e.lat, e.lng]); });
      return {
        countries: group(l, (e) => e.country).map((x) => country(x.k, x.v)).slice(0, GEO_LIMIT),
        regions: group(l, (e) => (e.region ? `${e.country}|${e.region}` : '')).map((x) => { const [c, r] = x.k.split('|'); return region(c, r, x.v); }).slice(0, GEO_LIMIT),
        cities: group(l, (e) => (e.city ? `${e.country}|${e.region || ''}|${e.city}` : '')).map((x) => { const [c, r, name] = x.k.split('|'); const p = ll.get(x.k); return city(c, r, name, p?.[0], p?.[1], x.v); }).slice(0, GEO_LIMIT),
      };
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
      ...geoOf(cur),
      realtime: (() => {
        const rt = rows.filter((e) => inRange(e, rtSince));
        const per = Array.from({ length: REALTIME_MINUTES }, () => new Set<string>());
        rt.forEach((e) => per[minuteOf(Date.parse(e.at))]?.add(e.vid));
        return { visitors: uniq(rt), perMinute: per.map((x) => x.size), ...geoOf(rt) };
      })(),
      searches: (() => {
        const m = new Map<string, { count: number; v: Set<string> }>();
        cur.filter((e) => e.kind === 'search' && e.label).forEach((e) => { const k = e.label!.toLowerCase(); const x = m.get(k) || { count: 0, v: new Set() }; x.count++; x.v.add(e.vid); m.set(k, x); });
        return [...m.entries()].map(([term, x]) => ({ term, count: x.count, visitors: x.v.size })).sort((a, b) => b.count - a.count).slice(0, 20);
      })(),
      totalSearches: count(cur, 'search'),
      since: rows.length ? rows.reduce((m, e) => (e.at < m ? e.at : m), rows[0].at) : null,
    });
  }

  const q = async (sql: string, args: unknown[]) => (await query(sql, args)).rows as Row[];
  const DAY = `to_char(at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`;
  const geoSql = (since: Date) => Promise.all([
    q(`SELECT country, count(DISTINCT vid) v FROM site_events WHERE country IS NOT NULL AND at >= $1 GROUP BY country ORDER BY v DESC LIMIT ${GEO_LIMIT}`, [since]),
    q(`SELECT country, region, count(DISTINCT vid) v FROM site_events WHERE region IS NOT NULL AND region <> '' AND at >= $1 GROUP BY country, region ORDER BY v DESC LIMIT ${GEO_LIMIT}`, [since]),
    q(`SELECT country, coalesce(region, '') region, city, avg(lat) lat, avg(lng) lng, count(DISTINCT vid) v FROM site_events WHERE city IS NOT NULL AND city <> '' AND at >= $1 GROUP BY country, region, city ORDER BY v DESC LIMIT ${GEO_LIMIT}`, [since]),
  ]).then(([cs, rs, ci]) => ({
    countries: cs.map((r) => country(String(r.country), n(r.v))),
    regions: rs.map((r) => region(String(r.country), String(r.region), n(r.v))),
    cities: ci.map((r) => city(String(r.country), String(r.region), String(r.city), r.lat == null ? undefined : Number(r.lat), r.lng == null ? undefined : Number(r.lng), n(r.v))),
  }));
  const [totals, prev, today, active, daily, pages, clicks, sources, devices, first, geoRange, geoRt, rtTotal, rtMinutes, searches, nSearch] = await Promise.all([
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
    geoSql(start),
    geoSql(rtSince),
    q(`SELECT count(DISTINCT vid) v FROM site_events WHERE at >= $1`, [rtSince]),
    q(`SELECT floor(extract(epoch FROM ($2::timestamptz - at)) / 60)::int m, count(DISTINCT vid) v FROM site_events WHERE at >= $1 GROUP BY 1`, [rtSince, new Date(now)]),
    q(`SELECT lower(label) term, count(*) c, count(DISTINCT vid) v FROM site_events WHERE kind = 'search' AND label IS NOT NULL AND at >= $1 GROUP BY 1 ORDER BY c DESC LIMIT 20`, [start]),
    q(`SELECT count(*) c FROM site_events WHERE kind = 'search' AND at >= $1`, [start]),
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
    ...geoRange,
    realtime: (() => {
      const per = Array<number>(REALTIME_MINUTES).fill(0);
      rtMinutes.forEach((x) => { const i = REALTIME_MINUTES - 1 - n(x.m); if (i >= 0 && i < REALTIME_MINUTES) per[i] = n(x.v); });
      return { visitors: n(rtTotal[0]?.v), perMinute: per, ...geoRt };
    })(),
    searches: searches.map((r) => ({ term: String(r.term), count: n(r.c), visitors: n(r.v) })),
    totalSearches: n(nSearch[0]?.c),
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

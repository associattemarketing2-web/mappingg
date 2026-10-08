'use client';

import { useEffect, useState } from 'react';
import { ChartCard, Donut, HBars, StatTile, WeekColumns } from './SeoCharts';

// "Website traffic" on the super-admin Dashboard: who is on the site right now,
// visitors / page views / clicks over a chosen range, where visitors are
// (country / state / city), what they searched, top pages, most-clicked links,
// traffic sources and devices. Data: /api/admin/traffic (lib/site-analytics.ts).
interface Report {
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
  countries: { code: string; name: string; visitors: number }[];
  regions: { name: string; country: string; visitors: number }[];
  cities: { name: string; region: string; country: string; visitors: number }[];
  searches: { term: string; count: number; visitors: number }[];
  totalSearches: number;
  since: string | null;
}
type GeoLevel = 'country' | 'region' | 'city';

const RANGES: [number, string][] = [[1, 'Today'], [7, '7 days'], [30, '30 days'], [90, '90 days']];
const DEVICE_COLORS: Record<string, string> = { Mobile: '#2f7a3c', Desktop: '#2d6fa3', Tablet: '#b0924f' };
const fmt = (n: number) => n.toLocaleString('en-IN');
const PAGE_NAMES: Record<string, string> = { '/': 'Home', '/map': 'Live map', '/blog': 'Blog', '/projects': 'All projects', '/contact': 'Contact' };
const pageName = (p: string) => PAGE_NAMES[p] || p;

/** "+12% vs previous 7 days" — or nothing when there is no earlier data to compare. */
function change(cur: number, prev: number, days: number) {
  if (!prev) return cur ? 'New this period' : undefined;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs previous ${days === 1 ? 'day' : `${days} days`}`;
}

export default function TrafficPanel() {
  const [days, setDays] = useState(7);
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState('');
  const [geo, setGeo] = useState<GeoLevel>('region');

  async function load(d = days) {
    try {
      const res = await fetch(`/api/admin/traffic?days=${d}`, { credentials: 'same-origin' });
      const b = await res.json();
      if (!res.ok) throw new Error(b?.error?.message || 'Could not load website traffic');
      setR(b.data); setErr('');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load website traffic'); }
  }
  useEffect(() => { load(days); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Active now" stays live: refresh every 30 s while the tab is open.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30_000);
    return () => clearInterval(t);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const head = (
    <div className="trf-head">
      <div>
        <h3><i className="fas fa-chart-line" /> Website traffic</h3>
        <p className="muted">Visitors to mappingg.com — counted anonymously, without cookies. Bots and the team&apos;s own visits are left out.</p>
      </div>
      <div className="viz-toggle" role="tablist" aria-label="Date range">
        {RANGES.map(([d, l]) => (
          <button key={d} type="button" role="tab" aria-selected={days === d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>{l}</button>
        ))}
      </div>
    </div>
  );

  if (!r) {
    return (
      <section className="trf">
        {head}
        <div className="adm-empty"><i className={`fas ${err ? 'fa-triangle-exclamation' : 'fa-spinner fa-spin'}`} /><p>{err || 'Loading website traffic…'}</p></div>
      </section>
    );
  }

  const t = r.totals;
  const rangeLabel = r.days === 1 ? 'today' : `in the last ${r.days} days`;
  const empty = !r.since;
  const maxPage = Math.max(...r.topPages.map((p) => p.views), 1);
  const maxClick = Math.max(...r.topClicks.map((c) => c.clicks), 1);
  const maxSrc = Math.max(...r.sources.map((s) => s.visitors), 1);
  const devTotal = r.devices.reduce((a, d) => a + d.visitors, 0);
  const clickName = (c: Report['topClicks'][number]) => c.label || c.href || '(no label)';
  // Location rows for the chosen level. India's states are the default view.
  const geoRows = geo === 'country'
    ? r.countries.map((c) => ({ label: c.name, value: c.visitors, extra: c.code }))
    : geo === 'region'
      ? r.regions.map((x) => ({ label: x.name, value: x.visitors, extra: x.country }))
      : r.cities.map((x) => ({ label: x.name, value: x.visitors, extra: [x.region, x.country].filter(Boolean).join(', ') }));
  const maxGeo = Math.max(...geoRows.map((g) => g.value), 1);
  const maxSearch = Math.max(...r.searches.map((x) => x.count), 1);
  const GEO_TABS: [GeoLevel, string][] = [['country', 'Country'], ['region', 'State'], ['city', 'City']];

  return (
    <section className="trf">
      {head}
      {err && <p className="dp-warn"><i className="fas fa-triangle-exclamation" /> {err} — showing the last loaded numbers.</p>}
      {empty && (
        <p className="adm-note"><i className="fas fa-circle-info" /><span>Tracking is switched on. Numbers appear here as soon as people visit the website.</span></p>
      )}

      <div className="viz-tiles">
        <div className="viz-tile trf-live">
          <span className="viz-tile-label"><span className="trf-dot" aria-hidden="true" /> Active right now</span>
          <span className="viz-tile-value">{fmt(r.activeNow)}</span>
          <span className="viz-tile-note">
            {r.activePages.length ? r.activePages.slice(0, 2).map((p) => `${pageName(p.path)} (${p.visitors})`).join(' · ') : 'Nobody on the site in the last 5 min'}
          </span>
        </div>
        <StatTile label={`Visitors ${rangeLabel}`} value={fmt(t.visitors)} note={change(t.visitors, t.prevVisitors, r.days) || `${fmt(r.today.visitors)} today`} />
        <StatTile label="Page views" value={fmt(t.pageviews)} note={change(t.pageviews, t.prevPageviews, r.days) || `${t.visitors ? (t.pageviews / t.visitors).toFixed(1) : '0'} pages per visitor`} />
        <StatTile label="Clicks" value={fmt(t.clicks)} note={change(t.clicks, t.prevClicks, r.days) || 'Links and buttons clicked'} />
      </div>

      {r.days > 1 && (
        <ChartCard
          title="Visitors per day"
          subtitle="Unique visitors each day (India time)"
          table={{ head: ['Day', 'Visitors', 'Page views', 'Clicks'], rows: [...r.daily].reverse().map((d) => [d.date, d.visitors, d.pageviews, d.clicks]) }}
        >
          {(show, hide) => <WeekColumns period="day" data={r.daily.map((d) => ({ week: d.date, count: d.visitors }))} noun={['visitor', 'visitors']} show={show} hide={hide} />}
        </ChartCard>
      )}

      <div className="viz-grid2">
        <ChartCard title="Where visitors are" subtitle={`Visitors ${rangeLabel}, by ${geo === 'region' ? 'state' : geo}`}
          table={{ head: [geo === 'country' ? 'Country' : geo === 'region' ? 'State' : 'City', geo === 'country' ? 'Code' : geo === 'region' ? 'Country' : 'State, country', 'Visitors'], rows: geoRows.map((g) => [g.label, g.extra, g.value]) }}>
          {(show, hide) => (
            <>
              <div className="viz-toggle trf-geo" role="tablist" aria-label="Location level">
                {GEO_TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={geo === k} className={geo === k ? 'on' : ''} onClick={() => setGeo(k)}>{l}</button>)}
              </div>
              {geoRows.length ? (
                <HBars rows={geoRows.map(({ label, value }) => ({ label, value }))} max={maxGeo} show={show} hide={hide} valueText={fmt}
                  tipLines={(row) => { const g = geoRows.find((x) => x.label === row.label); return [`${fmt(row.value)} visitors`, g?.extra || '']; }} />
              ) : <div className="adm-empty"><p>No location data yet.</p></div>}
            </>
          )}
        </ChartCard>
        <ChartCard title="What people searched" subtitle={`${fmt(r.totalSearches)} searches on the site ${rangeLabel} (home page and live map)`}
          table={{ head: ['Search', 'Times', 'Visitors'], rows: r.searches.map((x) => [x.term, x.count, x.visitors]) }}>
          {(show, hide) => r.searches.length ? (
            <HBars rows={r.searches.map((x) => ({ label: x.term, value: x.count }))} max={maxSearch} show={show} hide={hide} valueText={fmt}
              tipLines={(row) => { const x = r.searches.find((y) => y.term === row.label); return [`Searched ${fmt(row.value)} time${row.value === 1 ? '' : 's'}`, `by ${fmt(x?.visitors || 0)} visitor${x?.visitors === 1 ? '' : 's'}`]; }} />
          ) : <div className="adm-empty"><p>No searches yet.</p></div>}
        </ChartCard>
      </div>

      <div className="viz-grid2">
        <ChartCard title="Most visited pages" subtitle={`Page views ${rangeLabel}`}
          table={{ head: ['Page', 'Views', 'Visitors'], rows: r.topPages.map((p) => [p.path, p.views, p.visitors]) }}>
          {(show, hide) => r.topPages.length ? (
            <HBars rows={r.topPages.map((p) => ({ label: pageName(p.path), value: p.views }))} max={maxPage} show={show} hide={hide}
              valueText={fmt} tipLines={(row) => { const p = r.topPages.find((x) => pageName(x.path) === row.label); return [`${fmt(row.value)} views`, `${fmt(p?.visitors || 0)} visitors`, p?.path || '']; }} />
          ) : <div className="adm-empty"><p>No page views yet.</p></div>}
        </ChartCard>
        <ChartCard title="Most clicked" subtitle={`Links and buttons ${rangeLabel}`}
          table={{ head: ['Clicked', 'Goes to', 'Clicks'], rows: r.topClicks.map((c) => [clickName(c), c.href, c.clicks]) }}>
          {(show, hide) => r.topClicks.length ? (
            <HBars rows={r.topClicks.map((c) => ({ label: clickName(c), value: c.clicks }))} max={maxClick} show={show} hide={hide}
              valueText={fmt} tipLines={(row) => { const c = r.topClicks.find((x) => clickName(x) === row.label); return [`${fmt(row.value)} clicks`, c?.href ? `→ ${c.href}` : '']; }} />
          ) : <div className="adm-empty"><p>No clicks yet.</p></div>}
        </ChartCard>
      </div>

      <div className="viz-grid2">
        <ChartCard title="Where visitors come from" subtitle="First page of each visit"
          table={{ head: ['Source', 'Visitors'], rows: r.sources.map((s) => [s.source, s.visitors]) }}>
          {(show, hide) => r.sources.length ? (
            <HBars rows={r.sources.map((s) => ({ label: s.source, value: s.visitors }))} max={maxSrc} show={show} hide={hide}
              valueText={fmt} tipLines={(row) => [`${fmt(row.value)} visitors`]} />
          ) : <div className="adm-empty"><p>No visits yet.</p></div>}
        </ChartCard>
        <ChartCard title="Devices" subtitle={`Visitors ${rangeLabel}`}
          table={{ head: ['Device', 'Visitors'], rows: r.devices.map((d) => [d.device, d.visitors]) }}>
          {(show, hide) => devTotal ? (
            <Donut slices={r.devices.map((d) => ({ key: d.device, label: d.device, count: d.visitors, color: DEVICE_COLORS[d.device] || '#9b9a94' }))}
              centerValue={fmt(devTotal)} centerLabel="visitors" show={show} hide={hide} />
          ) : <div className="adm-empty"><p>No visits yet.</p></div>}
        </ChartCard>
      </div>
    </section>
  );
}

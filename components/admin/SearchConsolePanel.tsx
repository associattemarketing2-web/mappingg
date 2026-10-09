'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Donut } from './SeoCharts';
import GeoMap from './GeoMap';
import GscTrend, { METRIC, type GscMetric } from './GscTrend';
import { alpha2, countryLabel } from '@/lib/iso-countries';

// Live Google Search Console numbers for the SEO & Health tab — fetched from
// /api/admin/search-console (service-account access, see lib/search-console.ts).
// Laid out like Search Console's Performance report, in plain words: a one-line
// summary, four metric boxes that switch lines on the chart, a world map of where
// searchers are, the queries / pages / countries / devices table, how high the
// site ranks, quick wins, devices, and index & sitemap health.

interface Row { key: string; clicks: number; impressions: number; ctr: number; position: number }
interface Totals { clicks: number; impressions: number; ctr: number; position: number }
export interface GscReportData {
  status: 'ok';
  days: number; fetchedAt: string; site: string; permission: string;
  range: { startDate: string; endDate: string };
  totals: Totals; previous: Totals;
  daily: { date: string; clicks: number; impressions: number; position: number }[];
  queries: Row[]; pages: Row[]; countries: Row[]; devices: Row[];
  sitemaps: { path: string; lastSubmitted: string | null; lastDownloaded: string | null; pending: boolean; errors: number; warnings: number; submitted: number }[];
  homepage: { url: string; verdict: string; coverage: string; lastCrawl: string | null; canonical: string; robots: string; fetch: string } | null;
}
type Resp = GscReportData | { status: 'not_configured' | 'auth_failed' | 'no_access' | 'api_error'; message?: string; serviceAccount?: string };

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');
const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`;
const pos1 = (n: number) => (n ? n.toFixed(1) : '—');
const day = (d: string, o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', ...o });
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const path = (u: string) => { try { const x = new URL(u); return x.pathname + x.search || '/'; } catch { return u; } };

const ORDER: GscMetric[] = ['clicks', 'impressions', 'ctr', 'position'];
const HINT: Record<GscMetric, string> = {
  clicks: 'Times someone clicked your site in Google results',
  impressions: 'Times your site was shown in Google results',
  ctr: 'Share of people who saw your site and clicked',
  position: 'Average rank on Google — 1 is the very top',
};
const DEVICE_COLORS: Record<string, string> = { MOBILE: '#4285f4', DESKTOP: '#5e35b1', TABLET: '#00897b' };
const RANK_BANDS = [
  { key: 'top', label: 'Top 3', note: 'Best spots — most clicks go here', color: '#188038', test: (p: number) => p <= 3 },
  { key: 'p1', label: '4 – 10', note: 'Rest of page 1', color: '#4285f4', test: (p: number) => p > 3 && p <= 10 },
  { key: 'p2', label: '11 – 20', note: 'Page 2 — few people look here', color: '#f9ab00', test: (p: number) => p > 10 && p <= 20 },
  { key: 'far', label: '20+', note: 'Page 3 or later', color: '#9aa0a6', test: (p: number) => p > 20 },
];
const rankClass = (p: number) => RANK_BANDS.find((b) => b.test(p))?.key || 'far';

/** Change vs the previous period as { text, good }; for position a lower number is the improvement. */
function change(m: GscMetric, cur: number, prev: number) {
  if (!prev) return null;
  if (m === 'position') {
    const d = prev - cur;
    return { text: `${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${Math.abs(d).toFixed(1)} places`, good: d > 0, flat: Math.abs(d) < 0.05 };
  }
  if (m === 'ctr') {
    const d = (cur - prev) * 100;
    return { text: `${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${Math.abs(d).toFixed(1)} pts`, good: d > 0, flat: Math.abs(d) < 0.05 };
  }
  const d = ((cur - prev) / prev) * 100;
  return { text: `${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${Math.abs(d).toFixed(0)}%`, good: d > 0, flat: Math.round(d) === 0 };
}

export default function SearchConsolePanel() {
  const [days, setDays] = useState(28);
  const [d, setD] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback((refresh = false) => {
    setLoading(true);
    fetch(`/api/admin/search-console?days=${days}${refresh ? '&refresh=1' : ''}`, { credentials: 'same-origin' })
      .then((r) => r.json()).then((b) => setD(b?.data || { status: 'api_error', message: 'Empty response' }))
      .catch(() => setD({ status: 'api_error', message: 'Could not reach the server' }))
      .finally(() => setLoading(false));
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const head = (
    <div className="gsc-bar">
      <div>
        <h2 className="gsc-title"><i className="fab fa-google" /> Google Search Console <span className="gsc-live">LIVE</span></h2>
        {d?.status === 'ok'
          ? <p className="muted">{d.site.replace(/^sc-domain:/, '')} · {day(d.range.startDate, { day: 'numeric', month: 'short', year: 'numeric' })} – {day(d.range.endDate, { day: 'numeric', month: 'short', year: 'numeric' })} · updated {when(d.fetchedAt)}</p>
          : <p className="muted">How people find the website on Google Search</p>}
      </div>
      <div className="gsc-actions">
        <div className="viz-toggle" role="tablist" aria-label="Date range">
          {[[7, '7 days'], [28, '28 days'], [90, '3 months']].map(([n, l]) => <button key={n} role="tab" aria-selected={days === n} className={days === n ? 'on' : ''} onClick={() => setDays(n as number)}>{l}</button>)}
        </div>
        <button className="adm-btn ghost sm" onClick={() => load(true)} disabled={loading}><i className={`fas fa-rotate${loading ? ' fa-spin' : ''}`} /> Refresh</button>
      </div>
    </div>
  );

  if (!d) return <div className="viz gsc">{head}<div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading Search Console…</p></div></div>;

  if (d.status !== 'ok') {
    const notSet = d.status === 'not_configured';
    return (
      <div className="viz gsc">
        {head}
        <div className="adm-panel">
          <div className="adm-panel-head"><h3>{notSet ? 'Connect Search Console to see clicks & rankings' : 'Search Console could not be read'}</h3></div>
          {!notSet && <p className="adm-note gsc-err"><i className="fas fa-triangle-exclamation" /><span>{d.message}</span></p>}
          <div className="adm-health" style={{ marginTop: 12 }}>
            {[
              ['Enable the API', 'Google Cloud console → APIs & Services → enable “Google Search Console API”.'],
              ['Create a service account', 'IAM → Service accounts → Create → Keys → Add key → JSON. Download the file.'],
              ['Give it access', <>Search Console → Settings → Users and permissions → Add user → paste <b>{d.serviceAccount || 'the service account email'}</b> (Restricted is enough).</>],
              ['Add the env vars', <>On the server set <code>GSC_SERVICE_ACCOUNT_JSON</code> (the whole JSON file) — or <code>GSC_SERVICE_ACCOUNT_EMAIL</code> + <code>GSC_PRIVATE_KEY</code> — and optionally <code>GSC_SITE_URL</code> (e.g. <code>sc-domain:mappingg.com</code>). Redeploy.</>],
            ].map(([t, desc], i) => (
              <div className="adm-health-row" key={i}><span className="viz-step">{i + 1}</span><div><b>{t}</b><br /><span className="muted">{desc}</span></div></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return <div className="viz gsc">{head}<GscReport d={d} /></div>;
}

type Tab = 'queries' | 'pages' | 'countries' | 'devices';
type SortKey = 'clicks' | 'impressions' | 'ctr' | 'position';

/** The report itself (everything under the header) — kept separate so it renders from data alone. */
export function GscReport({ d }: { d: GscReportData }) {
  const [metrics, setMetrics] = useState<GscMetric[]>(['clicks', 'impressions']);
  const [mapMetric, setMapMetric] = useState<'clicks' | 'impressions'>('clicks');
  const [tab, setTab] = useState<Tab>('queries');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'clicks', desc: true });
  const [filter, setFilter] = useState('');
  const [all, setAll] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number; title: string; lines: string[] } | null>(null);

  const t = d.totals, p = d.previous;
  const daily = useMemo(() => d.daily.map((x) => ({ ...x, ctr: x.impressions ? x.clicks / x.impressions : 0 })), [d.daily]);
  const toggle = (m: GscMetric) => setMetrics((cur) => (cur.includes(m) ? (cur.length > 1 ? cur.filter((x) => x !== m) : cur) : ORDER.filter((x) => x === m || cur.includes(x))));

  // ---- summary sentence
  const clicksChange = change('clicks', t.clicks, p.clicks);
  const summary = t.impressions
    ? <>In the last <b>{d.days} days</b> your site was shown <b>{fmt(t.impressions)} times</b> on Google and got <b>{fmt(t.clicks)} clicks</b> — about <b>{pct1(t.ctr)}</b> of people who saw it clicked. On average it ranked <b>#{pos1(t.position)}</b>.
      {clicksChange && !clicksChange.flat && <> Clicks are <b className={clicksChange.good ? 'up' : 'down'}>{clicksChange.good ? 'up' : 'down'} {clicksChange.text.replace(/[▲▼]\s*/, '')}</b> on the previous {d.days} days.</>}</>
    : <>No Google Search data for this period yet — new sites usually start showing numbers 2–4 days after verification.</>;

  // ---- map
  const countries = d.countries.map((c) => ({ ...c, a2: alpha2(c.key), name: countryLabel(c.key) }));
  const mapRows = countries.filter((c) => c[mapMetric] > 0).map((c) => ({ code: c.a2, name: c.name, visitors: c[mapMetric] }));
  const countryTotal = countries.reduce((a, c) => a + c[mapMetric], 0) || 1;
  const mapColor: [string, string] = mapMetric === 'clicks' ? ['#d2e3fc', '#1a73e8'] : ['#e1d5f5', '#5e35b1'];

  // ---- table
  const label = (r: Row) => (tab === 'pages' ? path(r.key) : tab === 'countries' ? countryLabel(r.key) : tab === 'devices' ? r.key[0] + r.key.slice(1).toLowerCase() : r.key);
  const source = tab === 'queries' ? d.queries : tab === 'pages' ? d.pages : tab === 'countries' ? d.countries : d.devices;
  const q = filter.trim().toLowerCase();
  const sorted = source.filter((r) => !q || label(r).toLowerCase().includes(q))
    .sort((a, b) => (sort.desc ? b[sort.key] - a[sort.key] : a[sort.key] - b[sort.key]));
  const rows = all ? sorted : sorted.slice(0, 10);
  const maxClicks = Math.max(...source.map((r) => r.clicks), 1);
  const TABS: [Tab, string, string][] = [['queries', 'Queries', 'What people typed'], ['pages', 'Pages', 'Your pages'], ['countries', 'Countries', 'Where'], ['devices', 'Devices', 'Phone / computer']];
  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== 'position' }));

  // ---- ranking bands + quick wins
  const bands = RANK_BANDS.map((b) => ({ ...b, n: d.queries.filter((x) => b.test(x.position)).length }));
  const nRanked = bands.reduce((a, b) => a + b.n, 0);
  const wins = d.queries.filter((x) => x.position > 3 && x.position <= 20 && x.impressions >= 5)
    .sort((a, b) => b.impressions - a.impressions).slice(0, 5);

  const devices = d.devices.map((x) => ({ key: x.key, label: x.key[0] + x.key.slice(1).toLowerCase(), count: x.clicks, color: DEVICE_COLORS[x.key] || '#9aa0a6' }));
  const devTotal = devices.reduce((a, x) => a + x.count, 0);
  const hp = d.homepage;
  const indexed = hp?.verdict === 'PASS';
  const showTip = (e: React.PointerEvent, title: string, lines: string[]) => {
    const r = (e.currentTarget.closest('.gsc-card') as HTMLElement | null)?.getBoundingClientRect();
    if (r) setTip({ x: e.clientX - r.left, y: e.clientY - r.top, title, lines });
  };

  return (
    <>
      <p className="gsc-summary"><i className="fas fa-lightbulb" aria-hidden="true" /><span>{summary}</span></p>

      {/* Metric boxes — click to add/remove the line on the chart, like Search Console. */}
      <div className="gsc-metrics" role="group" aria-label="Metrics shown on the chart">
        {ORDER.map((m) => {
          const on = metrics.includes(m);
          const c = change(m, t[m], p[m]);
          return (
            <button key={m} type="button" className={`gsc-m${on ? ' on' : ''}`} style={{ '--m': METRIC[m].color } as React.CSSProperties}
              aria-pressed={on} onClick={() => toggle(m)} title={on ? 'Hide from chart' : 'Show on chart'}>
              <span className="gsc-m-top"><i className={`far ${on ? 'fa-square-check' : 'fa-square'}`} aria-hidden="true" /> {m === 'ctr' ? 'Click rate (CTR)' : m === 'position' ? 'Average position' : `Total ${METRIC[m].label.toLowerCase()}`}</span>
              <span className="gsc-m-val">{m === 'position' && t.position ? '#' : ''}{METRIC[m].fmt(t[m])}</span>
              <span className="gsc-m-hint">{HINT[m]}</span>
              <span className={`gsc-m-delta${c && !c.flat ? (c.good ? ' up' : ' down') : ''}`}>{c ? `${c.flat ? 'No change' : c.text} vs previous ${d.days} days` : `No data for the previous ${d.days} days`}</span>
            </button>
          );
        })}
      </div>

      <section className="adm-panel gsc-card">
        <div className="gsc-card-head">
          <div><h3>Performance over time</h3><p className="muted">Each line uses its own scale. Tap the boxes above to show or hide a line.{metrics.includes('position') ? ' Position is drawn upside down — higher on the chart means a better rank.' : ''}</p></div>
        </div>
        <GscTrend data={daily} metrics={metrics} />
      </section>

      <section className="adm-panel gsc-card gsc-geo">
        <div className="gsc-card-head">
          <div><h3>Where searchers are</h3><p className="muted">Countries where people saw or clicked your site on Google — darker means more.</p></div>
          <div className="rt-seg" role="tablist" aria-label="Map metric">
            {(['clicks', 'impressions'] as const).map((m) => <button key={m} type="button" role="tab" aria-selected={mapMetric === m} className={mapMetric === m ? 'on' : ''} onClick={() => setMapMetric(m)}>{METRIC[m].label}</button>)}
          </div>
        </div>
        <div className="gsc-geo-body">
          <GeoMap data={{ level: 'country', rows: mapRows }} noun={mapMetric === 'clicks' ? ['click', 'clicks'] : ['impression', 'impressions']} color={mapColor} />
          <ol className="rt-rows gsc-geo-list">
            {countries.length ? [...countries].sort((a, b) => b[mapMetric] - a[mapMetric]).slice(0, 8).map((c) => (
              <li key={c.key} title={`${c.name}: ${fmt(c.clicks)} clicks, ${fmt(c.impressions)} impressions, avg position ${pos1(c.position)}`}>
                <span className="rt-row-name">{c.name}<small>#{pos1(c.position)} avg</small></span>
                <span className="rt-row-val">{fmt(c[mapMetric])} <small className="muted">{Math.round((c[mapMetric] / countryTotal) * 100)}%</small></span>
                <span className="rt-row-bar" style={{ width: `${(c[mapMetric] / Math.max(...countries.map((x) => x[mapMetric]), 1)) * 100}%`, background: METRIC[mapMetric].color }} aria-hidden="true" />
              </li>
            )) : <p className="rt-none">No country data yet</p>}
          </ol>
        </div>
      </section>

      <section className="adm-panel gsc-card">
        <div className="gsc-tabs" role="tablist" aria-label="Breakdown">
          {TABS.map(([k, l, sub]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setFilter(''); setAll(false); }}>
              {l}<small>{sub}</small>
            </button>
          ))}
        </div>
        {(tab === 'queries' || tab === 'pages') && (
          <label className="gsc-filter"><i className="fas fa-magnifying-glass" aria-hidden="true" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={tab === 'queries' ? 'Find a search term…' : 'Find a page…'} aria-label="Filter rows" />
          </label>
        )}
        {sorted.length ? (
          <div className="gsc-table-wrap">
            <table className="adm-table gsc-table">
              <thead>
                <tr>
                  <th>{tab === 'queries' ? 'Search term' : tab === 'pages' ? 'Page' : tab === 'countries' ? 'Country' : 'Device'}</th>
                  {ORDER.map((m) => (
                    <th key={m} aria-sort={sort.key === m ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
                      <button type="button" className={sort.key === m ? 'on' : ''} onClick={() => sortBy(m)} style={{ '--m': METRIC[m].color } as React.CSSProperties}>
                        {METRIC[m].label}{sort.key === m && <i className={`fas fa-arrow-${sort.desc ? 'down' : 'up'}`} aria-hidden="true" />}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="gsc-key">{tab === 'pages' ? <a href={r.key} target="_blank" rel="noreferrer">{label(r)}</a> : label(r)}</td>
                    <td className="gsc-clicks"><span className="gsc-inbar" style={{ width: `${(r.clicks / maxClicks) * 100}%` }} aria-hidden="true" /><span>{fmt(r.clicks)}</span></td>
                    <td>{fmt(r.impressions)}</td><td>{pct1(r.ctr)}</td>
                    <td><span className={`gsc-pos ${rankClass(r.position)}`}>{pos1(r.position)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="rt-none">{q ? 'Nothing matches that search.' : 'No data for this period yet.'}</p>}
        {sorted.length > 10 && (
          <button type="button" className="gsc-more" onClick={() => setAll((x) => !x)}>{all ? 'Show top 10' : `Show all ${sorted.length}`} <i className={`fas fa-chevron-${all ? 'up' : 'down'}`} aria-hidden="true" /></button>
        )}
      </section>

      <div className="viz-grid2">
        <section className="adm-panel gsc-card" onPointerLeave={() => setTip(null)}>
          <div className="gsc-card-head"><div><h3>How high you rank</h3><p className="muted">Your top {nRanked} search terms, grouped by their spot on Google. Most people only click the first few results.</p></div></div>
          {nRanked ? (
            <>
              <div className="gsc-stack" role="img" aria-label={bands.map((b) => `${b.label}: ${b.n}`).join(', ')}>
                {bands.filter((b) => b.n).map((b) => (
                  <span key={b.key} style={{ flexGrow: b.n, background: b.color }}
                    onPointerMove={(e) => showTip(e, `Position ${b.label}`, [`${b.n} search term${b.n === 1 ? '' : 's'}`, b.note])} />
                ))}
              </div>
              <ul className="gsc-bands">
                {bands.map((b) => (
                  <li key={b.key}><i style={{ background: b.color }} aria-hidden="true" /><b>{b.label}</b><span className="muted">{b.note}</span><em>{b.n}<small> · {Math.round((b.n / nRanked) * 100)}%</small></em></li>
                ))}
              </ul>
            </>
          ) : <p className="rt-none">No search terms yet.</p>}
          {tip && <div className="viz-tip" style={{ left: tip.x, top: tip.y }} role="status"><b>{tip.title}</b>{tip.lines.map((l, i) => <span key={i}>{l}</span>)}</div>}
        </section>

        <section className="adm-panel gsc-card">
          <div className="gsc-card-head"><div><h3><i className="fas fa-bolt gsc-bolt" aria-hidden="true" /> Quick wins</h3><p className="muted">Searches where you already show up but aren&apos;t in the top 3 yet. Improving these pages is the fastest way to more clicks.</p></div></div>
          {wins.length ? (
            <ol className="gsc-wins">
              {wins.map((w) => (
                <li key={w.key}>
                  <span className="gsc-win-q">“{w.key}”</span>
                  <span className={`gsc-pos ${rankClass(w.position)}`}>#{pos1(w.position)}</span>
                  <span className="muted gsc-win-sub">Shown {fmt(w.impressions)} times · {fmt(w.clicks)} clicks ({pct1(w.ctr)}) · {w.position <= 10 ? 'on page 1 — push into the top 3' : 'on page 2 — close to page 1'}</span>
                </li>
              ))}
            </ol>
          ) : <p className="rt-none">No quick wins right now — nothing ranks between #4 and #20 with enough views.</p>}
        </section>
      </div>

      <div className="viz-grid2">
        <section className="adm-panel gsc-card gsc-dev" onPointerLeave={() => setTip(null)}>
          <div className="gsc-card-head"><div><h3>Phone or computer?</h3><p className="muted">Clicks from Google by device.</p></div></div>
          {devTotal ? (
            <Donut slices={devices} centerValue={fmt(devTotal)} centerLabel="clicks" show={showTip} hide={() => setTip(null)} />
          ) : <p className="rt-none">No clicks yet.</p>}
          {tip && <div className="viz-tip" style={{ left: tip.x, top: tip.y }} role="status"><b>{tip.title}</b>{tip.lines.map((l, i) => <span key={i}>{l}</span>)}</div>}
        </section>

        <section className="adm-panel gsc-card">
          <div className="gsc-card-head"><div><h3>Is Google reading the site?</h3><p className="muted">Homepage index status and sitemaps.</p></div></div>
          <div className="adm-health">
            <div className="adm-health-row">
              <i className={`fas ${indexed ? 'fa-circle-check' : 'fa-circle-exclamation'} viz-check ${indexed ? 'ok' : 'warn'}`} aria-hidden="true" />
              <div><b>Homepage on Google</b><br /><span className="muted">{hp ? `${hp.coverage || hp.verdict} · last crawl ${when(hp.lastCrawl)}` : 'URL inspection unavailable'}</span></div>
              <span className="val">{hp ? (indexed ? 'Indexed' : 'Not indexed') : '—'}</span>
            </div>
            {d.sitemaps.length ? d.sitemaps.map((s) => (
              <div className="adm-health-row" key={s.path}>
                <i className={`fas ${s.errors ? 'fa-circle-exclamation' : 'fa-circle-check'} viz-check ${s.errors ? 'warn' : 'ok'}`} aria-hidden="true" />
                <div><b>{path(s.path)}</b><br /><span className="muted">Read by Google {when(s.lastDownloaded)} · {fmt(s.submitted)} URLs{s.pending ? ' · processing' : ''}</span></div>
                <span className="val">{s.errors ? `${s.errors} errors` : s.warnings ? `${s.warnings} warnings` : 'OK'}</span>
              </div>
            )) : (
              <div className="adm-health-row"><i className="fas fa-circle-exclamation viz-check warn" /><div><b>No sitemap submitted</b><br /><span className="muted">Search Console → Sitemaps → submit <code>sitemap.xml</code></span></div></div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChartCard, HBars, StatTile } from './SeoCharts';

// Live Google Search Console numbers for the SEO & Health tab — fetched from
// /api/admin/search-console (service-account access, see lib/search-console.ts).

type Metric = 'clicks' | 'impressions' | 'position';
interface Row { key: string; clicks: number; impressions: number; ctr: number; position: number }
interface Totals { clicks: number; impressions: number; ctr: number; position: number }
interface Report {
  status: 'ok';
  days: number; fetchedAt: string; site: string; permission: string;
  range: { startDate: string; endDate: string };
  totals: Totals; previous: Totals;
  daily: { date: string; clicks: number; impressions: number; position: number }[];
  queries: Row[]; pages: Row[]; countries: Row[]; devices: Row[];
  sitemaps: { path: string; lastSubmitted: string | null; lastDownloaded: string | null; pending: boolean; errors: number; warnings: number; submitted: number }[];
  homepage: { url: string; verdict: string; coverage: string; lastCrawl: string | null; canonical: string; robots: string; fetch: string } | null;
}
type Resp = Report | { status: 'not_configured' | 'auth_failed' | 'no_access' | 'api_error'; message?: string; serviceAccount?: string };

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');
const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`;
const pos1 = (n: number) => (n ? n.toFixed(1) : '—');
const day = (d: string, o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', ...o });
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const path = (u: string) => { try { const x = new URL(u); return x.pathname + x.search || '/'; } catch { return u; } };

/** "+12% vs previous 28 days"; for position, a lower number is the improvement. */
function delta(cur: number, prev: number, days: number, lowerIsBetter = false) {
  if (!prev) return <span className="muted">No data for the previous {days} days</span>;
  const change = lowerIsBetter ? prev - cur : ((cur - prev) / prev) * 100;
  const good = change > 0;
  const txt = lowerIsBetter ? `${good ? '▲' : change < 0 ? '▼' : ''} ${Math.abs(change).toFixed(1)} places` : `${good ? '▲' : change < 0 ? '▼' : ''} ${Math.abs(change).toFixed(0)}%`;
  return <span className={`gsc-delta ${change === 0 ? '' : good ? 'up' : 'down'}`}>{txt} <span className="muted">vs previous {days} days</span></span>;
}

export default function SearchConsolePanel() {
  const [days, setDays] = useState(28);
  const [d, setD] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<Metric>('clicks');
  const [tab, setTab] = useState<'queries' | 'pages'>('queries');

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
        {d?.status === 'ok' && <p className="muted">{d.site} · {day(d.range.startDate, { day: 'numeric', month: 'short', year: 'numeric' })} – {day(d.range.endDate, { day: 'numeric', month: 'short', year: 'numeric' })} · updated {when(d.fetchedAt)}</p>}
      </div>
      <div className="gsc-actions">
        <div className="viz-toggle" role="tablist" aria-label="Date range">
          {[7, 28, 90].map((n) => <button key={n} role="tab" aria-selected={days === n} className={days === n ? 'on' : ''} onClick={() => setDays(n)}>{n} days</button>)}
        </div>
        <button className="adm-btn ghost sm" onClick={() => load(true)} disabled={loading}><i className={`fas fa-rotate${loading ? ' fa-spin' : ''}`} /> Refresh</button>
      </div>
    </div>
  );

  if (!d) return <div className="viz">{head}<div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading Search Console…</p></div></div>;

  if (d.status !== 'ok') {
    const notSet = d.status === 'not_configured';
    return (
      <div className="viz">
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

  const t = d.totals, p = d.previous;
  const series = d.daily.map((x) => ({ date: x.date, value: x[metric] }));
  const rows = tab === 'queries' ? d.queries : d.pages;
  const ranked = (r: Row) => (r.position <= 3 ? 'top' : r.position <= 10 ? 'p1' : r.position <= 20 ? 'p2' : 'far');
  const buckets = [
    { label: 'Top 3', value: d.queries.filter((q) => q.position <= 3).length },
    { label: 'Position 4–10 (page 1)', value: d.queries.filter((q) => q.position > 3 && q.position <= 10).length },
    { label: 'Position 11–20 (page 2)', value: d.queries.filter((q) => q.position > 10 && q.position <= 20).length },
    { label: 'Beyond 20', value: d.queries.filter((q) => q.position > 20).length },
  ];
  const hp = d.homepage;
  const indexed = hp?.verdict === 'PASS';

  return (
    <div className="viz">
      {head}
      <div className="viz-tiles">
        <StatTile label="Total clicks" value={fmt(t.clicks)} note={delta(t.clicks, p.clicks, d.days)} />
        <StatTile label="Total impressions" value={fmt(t.impressions)} note={delta(t.impressions, p.impressions, d.days)} />
        <StatTile label="Average CTR" value={pct1(t.ctr)} note={delta(t.ctr, p.ctr, d.days)} />
        <StatTile label="Average position (ranking)" value={pos1(t.position)} note={delta(t.position, p.position, d.days, true)} />
      </div>

      <ChartCard
        title={`Daily ${metric === 'position' ? 'average position' : metric}`}
        subtitle={metric === 'position' ? 'Lower is better — 1 is the top of Google' : `From Google Search, last ${d.days} days`}
        table={{ head: ['Date', 'Clicks', 'Impressions', 'Avg position'], rows: d.daily.map((x) => [day(x.date, { day: 'numeric', month: 'short', year: 'numeric' }), fmt(x.clicks), fmt(x.impressions), pos1(x.position)]) }}
      >
        {(show, hide) => (
          <>
            <div className="viz-toggle gsc-metric" role="tablist" aria-label="Metric">
              {(['clicks', 'impressions', 'position'] as Metric[]).map((m) => <button key={m} role="tab" aria-selected={metric === m} className={metric === m ? 'on' : ''} onClick={() => setMetric(m)}>{m === 'position' ? 'Position' : m[0].toUpperCase() + m.slice(1)}</button>)}
            </div>
            <DailyBars data={series} metric={metric} show={show} hide={hide} />
          </>
        )}
      </ChartCard>

      <div className="adm-panel">
        <div className="adm-panel-head">
          <h3>{tab === 'queries' ? 'Top search queries — what people type on Google' : 'Top pages on Google'}</h3>
          <div className="viz-toggle" role="tablist">
            <button role="tab" aria-selected={tab === 'queries'} className={tab === 'queries' ? 'on' : ''} onClick={() => setTab('queries')}>Queries</button>
            <button role="tab" aria-selected={tab === 'pages'} className={tab === 'pages' ? 'on' : ''} onClick={() => setTab('pages')}>Pages</button>
          </div>
        </div>
        {rows.length ? (
          <div className="gsc-table-wrap">
            <table className="adm-table viz-table gsc-table">
              <thead><tr><th>{tab === 'queries' ? 'Query' : 'Page'}</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="gsc-key">{tab === 'pages' ? <a href={r.key} target="_blank" rel="noreferrer">{path(r.key)}</a> : r.key}</td>
                    <td>{fmt(r.clicks)}</td><td>{fmt(r.impressions)}</td><td>{pct1(r.ctr)}</td>
                    <td><span className={`gsc-pos ${ranked(r)}`}>{pos1(r.position)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">No search data for this period yet — new sites usually start showing data 2–4 days after verification.</p>}
      </div>

      <div className="viz-grid2">
        <ChartCard title="Where your queries rank" subtitle={`Top ${d.queries.length} queries by clicks, grouped by Google position`}
          table={{ head: ['Position', 'Queries'], rows: buckets.map((b) => [b.label, b.value]) }}>
          {(show, hide) => <HBars rows={buckets} max={Math.max(...buckets.map((b) => b.value), 1)} show={show} hide={hide} valueText={(v) => String(v)} tipLines={(r) => [`${r.value} quer${r.value === 1 ? 'y' : 'ies'}`]} />}
        </ChartCard>
        <ChartCard title="Clicks by country" subtitle="Top 10 countries"
          table={{ head: ['Country', 'Clicks', 'Impressions', 'Position'], rows: d.countries.map((c) => [c.key.toUpperCase(), fmt(c.clicks), fmt(c.impressions), pos1(c.position)]) }}>
          {(show, hide) => <HBars rows={d.countries.map((c) => ({ label: c.key.toUpperCase(), value: c.clicks }))} max={Math.max(...d.countries.map((c) => c.clicks), 1)} show={show} hide={hide} valueText={fmt}
            tipLines={(r) => { const c = d.countries.find((x) => x.key.toUpperCase() === r.label)!; return [`${fmt(c.clicks)} clicks`, `${fmt(c.impressions)} impressions`, `Avg position ${pos1(c.position)}`]; }} />}
        </ChartCard>
      </div>

      <div className="viz-grid2">
        <div className="adm-panel">
          <div className="adm-panel-head"><h3>Index &amp; sitemaps</h3></div>
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
        </div>
        <ChartCard title="Clicks by device" subtitle="Mobile vs desktop vs tablet"
          table={{ head: ['Device', 'Clicks', 'Impressions', 'CTR', 'Position'], rows: d.devices.map((x) => [x.key, fmt(x.clicks), fmt(x.impressions), pct1(x.ctr), pos1(x.position)]) }}>
          {(show, hide) => <HBars rows={d.devices.map((x) => ({ label: x.key[0] + x.key.slice(1).toLowerCase(), value: x.clicks }))} max={Math.max(...d.devices.map((x) => x.clicks), 1)} show={show} hide={hide} valueText={fmt}
            tipLines={(r) => [`${fmt(r.value)} clicks`]} />}
        </ChartCard>
      </div>
    </div>
  );
}

/* One bar per day; reuses the weekly-column styles from SeoCharts. */
function DailyBars({ data, metric, show, hide }: {
  data: { date: string; value: number }[]; metric: Metric;
  show: (e: React.PointerEvent, t: string, l: string[]) => void; hide: () => void;
}) {
  const max = Math.max(...data.map((x) => x.value), 0);
  const top = max <= 4 ? 4 : Math.ceil(max / Math.pow(10, Math.floor(Math.log10(max)))) * Math.pow(10, Math.floor(Math.log10(max)));
  const ticks = [top, top / 2, 0];
  const every = Math.ceil(data.length / 7);
  const val = (v: number) => (metric === 'position' ? pos1(v) : fmt(v));
  return (
    <div className="viz-cols-wrap">
      <div className="viz-yaxis" aria-hidden="true">{ticks.map((tk, i) => <span key={i} style={{ bottom: `${(tk / top) * 100}%` }}>{val(tk)}</span>)}</div>
      <div className="viz-cols">
        {ticks.map((tk, i) => <span key={i} className="viz-grid" style={{ bottom: `${(tk / top) * 100}%` }} />)}
        {data.map((x, i) => (
          <div className="viz-col" key={x.date}
            onPointerMove={(e) => show(e, day(x.date, { weekday: 'short', day: 'numeric', month: 'short' }), [metric === 'position' ? `Avg position ${pos1(x.value)}` : `${fmt(x.value)} ${metric}`])}
            onPointerLeave={hide}>
            <span className="viz-colbar" style={{ height: `${(x.value / top) * 100}%`, background: metric === 'impressions' ? '#2d6fa3' : metric === 'position' ? '#c98a2c' : undefined }} />
            <span className="viz-xlabel">{(data.length - 1 - i) % every === 0 ? day(x.date) : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

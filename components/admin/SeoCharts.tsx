'use client';

import { useRef, useState, type ReactNode } from 'react';

// Lightweight HTML/CSS charts for the SEO & Health tab (no chart library, so
// nothing extra to download). Conventions:
// - Thin bars (<= 18px) with a 4px rounded data-end, square at the baseline.
// - One hue for single-series magnitude; the map's own status colours for status
//   (validated: adjacent CVD ΔE >= 11). Text always uses text colours, never the
//   series colour, and every chart has a hover tooltip and a table view.

export const SERIES = '#2f7a3c';
export const STATUS_META: Record<string, { label: string; color: string }> = {
  available: { label: 'Available', color: '#2f7a3c' },
  construction: { label: 'Under construction', color: '#c98a2c' },
  upcoming: { label: 'Upcoming', color: '#3b6ea5' },
  sold: { label: 'Sold', color: '#b5484c' },
};
const fmt = (n: number) => n.toLocaleString('en-IN');
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

/* ---------- shared: card with Chart/Table toggle + tooltip ---------- */
type Tip = { x: number; y: number; title: string; lines: string[] } | null;

export function ChartCard({ title, subtitle, table, children, className = '' }: {
  title: string; subtitle?: string; table: { head: string[]; rows: (string | number)[][] };
  children: (show: (e: React.PointerEvent, title: string, lines: string[]) => void, hide: () => void) => ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [tip, setTip] = useState<Tip>(null);
  const ref = useRef<HTMLDivElement>(null);
  const show = (e: React.PointerEvent, t: string, lines: string[]) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, title: t, lines });
  };
  return (
    <section className={`adm-panel viz-card ${className}`}>
      <div className="viz-head">
        <div><h3>{title}</h3>{subtitle && <p className="muted">{subtitle}</p>}</div>
        <div className="viz-toggle" role="tablist" aria-label={`${title} view`}>
          <button role="tab" aria-selected={view === 'chart'} className={view === 'chart' ? 'on' : ''} onClick={() => setView('chart')}><i className="fas fa-chart-simple" /> Chart</button>
          <button role="tab" aria-selected={view === 'table'} className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}><i className="fas fa-table" /> Table</button>
        </div>
      </div>
      <div className="viz-body" ref={ref} onPointerLeave={() => setTip(null)}>
        {view === 'chart' ? children(show, () => setTip(null)) : (
          <table className="adm-table viz-table">
            <thead><tr>{table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
          </table>
        )}
        {tip && view === 'chart' && (
          <div className="viz-tip" style={{ left: tip.x, top: tip.y }} role="status">
            <b>{tip.title}</b>{tip.lines.map((l) => <span key={l}>{l}</span>)}
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------- KPI tiles ---------- */
export function StatTile({ label, value, note, meter }: { label: string; value: string; note?: ReactNode; meter?: number }) {
  return (
    <div className="viz-tile">
      <span className="viz-tile-label">{label}</span>
      <span className="viz-tile-value">{value}</span>
      {meter != null && (
        <span className="viz-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={meter} aria-label={label}>
          <span style={{ width: `${Math.max(0, Math.min(100, meter))}%` }} />
        </span>
      )}
      {note && <span className="viz-tile-note">{note}</span>}
    </div>
  );
}

/* ---------- horizontal bars (magnitude; one hue) ---------- */
export function HBars({ rows, max, unit, show, hide, valueText, tipLines, muted }: {
  rows: { label: string; value: number }[]; max: number; unit?: string;
  show: (e: React.PointerEvent, t: string, l: string[]) => void; hide: () => void;
  valueText: (v: number) => string; tipLines: (r: { label: string; value: number }) => string[];
  muted?: (label: string) => boolean;
}) {
  return (
    <div className="viz-hbars" role="list">
      {rows.map((r) => (
        <div className="viz-hrow" role="listitem" key={r.label}
          onPointerMove={(e) => show(e, r.label, tipLines(r))} onPointerLeave={hide}>
          <span className="viz-hlabel">{r.label}</span>
          <span className="viz-htrack">
            <span className="viz-hbar" style={{ width: `${max ? (r.value / max) * 100 : 0}%`, background: muted?.(r.label) ? '#b9b8b1' : SERIES }} />
            <span className="viz-hval">{valueText(r.value)}{unit || ''}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------- 100% stacked bar (part-to-whole by status) ---------- */
export function StatusStack({ data, show, hide }: {
  data: { key: string; count: number }[];
  show: (e: React.PointerEvent, t: string, l: string[]) => void; hide: () => void;
}) {
  const total = data.reduce((a, d) => a + d.count, 0);
  return (
    <div className="viz-stack-wrap">
      <div className="viz-stack" aria-hidden="true">
        {data.filter((d) => d.count > 0).map((d) => (
          <span key={d.key} className="viz-seg" style={{ flexGrow: d.count, background: STATUS_META[d.key]?.color }}
            onPointerMove={(e) => show(e, STATUS_META[d.key]?.label || d.key, [`${fmt(d.count)} projects`, `${pct(d.count, total)}% of the map`])}
            onPointerLeave={hide} />
        ))}
      </div>
      <ul className="viz-legend">
        {data.map((d) => (
          <li key={d.key}>
            <span className="viz-swatch" style={{ background: STATUS_META[d.key]?.color }} />
            <span className="viz-legend-label">{STATUS_META[d.key]?.label || d.key}</span>
            <b>{fmt(d.count)}</b><span className="muted">{pct(d.count, total)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- weekly columns (count over time; one series) ---------- */
export function WeekColumns({ data, show, hide, noun }: {
  data: { week: string; count: number }[]; noun: [string, string];
  show: (e: React.PointerEvent, t: string, l: string[]) => void; hide: () => void;
}) {
  const max = Math.max(...data.map((d) => d.count), 0);
  const top = niceMax(max);
  const ticks = [top, Math.round(top / 2), 0];
  const label = (w: string) => new Date(w + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const peak = data.reduce((m, d, i) => (d.count > (data[m]?.count ?? -1) ? i : m), 0);
  return (
    <div className="viz-cols-wrap">
      <div className="viz-yaxis" aria-hidden="true">{ticks.map((t, i) => <span key={i} style={{ bottom: `${top ? (t / top) * 100 : 0}%` }}>{fmt(t)}</span>)}</div>
      <div className="viz-cols">
        {ticks.map((t, i) => <span key={i} className="viz-grid" style={{ bottom: `${top ? (t / top) * 100 : 0}%` }} />)}
        {data.map((d, i) => (
          <div className="viz-col" key={d.week}
            onPointerMove={(e) => show(e, `Week of ${label(d.week)}`, [`${fmt(d.count)} ${d.count === 1 ? noun[0] : noun[1]}`])}
            onPointerLeave={hide}>
            <span className="viz-colbar" style={{ height: `${top ? (d.count / top) * 100 : 0}%` }}>
              {i === peak && d.count > 0 && <span className="viz-colval">{fmt(d.count)}</span>}
            </span>
            <span className="viz-xlabel">{i % 3 === data.length % 3 || i === data.length - 1 ? label(d.week) : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Rounds an axis maximum up to a clean, even number (4, 10, 20, 50, 100…) so the middle tick is whole. */
function niceMax(v: number) {
  if (v <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 5, 10]) if (m * p >= v && (m * p) % 2 === 0) return Math.round(m * p);
  return Math.ceil(v);
}

/* ---------- donut (part-to-whole at a glance; <= 6 slices) ---------- */
// Colour follows the category, never its rank. Types use the validated
// categorical order; anything unlisted folds into a neutral "Other".
export const TYPE_COLORS: Record<string, string> = {
  Residential: '#2a78d6', Commercial: '#eb6834', 'Mixed-Use': '#1baf7a', 'Land Parcel': '#eda100',
  Plotting: '#e87ba4', Amenity: '#008300', Other: '#9b9a94',
};

export function Donut({ slices, centerValue, centerLabel, show, hide }: {
  slices: { key: string; label: string; count: number; color: string }[];
  centerValue: string; centerLabel: string;
  show: (e: React.PointerEvent, t: string, l: string[]) => void; hide: () => void;
}) {
  const total = slices.reduce((a, s) => a + s.count, 0);
  const R = 78, W = 26, C = 100; // ring radius, thickness, centre (viewBox 200)
  const shown = slices.filter((s) => s.count > 0);
  const gap = shown.length > 1 ? 0.035 : 0; // radians of white gap between slices
  let a0 = -Math.PI / 2;
  const arc = (start: number, end: number) => {
    const large = end - start > Math.PI ? 1 : 0;
    const p = (a: number, r: number) => `${(C + r * Math.cos(a)).toFixed(2)} ${(C + r * Math.sin(a)).toFixed(2)}`;
    const ro = R + W / 2, ri = R - W / 2;
    return `M ${p(start, ro)} A ${ro} ${ro} 0 ${large} 1 ${p(end, ro)} L ${p(end, ri)} A ${ri} ${ri} 0 ${large} 0 ${p(start, ri)} Z`;
  };
  return (
    <div className="viz-donut-wrap">
      <svg className="viz-donut" viewBox="0 0 200 200" role="img" aria-label={`${centerLabel}: ${shown.map((s) => `${s.label} ${s.count}`).join(', ')}`}>
        {total === 0 && <circle cx={C} cy={C} r={R} fill="none" stroke="#ecebe5" strokeWidth={W} />}
        {shown.map((s) => {
          const span = (s.count / total) * Math.PI * 2;
          const start = a0 + gap / 2, end = a0 + span - gap / 2;
          a0 += span;
          const d = shown.length === 1 ? null : arc(start, Math.max(start + 0.001, end));
          const tip = (e: React.PointerEvent) => show(e, s.label, [`${fmt(s.count)} projects`, `${pct(s.count, total)}% of ${fmt(total)}`]);
          return d
            ? <path key={s.key} d={d} fill={s.color} className="viz-slice" onPointerMove={tip} onPointerLeave={hide} />
            : <circle key={s.key} cx={C} cy={C} r={R} fill="none" stroke={s.color} strokeWidth={W} className="viz-slice" onPointerMove={tip} onPointerLeave={hide} />;
        })}
        <text x={C} y={C - 2} textAnchor="middle" className="viz-donut-value">{centerValue}</text>
        <text x={C} y={C + 18} textAnchor="middle" className="viz-donut-label">{centerLabel}</text>
      </svg>
      <ul className="viz-legend viz-legend-col">
        {slices.map((s) => (
          <li key={s.key}>
            <span className="viz-swatch" style={{ background: s.color }} />
            <span className="viz-legend-label">{s.label}</span>
            <b>{fmt(s.count)}</b><span className="muted">{pct(s.count, total)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- day-by-day calendar heatmap (was anything created that day?) ---------- */
// One square per day (columns = weeks, rows = Mon→Sun). Grey = nothing that day;
// a validated one-hue green ramp for 1 / 2–3 / 4–9 / 10+.
const HEAT = ['#ebeae4', '#7fbf8e', '#4f9e60', '#2f7a3c', '#1d4f26'];
const heatStep = (n: number) => (n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 9 ? 3 : 4);
const dayFmt = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', ...opts });

export function dayStats(days: { date: string; count: number }[], today: string) {
  const active = days.filter((d) => d.count > 0);
  const todayCount = days.find((d) => d.date === today)?.count ?? 0;
  let streak = 0; // consecutive days with new projects, ending today (or yesterday if today is still empty)
  for (let i = days.length - 1 - (todayCount ? 0 : 1); i >= 0 && days[i].count > 0; i--) streak++;
  const busiest = active.reduce<{ date: string; count: number } | null>((m, d) => (!m || d.count > m.count ? d : m), null);
  const lastActive = active.length ? active[active.length - 1].date : null;
  return { activeDays: active.length, totalDays: days.length, todayCount, streak, busiest, lastActive };
}

export function DayHeatmap({ days, today, show, hide }: {
  days: { date: string; count: number }[]; today: string;
  show: (e: React.PointerEvent, t: string, l: string[]) => void; hide: () => void;
}) {
  // Columns of 7 (Mon..Sun); the last week may be partial (future days left blank).
  const weeks: ({ date: string; count: number } | null)[][] = [];
  days.forEach((d, i) => { if (i % 7 === 0) weeks.push([]); weeks[weeks.length - 1].push(d); });
  const last = weeks[weeks.length - 1];
  while (last && last.length < 7) last.push(null);
  const monthOf = (w: ({ date: string } | null)[]) => (w[0] ? dayFmt(w[0].date, { month: 'short' }) : '');
  return (
    <div className="viz-heat">
      <div className="viz-heat-days" aria-hidden="true"><span>Mon</span><span /><span>Wed</span><span /><span>Fri</span><span /><span>Sun</span></div>
      {/* On narrow screens the grid scrolls; start at the most recent weeks. */}
      <div className="viz-heat-scroll" ref={(el) => { if (el) el.scrollLeft = el.scrollWidth; }}>
        <div className="viz-heat-months" aria-hidden="true">
          {weeks.map((w, i) => <span key={i}>{i === 0 || monthOf(w) !== monthOf(weeks[i - 1]) ? monthOf(w) : ''}</span>)}
        </div>
        <div className="viz-heat-grid" role="img" aria-label="Projects created per day">
          {weeks.map((w, i) => (
            <div className="viz-heat-col" key={i}>
              {w.map((d, j) => d ? (
                <span key={j} className={`viz-heat-cell${d.date === today ? ' is-today' : ''}`} style={{ background: HEAT[heatStep(d.count)] }}
                  onPointerMove={(e) => show(e, dayFmt(d.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + (d.date === today ? ' (today)' : ''),
                    [d.count ? `${fmt(d.count)} project${d.count === 1 ? '' : 's'} created` : 'No projects created'])}
                  onPointerLeave={hide} />
              ) : <span key={j} className="viz-heat-cell is-future" />)}
            </div>
          ))}
        </div>
      </div>
      <div className="viz-heat-legend" aria-hidden="true">
        <span>None</span>{HEAT.map((c, i) => <i key={i} style={{ background: c }} />)}<span>More</span>
        <small>1 · 2–3 · 4–9 · 10+ per day</small>
      </div>
    </div>
  );
}

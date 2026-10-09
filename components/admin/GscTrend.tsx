'use client';

import { useEffect, useRef, useState } from 'react';

// Search Console–style performance chart: one line per selected metric, each on
// its own scale (clicks and impressions differ by 100×), with a hover crosshair
// listing every metric for that day. Position is drawn upside down — rank 1 at
// the top — so "up" always means "better", like Google's own chart.

export type GscMetric = 'clicks' | 'impressions' | 'ctr' | 'position';
export interface GscDay { date: string; clicks: number; impressions: number; ctr: number; position: number }
export const METRIC: Record<GscMetric, { label: string; color: string; fmt: (n: number) => string }> = {
  clicks: { label: 'Clicks', color: '#4285f4', fmt: (n) => Math.round(n).toLocaleString('en-IN') },
  impressions: { label: 'Impressions', color: '#5e35b1', fmt: (n) => Math.round(n).toLocaleString('en-IN') },
  ctr: { label: 'CTR', color: '#00897b', fmt: (n) => `${(n * 100).toFixed(1)}%` },
  position: { label: 'Position', color: '#e8710a', fmt: (n) => (n ? n.toFixed(1) : '—') },
};

const H = 260, PAD_T = 14, PAD_B = 28;
const dayLabel = (d: string, long = false) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', ...(long ? { weekday: 'short', year: 'numeric' } : {}) });

/** A round number at or above `v`, for a tidy top gridline. */
function niceTop(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v) || 10 * p;
}

export default function GscTrend({ data, metrics }: { data: GscDay[]; metrics: GscMetric[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 800));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const single = metrics.length === 1;
  const padL = single ? 46 : 12, padR = 12;
  const n = data.length;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (w - padL - padR));
  const plotH = H - PAD_T - PAD_B;

  // One scale per metric. Position: smallest rank at the top; days with no data (0) leave a gap.
  const scales = Object.fromEntries(metrics.map((m) => {
    const vals = data.map((d) => d[m]).filter((v) => (m === 'position' ? v > 0 : true));
    if (m === 'position') {
      const lo = Math.max(1, Math.floor(Math.min(...vals, 1))), hi = Math.ceil(Math.max(...vals, lo + 1));
      return [m, { lo, hi, y: (v: number) => PAD_T + ((v - lo) / (hi - lo || 1)) * plotH }];
    }
    const hi = niceTop(Math.max(...vals, 0));
    return [m, { lo: 0, hi, y: (v: number) => PAD_T + plotH - (v / hi) * plotH }];
  })) as Record<GscMetric, { lo: number; hi: number; y: (v: number) => number }>;

  const path = (m: GscMetric) => {
    let d = '', pen = false;
    data.forEach((p, i) => {
      if (m === 'position' && !p.position) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${scales[m].y(p[m]).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 90))));
  const ticks = [0, 0.5, 1];
  const s0 = single ? scales[metrics[0]] : null;

  const onMove = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || n === 0) return;
    const i = Math.round(((e.clientX - r.left - padL) / (w - padL - padR)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const h = hover != null ? data[hover] : null;

  return (
    <div className="gsc-trend" ref={box} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg width={w} height={H} role="img" aria-label={`Daily ${metrics.map((m) => METRIC[m].label.toLowerCase()).join(', ')} chart`}>
        {ticks.map((t) => {
          const y = PAD_T + plotH * t;
          const v = s0 ? (metrics[0] === 'position' ? s0.lo + (s0.hi - s0.lo) * t : s0.hi * (1 - t)) : 0;
          return (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={y} y2={y} className="gsc-grid" />
              {s0 && <text x={padL - 8} y={y + 4} textAnchor="end" className="gsc-axis">{METRIC[metrics[0]].fmt(v)}</text>}
            </g>
          );
        })}
        {data.map((p, i) => ((n - 1 - i) % every === 0
          ? <text key={p.date} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="gsc-axis">{dayLabel(p.date)}</text>
          : null))}
        {metrics.map((m) => <path key={m} d={path(m)} fill="none" stroke={METRIC[m].color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
        {h && hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + plotH} className="gsc-cross" />
            {metrics.map((m) => (m === 'position' && !h.position ? null
              : <circle key={m} cx={x(hover)} cy={scales[m].y(h[m])} r={4.5} fill="#fff" stroke={METRIC[m].color} strokeWidth={2.5} />))}
          </g>
        )}
      </svg>
      {h && hover != null && (
        <div className={`gsc-tip${x(hover) > w * 0.6 ? ' left' : ''}`} style={{ left: x(hover) }} role="status">
          <b>{dayLabel(h.date, true)}</b>
          {(['clicks', 'impressions', 'ctr', 'position'] as GscMetric[]).map((m) => (
            <span key={m} className={metrics.includes(m) ? '' : 'dim'}><i style={{ background: METRIC[m].color }} />{METRIC[m].label}<em>{METRIC[m].fmt(h[m])}</em></span>
          ))}
        </div>
      )}
    </div>
  );
}

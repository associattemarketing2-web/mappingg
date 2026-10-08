'use client';

import { useEffect, useRef, useState } from 'react';

// Visitors map for the Website traffic panel, drawn with Google Charts' GeoChart
// (the same map Google's own analytics consoles use). No API key needed: countries
// and states are drawn from ISO codes, cities from the lat/lng stored per visit.
//   country → world map shaded by visitors
//   region  → one country (India by default) shaded by state
//   city    → bubbles on each city, sized and coloured by visitors

declare global { interface Window { google?: any } }

export type GeoMapData =
  | { level: 'country'; rows: { code: string; name: string; visitors: number }[] }
  | { level: 'region'; country: string; rows: { code: string; name: string; visitors: number }[] }
  | { level: 'city'; country: string | null; rows: { name: string; place: string; lat: number; lng: number; visitors: number }[] };

let loading: Promise<any> | null = null;
function loadGeoChart(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  loading ??= new Promise((resolve, reject) => {
    const ready = () => window.google.charts.load('current', { packages: ['geochart'] }).then(() => resolve(window.google)).catch(reject);
    if (window.google?.charts) return ready();
    const s = document.createElement('script');
    s.src = 'https://www.gstatic.com/charts/loader.js';
    s.async = true;
    s.onload = ready;
    s.onerror = () => { loading = null; reject(new Error('Could not load the map')); };
    document.head.appendChild(s);
  });
  return loading;
}

const fmt = (n: number) => n.toLocaleString('en-IN');

/** `noun` names what is counted in tooltips: "3 visitors", "3 active users". */
/** `color` = [fewest, most] shades for the map; defaults to Google blue. */
export default function GeoMap({ data, noun = ['visitor', 'visitors'], color }: { data: GeoMapData; noun?: [string, string]; color?: [string, string] }) {
  const plural = (n: number) => `${fmt(n)} ${n === 1 ? noun[0] : noun[1]}`;
  const el = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');
  // Parent re-renders (tooltips, 30 s refresh) build a new object — only redraw when the numbers change.
  const key = JSON.stringify([data, noun, color]);

  useEffect(() => {
    let chart: any = null;
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    const draw = (google: any) => {
      if (cancelled || !el.current) return;
      const dt = new google.visualization.DataTable();
      const label = noun[1][0].toUpperCase() + noun[1].slice(1);
      // Google's analytics look: grey land, blue for people (light → dark with more of them).
      const opts: any = {
        backgroundColor: 'transparent',
        datalessRegionColor: '#e3e5e8',
        defaultColor: '#e3e5e8',
        colorAxis: { colors: color || (data.level === 'city' ? ['#4285f4', '#1a56c4'] : ['#c6dafc', '#1a73e8']) },
        legend: 'none',
        tooltip: { textStyle: { color: '#202124', fontSize: 12 }, showColorCode: false },
        keepAspectRatio: true,
        domain: 'IN', // show borders as recognised in India
      };
      if (data.level === 'country') {
        dt.addColumn('string', 'Country'); dt.addColumn('number', label);
        data.rows.forEach((r) => dt.addRow([{ v: r.code, f: r.name }, r.visitors]));
        Object.assign(opts, { region: 'world', resolution: 'countries' });
      } else if (data.level === 'region') {
        dt.addColumn('string', 'State'); dt.addColumn('number', label);
        data.rows.forEach((r) => dt.addRow([{ v: r.code, f: r.name }, r.visitors]));
        Object.assign(opts, { region: data.country, resolution: 'provinces' });
      } else {
        dt.addColumn('number', 'Lat'); dt.addColumn('number', 'Lng');
        dt.addColumn('number', 'Visitors'); dt.addColumn('number', 'Size');
        dt.addColumn({ type: 'string', role: 'tooltip' });
        data.rows.forEach((r) => dt.addRow([r.lat, r.lng, r.visitors, r.visitors, `${r.name}${r.place ? `, ${r.place}` : ''}\n${plural(r.visitors)}`]));
        Object.assign(opts, {
          displayMode: 'markers', region: data.country || 'world', resolution: data.country ? 'provinces' : 'countries',
          sizeAxis: { minSize: 5, maxSize: data.country ? 15 : 11 }, markerOpacity: 0.8,
        });
      }
      chart ??= new google.visualization.GeoChart(el.current);
      chart.draw(dt, opts);
    };
    loadGeoChart().then((google) => {
      if (cancelled) return;
      setErr('');
      draw(google);
      // GeoChart doesn't resize itself — redraw when the card changes width.
      let w = el.current?.clientWidth;
      ro = new ResizeObserver(() => { const nw = el.current?.clientWidth; if (nw && nw !== w) { w = nw; draw(google); } });
      if (el.current) ro.observe(el.current);
    }).catch((e) => !cancelled && setErr(e instanceof Error ? e.message : 'Could not load the map'));
    return () => { cancelled = true; ro?.disconnect(); chart?.clearChart?.(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="trf-map">
      {err ? <div className="adm-empty"><p>{err}</p></div> : <div ref={el} className="trf-map-canvas" role="img" aria-label="Map of where visitors are" />}
    </div>
  );
}

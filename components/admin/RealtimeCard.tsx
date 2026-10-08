'use client';

import { useState } from 'react';
import GeoMap, { type GeoMapData } from './GeoMap';

// "Realtime" card on the Website traffic panel, laid out like Google Analytics'
// realtime view: a map with a blue bubble on every city people are browsing
// from, and beside it the active-user count, a per-minute bar chart and the top
// countries / states / cities. Covers the last 30 minutes; the panel refreshes
// it every 30 seconds.

interface GeoCountry { code: string; name: string; visitors: number }
interface GeoRegion { code: string; countryCode: string; name: string; country: string; visitors: number }
interface GeoCity { name: string; region: string; country: string; countryCode: string; lat: number | null; lng: number | null; visitors: number }
export interface Realtime { visitors: number; perMinute: number[]; countries: GeoCountry[]; regions: GeoRegion[]; cities: GeoCity[] }

type Level = 'city' | 'region' | 'country';
type Zoom = 'IN' | 'world';
const LEVELS: [Level, string][] = [['city', 'City'], ['region', 'State'], ['country', 'Country']];
const fmt = (n: number) => n.toLocaleString('en-IN');
const users = (n: number) => `${fmt(n)} active user${n === 1 ? '' : 's'}`;

export default function RealtimeCard({ rt, activeNow }: { rt: Realtime; activeNow: number }) {
  const [level, setLevel] = useState<Level>('city');
  // India unless someone outside India is active — then the whole world, so nobody is off the map.
  const outside = rt.countries.some((c) => c.code !== 'IN');
  const [zoomPick, setZoom] = useState<Zoom | null>(null);
  const zoom: Zoom = zoomPick ?? (outside ? 'world' : 'IN');
  const [hover, setHover] = useState<number | null>(null);

  const mapData: GeoMapData = {
    level: 'city', country: zoom === 'IN' ? 'IN' : null,
    rows: rt.cities.flatMap((c) => (c.lat != null && c.lng != null && (zoom === 'world' || c.countryCode === 'IN')
      ? [{ name: c.name, place: c.countryCode === 'IN' ? c.region : `${c.region}, ${c.country}`, lat: c.lat, lng: c.lng, visitors: c.visitors }] : [])),
  };
  const rows = level === 'country'
    ? rt.countries.map((c) => ({ name: c.name, sub: '', value: c.visitors }))
    : level === 'region'
      ? rt.regions.map((r) => ({ name: r.name, sub: r.countryCode === 'IN' ? '' : r.country, value: r.visitors }))
      : rt.cities.map((c) => ({ name: c.name, sub: [c.region, c.countryCode === 'IN' ? '' : c.country].filter(Boolean).join(', '), value: c.visitors }));
  const maxRow = Math.max(...rows.map((r) => r.value), 1);
  const maxMin = Math.max(...rt.perMinute, 1);
  const mins = rt.perMinute.length;

  return (
    <section className="adm-panel rt-card" aria-label="Realtime visitors">
      <div className="rt-map-col">
        <div className="rt-map-head">
          <span className="rt-live"><span className="trf-dot" aria-hidden="true" /> Realtime</span>
          <div className="rt-seg" role="tablist" aria-label="Map area">
            {([['IN', 'India'], ['world', 'World']] as [Zoom, string][]).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={zoom === k} className={zoom === k ? 'on' : ''} onClick={() => setZoom(k)}>{l}</button>
            ))}
          </div>
        </div>
        <GeoMap data={mapData} noun={['active user', 'active users']} />
        {!mapData.rows.length && (
          <p className="rt-map-empty">{rt.visitors ? 'People are on the site, but their city isn’t known yet.' : 'Nobody has visited in the last 30 minutes. Blue dots appear here as people browse the site.'}</p>
        )}
      </div>

      <div className="rt-side">
        <div className="rt-kpi">
          <span className="rt-label">Active users in last 30 minutes</span>
          <span className="rt-big">{fmt(rt.visitors)}</span>
          <span className="rt-now"><span className="trf-dot" aria-hidden="true" /> {fmt(activeNow)} right now (last 5 min)</span>
        </div>

        <div className="rt-kpi">
          <span className="rt-label">Active users per minute</span>
          <div className="rt-bars" onPointerLeave={() => setHover(null)} role="img"
            aria-label={`Active users per minute over the last ${mins} minutes, most recent on the right`}>
            {rt.perMinute.map((v, i) => (
              <span key={i} className={`rt-bar${hover === i ? ' on' : ''}`} onPointerEnter={() => setHover(i)}>
                <span style={{ height: v ? `${Math.max(8, (v / maxMin) * 100)}%` : '2px' }} />
              </span>
            ))}
            {hover !== null && (
              <span className="rt-bar-tip" style={{ left: `${((hover + 0.5) / mins) * 100}%` }}>
                {mins - 1 - hover === 0 ? 'This minute' : `${mins - 1 - hover} min ago`}<b>{users(rt.perMinute[hover])}</b>
              </span>
            )}
          </div>
        </div>

        <div className="rt-table">
          <div className="rt-table-head">
            <div className="rt-seg" role="tablist" aria-label="Group by">
              {LEVELS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={level === k} className={level === k ? 'on' : ''} onClick={() => setLevel(k)}>{l}</button>)}
            </div>
            <span className="rt-label">Active users</span>
          </div>
          {rows.length ? (
            <ol className="rt-rows">
              {rows.map((r) => (
                <li key={`${r.name}|${r.sub}`} title={`${r.name}${r.sub ? `, ${r.sub}` : ''} — ${users(r.value)}`}>
                  <span className="rt-row-name">{r.name}{r.sub && <small>{r.sub}</small>}</span>
                  <span className="rt-row-val">{fmt(r.value)}</span>
                  <span className="rt-row-bar" style={{ width: `${(r.value / maxRow) * 100}%` }} aria-hidden="true" />
                </li>
              ))}
            </ol>
          ) : <p className="rt-none">No data yet</p>}
        </div>
      </div>
    </section>
  );
}

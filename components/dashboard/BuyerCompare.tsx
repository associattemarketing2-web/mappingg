'use client';

import { useEffect, useRef, useState } from 'react';

// "Compare projects" on a buyer's profile: the projects in their compare list
// (added with the Compare button on the live map's project cards, up to the
// limit /api/my/compare returns), side by side. Only details the public card
// shows are listed. Buyers can remove a project here.

interface CmpProject {
  id: string; number: number | null; title: string;
  developer: string; location: string; status: string; type: string; rera_number: string;
  configuration: string; sqft: string; price: string; possession_timeline: string; launch_date: string; key_usp: string;
}

const STATUS: Record<string, string> = {
  available: 'Available', under_construction: 'Under Construction', upcoming: 'Upcoming', sold: 'Sold',
};

const ROWS: { label: string; val: (p: CmpProject) => string }[] = [
  { label: 'Developer', val: (p) => p.developer },
  { label: 'Location', val: (p) => p.location },
  { label: 'Status', val: (p) => STATUS[p.status] || p.status },
  { label: 'Property type', val: (p) => p.type },
  { label: 'MahaRERA no.', val: (p) => p.rera_number },
  { label: 'Configuration', val: (p) => p.configuration },
  { label: 'Carpet area', val: (p) => p.sqft },
  { label: 'Starting price', val: (p) => p.price },
  { label: 'Possession / launch', val: (p) => (p.status === 'upcoming' ? (p.launch_date ? `Launching: ${p.launch_date}` : '') : p.possession_timeline) },
  { label: 'Key USP', val: (p) => p.key_usp },
];

const nameOf = (p: CmpProject) => `${p.title || 'Untitled project'}${p.number != null ? ` #${p.number}` : ''}`;

export default function BuyerCompare() {
  const [list, setList] = useState<CmpProject[] | null>(null);
  const [max, setMax] = useState(3);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    fetch('/api/my/compare?details=1', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((b) => {
        setList(Array.isArray(b?.projects) ? b.projects : []);
        if (b?.max) setMax(Number(b.max));
      })
      .catch(() => { setList([]); setMsg({ text: 'Could not load your compare list.', err: true }); });
  }, []);

  async function remove(id: string) {
    if (!list || busy.current) return;
    busy.current = true;
    const prev = list;
    const next = list.filter((p) => p.id !== id);
    setList(next); setMsg(null);
    try {
      const r = await fetch('/api/my/compare', {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pins: next.map((p) => p.id) }),
      });
      if (!r.ok) throw new Error();
      setMsg({ text: 'Removed from your compare list.' });
    } catch {
      setList(prev);
      setMsg({ text: 'Could not remove it — please try again.', err: true });
    } finally { busy.current = false; }
  }

  const rows = list ? ROWS.filter((row) => list.some((p) => row.val(p))) : [];

  return (
    <section className="bp-card bp-cmp" id="compare">
      <h2 className="bp-cmp-h">
        <span><i className="fas fa-scale-balanced" /> Compare projects</span>
        {list && <span className="bp-cmp-n">{list.length}/{max}</span>}
      </h2>

      {!list ? (
        <p className="bp-muted"><i className="fas fa-spinner fa-spin" /> Loading…</p>
      ) : !list.length ? (
        <div className="bp-cmp-empty">
          <p>Your compare list is empty. Open a project on the live map and tap <b>Compare</b> to add it — you can compare up to {max} projects side by side.</p>
          <a className="bp-btn primary" href="/map"><i className="fas fa-map-location-dot" /> Add projects from the map</a>
        </div>
      ) : (
        <>
          <div className="bp-cmp-scroll">
            <table className="bp-cmp-table" style={{ ['--cols' as string]: list.length }}>
              <thead>
                <tr>
                  <th scope="col" className="bp-cmp-lbl"><span className="sr-only">Detail</span></th>
                  {list.map((p) => (
                    <th scope="col" key={p.id}>
                      <span className="bp-cmp-name">{nameOf(p)}</span>
                      <span className="bp-cmp-acts">
                        <a href={`/map?pin=${encodeURIComponent(p.id)}`}><i className="fas fa-location-dot" /> Map</a>
                        <button type="button" onClick={() => remove(p.id)} aria-label={`Remove ${nameOf(p)} from compare`}>
                          <i className="fas fa-xmark" /> Remove
                        </button>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row" className="bp-cmp-lbl">{row.label}</th>
                    {list.map((p) => {
                      const v = row.val(p);
                      return <td key={p.id}>{v ? (row.label === 'Status' ? <span className={`bp-cmp-st s-${p.status}`}>{v}</span> : v) : <span className="bp-cmp-dash">—</span>}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.length < max && (
            <p className="bp-cmp-more">
              You can add {max - list.length} more project{max - list.length === 1 ? '' : 's'}. <a href="/map">Open the live map</a> and tap <b>Compare</b> on a project card.
            </p>
          )}
        </>
      )}
      {msg && <p className={`bp-msg${msg.err ? ' err' : ''}`} role="status">{msg.text}</p>}
    </section>
  );
}

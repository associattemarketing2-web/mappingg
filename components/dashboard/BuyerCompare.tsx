'use client';

import { Fragment, useEffect, useRef, useState } from 'react';

// "Compare projects" on a buyer's profile: the projects in their compare list
// (added with the Compare button on the live map's project cards, up to the
// limit /api/my/compare returns), side by side. Only details the public card
// shows are listed. Rows are grouped, the lowest starting price and earliest
// possession are flagged, and "Only differences" hides rows that match.
// Buyers can remove a project here.

interface CmpProject {
  id: string; number: number | null; title: string; slug: string; image: string;
  developer: string; location: string; status: string; type: string; rera_number: string;
  configuration: string; sqft: string; price: string; possession_timeline: string; launch_date: string; key_usp: string;
}

const STATUS: Record<string, string> = {
  available: 'Ready to move', under_construction: 'Under Construction', upcoming: 'Upcoming', sold: 'Sold out',
};

/** Starting price in lakhs ("₹1.25 Cr onwards" → 125, "85 Lakhs" → 85), or null. */
function priceLakhs(s: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(cr|crore|crores|l|lac|lacs|lakh|lakhs)\b/i.exec(s.replace(/,/g, ''));
  if (m) return parseFloat(m[1]) * (/^c/i.test(m[2]) ? 100 : 1);
  const n = /(\d{6,})/.exec(s.replace(/,/g, ''));
  return n ? Number(n[1]) / 1e5 : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** Possession as a sortable month index (ready to move = 0), or null if it can't be read. */
function possessionKey(p: CmpProject): number | null {
  if (p.status === 'upcoming' || p.status === 'sold') return null;
  if (p.status === 'available' || /ready/i.test(p.possession_timeline)) return 0;
  const s = p.possession_timeline.toLowerCase();
  const y = /(20\d{2})/.exec(s);
  if (!y) return null;
  const mi = MONTHS.findIndex((m) => s.includes(m));
  const q = /q([1-4])/.exec(s);
  const month = mi >= 0 ? mi : q ? (Number(q[1]) - 1) * 3 + 2 : 11;
  return Number(y[1]) * 12 + month;
}

/** Ids of the projects with the smallest key, when at least two are comparable and they differ. */
function best(list: CmpProject[], key: (p: CmpProject) => number | null): Set<string> {
  const vals = list.map((p) => ({ id: p.id, v: key(p) })).filter((x): x is { id: string; v: number } => x.v != null);
  if (vals.length < 2) return new Set();
  const min = Math.min(...vals.map((x) => x.v));
  if (vals.every((x) => x.v === min)) return new Set();
  return new Set(vals.filter((x) => x.v === min).map((x) => x.id));
}

interface Row { label: string; icon: string; val: (p: CmpProject) => string; best?: { ids: (l: CmpProject[]) => Set<string>; tag: string } }
const GROUPS: { title: string; rows: Row[] }[] = [
  { title: 'Price & size', rows: [
    { label: 'Starting price', icon: 'fa-indian-rupee-sign', val: (p) => p.price, best: { ids: (l) => best(l, (p) => (p.price ? priceLakhs(p.price) : null)), tag: 'Lowest price' } },
    { label: 'Configuration', icon: 'fa-bed', val: (p) => p.configuration },
    { label: 'Carpet area', icon: 'fa-ruler-combined', val: (p) => p.sqft },
  ] },
  { title: 'Status & timeline', rows: [
    { label: 'Status', icon: 'fa-signal', val: (p) => STATUS[p.status] || p.status },
    { label: 'Possession / launch', icon: 'fa-key', val: (p) => (p.status === 'upcoming' ? (p.launch_date ? `Launching ${p.launch_date}` : '') : p.possession_timeline), best: { ids: (l) => best(l, possessionKey), tag: 'Earliest' } },
  ] },
  { title: 'Project', rows: [
    { label: 'Developer', icon: 'fa-building', val: (p) => p.developer },
    { label: 'Location', icon: 'fa-location-dot', val: (p) => p.location },
    { label: 'Property type', icon: 'fa-house', val: (p) => p.type },
    { label: 'RERA no.', icon: 'fa-shield-halved', val: (p) => p.rera_number },
  ] },
  { title: 'Highlights', rows: [
    { label: 'Key USP', icon: 'fa-star', val: (p) => p.key_usp },
  ] },
];

const nameOf = (p: CmpProject) => `${p.title || 'Untitled project'}${p.number != null ? ` #${p.number}` : ''}`;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export default function BuyerCompare() {
  const [list, setList] = useState<CmpProject[] | null>(null);
  const [max, setMax] = useState(3);
  const [diffOnly, setDiffOnly] = useState(false);
  // Phones show only the compared projects (no label column, no empty slots),
  // so every column fits the card without scrolling.
  const [phone, setPhone] = useState(false);
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

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 680px)');
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
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

  const items = list || [];
  const canDiff = items.length > 1;
  const groups = GROUPS.map((g) => ({
    ...g,
    rows: g.rows.filter((row) => {
      const vals = items.map((p) => row.val(p));
      if (!vals.some(Boolean)) return false;
      return !(diffOnly && canDiff && new Set(vals.map(norm)).size === 1);
    }),
  })).filter((g) => g.rows.length);
  const free = Math.max(0, max - items.length);
  const slots = phone ? 0 : free;
  const cols = items.length + slots;
  const span = cols + (phone ? 0 : 1);

  return (
    <section className="bp-card bp-cmp" id="compare">
      <div className="bp-cmp-h">
        <h2><i className="fas fa-scale-balanced" /> Compare projects</h2>
        {list && <span className="bp-cmp-n">{items.length}/{max} added</span>}
        {canDiff && (
          <label className="bp-cmp-diff">
            <input type="checkbox" checked={diffOnly} onChange={(e) => setDiffOnly(e.target.checked)} />
            <span className="track" aria-hidden="true" /> Only differences
          </label>
        )}
      </div>

      {!list ? (
        <div className="bp-cmp-skel" aria-hidden="true"><span /><span /><span /></div>
      ) : !items.length ? (
        <div className="bp-cmp-empty">
          <span className="ic" aria-hidden="true"><i className="fas fa-scale-balanced" /></span>
          <div>
            <b>Compare up to {max} projects side by side</b>
            <p>Open a project on the live map and tap <b>Compare</b>. Price, configuration, possession and RERA will line up here so you can decide faster.</p>
          </div>
          <a className="bp-btn primary" href="/map"><i className="fas fa-map-location-dot" /> Add projects from the map</a>
        </div>
      ) : (
        <>
          <div className="bp-cmp-scroll">
            <table className="bp-cmp-table" style={{ ['--cols' as string]: cols }}>
              <thead>
                <tr>
                  {!phone && <th scope="col" className="bp-cmp-lbl"><span className="sr-only">Detail</span></th>}
                  {items.map((p) => (
                    <th scope="col" key={p.id} className="bp-cmp-head">
                      <div className="bp-cmp-pc">
                        <div className="bp-cmp-img">
                          {p.image
                            // eslint-disable-next-line @next/next/no-img-element -- optimized image via /api/media or the CDN; next/image is disabled site-wide
                            ? <img src={p.image} alt="" loading="lazy" />
                            : <span className="ph" aria-hidden="true"><i className="fas fa-building" /></span>}
                          {p.status && <span className={`bp-cmp-st s-${p.status}`}>{STATUS[p.status] || p.status}</span>}
                          <button type="button" className="bp-cmp-x" onClick={() => remove(p.id)} aria-label={`Remove ${nameOf(p)} from compare`} title="Remove">
                            <i className="fas fa-xmark" />
                          </button>
                        </div>
                        <span className="bp-cmp-name">{nameOf(p)}</span>
                        {(p.developer || p.location) && (
                          <span className="bp-cmp-sub">{[p.developer, p.location].filter(Boolean).join(' · ')}</span>
                        )}
                        <span className="bp-cmp-acts">
                          {p.slug && <a className="go" href={`/projects/${p.slug}`}>Details <i className="fas fa-arrow-right" /></a>}
                          <a href={`/map?pin=${encodeURIComponent(p.id)}`} aria-label={`${nameOf(p)} on the map`}><i className="fas fa-location-dot" /> Map</a>
                        </span>
                      </div>
                    </th>
                  ))}
                  {Array.from({ length: slots }, (_, i) => (
                    <th scope="col" key={`slot-${i}`} className="bp-cmp-head bp-cmp-slotcol">
                      <a className="bp-cmp-slot" href="/map">
                        <i className="fas fa-plus" />
                        <b>Add a project</b>
                        <small>Tap Compare on any project card on the map</small>
                      </a>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.title}>
                    <tr className="bp-cmp-grp"><th scope="colgroup" colSpan={span}><span>{g.title}</span></th></tr>
                    {g.rows.map((row) => {
                      const winners = row.best ? row.best.ids(items) : new Set<string>();
                      return (
                        <Fragment key={row.label}>
                          {phone && <tr className="bp-cmp-cap"><th scope="colgroup" colSpan={span}><i className={`fas ${row.icon}`} aria-hidden="true" /> {row.label}</th></tr>}
                          <tr className="bp-cmp-row">
                            {!phone && <th scope="row" className="bp-cmp-lbl">{row.label}</th>}
                            {items.map((p) => {
                              const v = row.val(p);
                              const win = winners.has(p.id);
                              return (
                                <td key={p.id} className={`${win ? 'win' : ''}${row.label === 'Key USP' ? ' usp' : ''}${row.label === 'Starting price' ? ' price' : ''}`}>
                                  {v ? (row.label === 'Status' ? <span className={`bp-cmp-st s-${p.status}`}>{v}</span> : v) : <span className="bp-cmp-dash">Not listed</span>}
                                  {win && <span className="bp-cmp-best"><i className="fas fa-circle-check" /> {row.best!.tag}</span>}
                                </td>
                              );
                            })}
                            {Array.from({ length: slots }, (_, i) => <td key={`slot-${i}`} className="bp-cmp-slotcol" />)}
                          </tr>
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))}
                {!groups.length && (
                  <tr><td colSpan={span} className="bp-cmp-same">These projects match on every listed detail.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {phone && free > 0 && (
            <a className="bp-cmp-addm" href="/map"><i className="fas fa-plus" /> Add {free} more project{free === 1 ? '' : 's'} from the map</a>
          )}
          <p className="bp-cmp-foot">
            <i className="fas fa-circle-info" /> Details as shown on each project&apos;s public card. Verify RERA numbers on MahaRERA before booking.
          </p>
        </>
      )}
      {msg && <p className={`bp-msg${msg.err ? ' err' : ''}`} role="status">{msg.text}</p>}
    </section>
  );
}

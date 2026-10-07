'use client';

import { useMemo, useRef, useState } from 'react';
import SignOutButton from './SignOutButton';

// An agent's favourite projects as a collection of cards (see
// app/dashboard/[role]/favorites/page.tsx). Each card opens the project on the
// live map or its project page, and can be removed from the collection.

export interface FavCard {
  id: string; number: number | null; title: string; slug: string; image: string;
  developer: string; location: string; status: string; type: string; rera: string;
  configuration: string; sqft: string; price: string; possession: string;
}

const STATUS: Record<string, string> = {
  available: 'Available', under_construction: 'Under Construction', upcoming: 'Upcoming', sold: 'Sold',
};
const nameOf = (c: FavCard) => c.title || `Project #${c.number ?? ''}`;
const initialsOf = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

export default function FavoriteCollection({ name, initial }: { name: string; initial: FavCard[] }) {
  const [cards, setCards] = useState(initial);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  // One save in flight at a time; removals made meanwhile are sent right after.
  const saving = useRef(false);
  const pending = useRef(false);
  const latest = useRef(initial.map((c) => c.id));

  async function save() {
    if (saving.current) { pending.current = true; return; }
    saving.current = true;
    try {
      const r = await fetch('/api/my/favorites', {
        method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pins: latest.current }),
      });
      if (!r.ok) throw new Error();
    } catch {
      setMsg({ text: 'Could not save — please refresh and try again.', err: true });
    } finally {
      saving.current = false;
      if (pending.current) { pending.current = false; void save(); }
    }
  }

  function remove(c: FavCard) {
    latest.current = latest.current.filter((id) => id !== c.id);
    setCards((list) => list.filter((x) => x.id !== c.id));
    setMsg({ text: `Removed ${nameOf(c)} from your favourites.` });
    void save();
  }

  const term = q.trim().toLowerCase();
  const shown = useMemo(
    () => (term ? cards.filter((c) => [c.title, c.location, c.developer, c.configuration, c.number != null ? `#${c.number}` : ''].some((x) => x.toLowerCase().includes(term))) : cards),
    [cards, term],
  );

  return (
    <div className="dsh bp">
      <header className="bp-top">
        <a className="bp-brand" href="/" aria-label="Mappingg home"><span className="mark" aria-hidden="true" /><b>Mappingg<em>.com</em></b></a>
        <div className="bp-top-actions">
          <a className="bp-btn primary" href="/map"><i className="fas fa-map-location-dot" /> <span className="bp-hide-sm">Back to live map</span></a>
          <a className="bp-btn ghost" href="/dashboard/agent" title="My profile" aria-label="My profile"><span className="fav-av">{initialsOf(name)}</span> <span className="bp-hide-sm">Profile</span></a>
          <SignOutButton className="bp-btn ghost" />
        </div>
      </header>

      <main className="bp-main fav-main">
        <section className="fav-head">
          <div>
            <h1><i className="fas fa-heart" aria-hidden="true" /> My favourite projects</h1>
            <p>{cards.length ? `${cards.length} project${cards.length === 1 ? '' : 's'} saved` : 'Your collection is empty'} · tap the ♡ on any project card on the live map to add it here.</p>
          </div>
          {cards.length > 3 && (
            <label className="fav-search">
              <i className="fas fa-magnifying-glass" aria-hidden="true" />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your favourites…" aria-label="Search your favourite projects" />
            </label>
          )}
        </section>

        {msg && <p className={`bp-msg${msg.err ? ' err' : ''}`} role="status">{msg.text}</p>}

        {!cards.length ? (
          <section className="fav-empty">
            <span className="ic"><i className="far fa-heart" aria-hidden="true" /></span>
            <h2>No favourite projects yet</h2>
            <p>Open the live map, tap a project and press the ♡ on its card. It will show up here so you can find it again and share it with clients.</p>
            <a className="bp-btn primary" href="/map"><i className="fas fa-map-location-dot" /> Open the live map</a>
          </section>
        ) : !shown.length ? (
          <p className="bp-muted">No favourites match “{q.trim()}”.</p>
        ) : (
          <ul className="fav-grid">
            {shown.map((c) => {
              const rows = [
                ['Configuration', c.configuration],
                ['Carpet area', c.sqft],
                ['Starting price', c.price],
                ['Possession', c.possession],
                ['MahaRERA no.', c.rera],
              ].filter(([, v]) => v);
              return (
                <li key={c.id} className="fav-card">
                  <div className="fav-media">
                    {c.image
                      // eslint-disable-next-line @next/next/no-img-element -- optimized image via /api/media or the CDN; next/image is disabled site-wide
                      ? <img src={c.image} alt="" loading="lazy" />
                      : <span className="fav-noimg"><i className="fas fa-building" aria-hidden="true" /></span>}
                    {c.status && <span className={`fav-st s-${c.status}`}>{STATUS[c.status] || c.status}</span>}
                    <button type="button" className="fav-heart" onClick={() => remove(c)} aria-label={`Remove ${nameOf(c)} from favourites`} title="Remove from favourites">
                      <i className="fas fa-heart" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="fav-body">
                    <h2>{nameOf(c)}</h2>
                    <p className="fav-sub">{[c.location, c.developer].filter(Boolean).join(' · ') || '—'}</p>
                    {c.type && <span className="fav-type">{c.type}</span>}
                    {rows.length > 0 && (
                      <dl>
                        {rows.map(([k, v]) => (
                          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                        ))}
                      </dl>
                    )}
                    <div className="fav-actions">
                      <a className="bp-btn primary" href={`/map?pin=${encodeURIComponent(c.id)}`}><i className="fas fa-location-dot" /> View on map</a>
                      <a className="bp-btn ghost" href={`/projects/${c.slug}`}><i className="fas fa-circle-info" /> Details</a>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}

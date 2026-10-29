'use client';

import { useCallback, useEffect, useState } from 'react';
import HomeProjectCard from './HomeProjectCard';
import Carousel from './Carousel';
import type { NearbyResult } from '@/lib/home/nearby';
import type { LocalityOption } from '@/lib/home/nearby';

// "Projects near you" on the home page.
//
// Location is only requested when the visitor taps "Use my location" (or when
// they already granted it to this site before, which the browser reports
// without prompting). Coordinates go to /api/nearby once, rounded, and are
// never stored; the only thing remembered on this device is a locality the
// visitor picked by hand. Nothing here blocks the rest of the page.

type State =
  | { k: 'idle'; note?: string }
  | { k: 'loading' }
  | { k: 'ready'; data: NearbyResult; picked?: string }
  | { k: 'empty'; picked?: string }
  | { k: 'error'; retry: () => void };

const SAVED = 'mg-near-locality';
const read = () => { try { return localStorage.getItem(SAVED) || ''; } catch { return ''; } };
const save = (v: string) => { try { if (v) localStorage.setItem(SAVED, v); else localStorage.removeItem(SAVED); } catch { /* private mode */ } };

export default function NearbyProjects({ localities }: { localities: LocalityOption[] }) {
  const [state, setState] = useState<State>({ k: 'idle' });
  const [canLocate, setCanLocate] = useState(false);
  const [choice, setChoice] = useState('');

  const load = useCallback(async (query: string, picked?: string) => {
    setState({ k: 'loading' });
    try {
      const r = await fetch(`/api/nearby?${query}`, { credentials: 'omit' });
      if (r.status === 404) { save(''); setState({ k: 'idle' }); return; }
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as NearbyResult;
      setState(data.projects.length ? { k: 'ready', data, picked } : { k: 'empty', picked });
    } catch {
      setState({ k: 'error', retry: () => load(query, picked) });
    }
  }, []);

  const pickLocality = useCallback((slug: string) => {
    setChoice(slug);
    if (!slug) return;
    save(slug);
    const label = localities.find((l) => l.slug === slug)?.label;
    load(`locality=${encodeURIComponent(slug)}`, label);
  }, [load, localities]);

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) { setState({ k: 'idle', note: 'Your browser can’t share its location — pick a locality instead.' }); return; }
    setState({ k: 'loading' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        save(''); setChoice('');
        load(`lat=${pos.coords.latitude.toFixed(3)}&lng=${pos.coords.longitude.toFixed(3)}`);
      },
      (err) => setState({
        k: 'idle',
        note: err.code === err.PERMISSION_DENIED
          ? 'Location access is turned off for this site. Pick a locality instead, or allow location in your browser settings.'
          : 'We couldn’t get your location just now. Try again, or pick a locality.',
      }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 },
    );
  }, [load]);

  // First visit: nothing happens until the visitor asks. Return visits: reuse the
  // locality they picked, or their location if they already allowed it here.
  useEffect(() => {
    setCanLocate(window.isSecureContext && 'geolocation' in navigator);
    const saved = read();
    if (saved && localities.some((l) => l.slug === saved)) { pickLocality(saved); return; }
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    perms?.query({ name: 'geolocation' as PermissionName }).then((p) => { if (p.state === 'granted') locate(); }).catch(() => {});
  }, [localities, locate, pickLocality]);

  const picker = (
    <div className="hf-near-pick">
      {canLocate && (
        <button type="button" className="hf-btn hf-btn-solid" onClick={locate} disabled={state.k === 'loading'}>
          <i className="fas fa-location-crosshairs" aria-hidden="true" /> Use my location
        </button>
      )}
      <label className="hf-select">
        <span className="sr-only">Choose a locality</span>
        <select value={choice} onChange={(e) => pickLocality(e.target.value)}>
          <option value="">{canLocate ? 'or choose a locality…' : 'Choose a locality…'}</option>
          {['Pune', 'Mumbai'].map((city) => {
            const opts = localities.filter((l) => l.city === city);
            return opts.length ? (
              <optgroup key={city} label={city}>
                {opts.map((l) => <option key={l.slug} value={l.slug}>{l.label} ({l.count})</option>)}
              </optgroup>
            ) : null;
          })}
          {localities.some((l) => l.city !== 'Pune' && l.city !== 'Mumbai') && (
            <optgroup label="Other cities">
              {localities.filter((l) => l.city !== 'Pune' && l.city !== 'Mumbai').map((l) => (
                <option key={l.slug} value={l.slug}>{l.label}, {l.city} ({l.count})</option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
    </div>
  );

  let title = 'Projects near you';
  let sub = 'Use your location or pick a locality. We don’t store your location.';
  if (state.k === 'ready') {
    const a = state.data.area;
    if (state.picked) {
      title = `Projects in and around ${state.picked}`;
      sub = 'Closest first.';
    } else if (a?.locality) {
      title = `Projects near ${a.locality}${a.city ? `, ${a.city}` : ''}`;
      sub = 'Closest to your location first.';
    } else {
      sub = `Closest to your location first${a?.city ? ` · ${a.city}` : ''}.`;
    }
  }

  return (
    <section className="hf-sec" id="near-you" aria-labelledby="hf-near-title">
      <div className="hf-head">
        <div>
          <h2 id="hf-near-title">{title}</h2>
          <p>{sub}</p>
        </div>
      </div>

      {(state.k === 'idle' || state.k === 'ready' || state.k === 'empty') && picker}
      {state.k === 'idle' && state.note && <p className="hf-note" role="status">{state.note}</p>}

      {state.k === 'loading' && (
        <div className="hf-track" aria-busy="true" aria-label="Loading nearby projects">
          {[0, 1, 2, 3].map((i) => <div key={i} className="hf-slide"><div className="hf-card hf-skel" aria-hidden="true"><span /><span /><span /></div></div>)}
        </div>
      )}

      {state.k === 'error' && (
        <div className="hf-empty" role="alert">
          <p>We couldn’t load nearby projects. Check your connection and try again.</p>
          <button type="button" className="hf-btn hf-btn-solid" onClick={state.retry}>Try again</button>
        </div>
      )}

      {state.k === 'empty' && (
        <div className="hf-empty" role="status">
          <p>We haven’t mapped residential projects within 25 km{state.picked ? ` of ${state.picked}` : ' of you'} yet. Try another locality, or browse <a href="/projects">all projects</a>.</p>
        </div>
      )}

      {state.k === 'ready' && (
        <Carousel label={title}>
          {state.data.projects.map((p) => (
            <HomeProjectCard key={p.number} card={p} distanceKm={state.picked ? undefined : p.distanceKm} />
          ))}
        </Carousel>
      )}
    </section>
  );
}

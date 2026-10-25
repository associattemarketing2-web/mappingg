'use client';

import { useEffect, useRef, useState } from 'react';

// The Overview's "Interactive Project Map" is the original live map (/map) —
// the same page visitors use, embedded the way the home page embeds it — so it
// looks and works exactly like the real thing (pins, logos, legend, search,
// satellite, Near Me, project cards). The super admin is signed in, so the map
// shows everything without the guest sign-in prompt.

export interface ProjectHit {
  id: string; lat: number; lng: number; title: string; status?: string;
  propertyType?: string; developer?: string; locality?: string;
}

// Every public project once (light fields only) — used by the top-bar search.
let indexP: Promise<ProjectHit[]> | null = null;
export function loadProjectIndex(): Promise<ProjectHit[]> {
  indexP ??= fetch('/api/map/pins?north=90&south=-90&east=180&west=-180&limit=2000', { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((b) => (Array.isArray(b?.pins) ? b.pins : []))
    .catch(() => { indexP = null; return []; });
  return indexP;
}

export function matchProjects(list: ProjectHit[], q: string, max = 6): ProjectHit[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  return list.filter((p) => [p.title, p.developer, p.locality].some((v) => v && v.toLowerCase().includes(t))).slice(0, max);
}

export default function OverviewMap({ onOpenEditor }: { onOpenEditor?: () => void }) {
  const boxRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [full, setFull] = useState(false);
  // Bumped by "Reload" so the map fetches the latest projects.
  const [rev, setRev] = useState(0);

  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === boxRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else boxRef.current?.requestFullscreen?.().catch(() => {});
  }

  return (
    <section className={`ov-card ov-map${full ? ' is-full' : ''}`} ref={boxRef}>
      <div className="ov-card-head">
        <h3><i className="fas fa-map" /> Interactive Project Map</h3>
        <div className="ov-map-tools">
          {onOpenEditor && (
            <button type="button" className="ov-chip-btn" onClick={onOpenEditor} title="Add or edit pins, infrastructure and roads">
              <i className="fas fa-pen-to-square" /> Map Editor
            </button>
          )}
          <button type="button" className="ov-icon-btn" onClick={() => { setLoaded(false); setRev((n) => n + 1); }} title="Reload the map" aria-label="Reload the map">
            <i className="fas fa-rotate" />
          </button>
          <a className="ov-icon-btn" href="/map" target="_blank" rel="noopener" title="Open the live map in a new tab" aria-label="Open the live map in a new tab">
            <i className="fas fa-arrow-up-right-from-square" />
          </a>
          <button type="button" className="ov-icon-btn" onClick={toggleFull} title={full ? 'Exit full screen' : 'Full screen'} aria-label="Full screen">
            <i className={`fas ${full ? 'fa-compress' : 'fa-expand'}`} />
          </button>
        </div>
      </div>
      <div className="ov-map-canvas ov-live">
        {!loaded && <div className="ov-map-err"><i className="fas fa-spinner fa-spin" /> Loading the live map…</div>}
        <iframe
          key={rev}
          ref={frameRef}
          src="/map"
          title="Mappingg live project map"
          className="ov-live-frame"
          loading="lazy"
          allow="geolocation; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setLoaded(true)}
        />
      </div>
    </section>
  );
}

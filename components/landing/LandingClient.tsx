'use client';

import { useEffect } from 'react';

// Boots the landing page behaviour. Loads three.js (for the hero globe) once,
// then runs /landing.js which wires up the nav, reveal-on-scroll, interactive
// sample map, live-map trial and the auth modal.
//
// Crucially, landing.js is RE-RUN on every mount. The landing markup is
// server-rendered HTML that React rebuilds on each client-side navigation back
// to "/", so its event handlers and reveal-on-scroll observers must be re-wired
// against the fresh DOM — otherwise the sections below the hero stay hidden and
// interactions go dead. The script tears down its previous run (window listeners
// + globe animation loop) at the top, so re-running never leaks or double-binds.
export default function LandingClient() {
  useEffect(() => {
    // Load an external script once; wait for an in-flight tag if present.
    function loadOnce(src: string, marker: string): Promise<void> {
      return new Promise((resolve) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[${marker}]`);
        if (existing) {
          if (existing.dataset.done) return resolve();
          existing.addEventListener('load', () => resolve());
          existing.addEventListener('error', () => resolve());
          return;
        }
        const el = document.createElement('script');
        el.src = src;
        el.setAttribute(marker, '');
        const done = () => { el.dataset.done = '1'; resolve(); };
        el.onload = done;
        el.onerror = done; // degrade gracefully — the globe simply won't render
        document.body.appendChild(el);
      });
    }

    // Append a fresh <script> for landing.js so the browser re-executes it
    // (inserting a new script element always re-runs it, even from cache).
    function runLanding(): Promise<void> {
      return new Promise((resolve) => {
        document.querySelectorAll('script[data-mpg-landing]').forEach((s) => s.remove());
        const el = document.createElement('script');
        el.src = '/landing.js';
        el.setAttribute('data-mpg-landing', '');
        el.onload = () => resolve();
        el.onerror = () => resolve();
        document.body.appendChild(el);
      });
    }

    let cancelled = false;
    type GlobeWindow = { __mpgStartGlobe?: () => void };
    // The page's behaviour (nav, sign-in modal, scroll reveals) wires up at once;
    // three.js (~600 KB, only for the decorative hero globe) downloads in
    // parallel and starts the globe when it arrives. A failure to load it just
    // leaves the globe's project counts without the 3D sphere.
    const landing = runLanding();
    // Start the download once the browser is idle (first paint and the page's
    // own scripts come first), with a deadline so the globe never waits long.
    // Visitors who asked their device for less motion or less data skip the
    // ~600 KB 3D globe entirely; they still get its project-count overlay.
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    const skipGlobe = window.matchMedia('(prefers-reduced-motion: reduce)').matches || !!nav.connection?.saveData;
    const three = new Promise<void>((resolve) => {
      if (skipGlobe) return resolve();
      const go = () => { if (cancelled) resolve(); else loadOnce('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', 'data-mpg-three').then(resolve); };
      const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
      if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(go, { timeout: 2500 });
      else go();
    });
    Promise.all([landing, three]).then(() => {
      if (cancelled) return;
      const w = window as unknown as GlobeWindow;
      const start = w.__mpgStartGlobe;
      w.__mpgStartGlobe = undefined;
      if (typeof start === 'function') start();
    });

    return () => {
      cancelled = true;
      // Stop the globe animation + release listeners when leaving the page.
      const w = window as unknown as { __mpgCleanup?: () => void };
      if (typeof w.__mpgCleanup === 'function') w.__mpgCleanup();
    };
  }, []);

  return null;
}

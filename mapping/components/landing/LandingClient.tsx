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
    (async () => {
      // three.js powers only the decorative hero globe; awaited so it exists
      // first, but a failure never blocks the rest of the page.
      await loadOnce(
        'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
        'data-mpg-three',
      );
      if (cancelled) return;
      await runLanding();
    })();

    return () => {
      cancelled = true;
      // Stop the globe animation + release listeners when leaving the page.
      const w = window as unknown as { __mpgCleanup?: () => void };
      if (typeof w.__mpgCleanup === 'function') w.__mpgCleanup();
    };
  }, []);

  return null;
}

'use client';

import { useEffect, useRef, useState } from 'react';

interface Bundle {
  slug: string;
  headLinks: string[];
  styles: string;
  scripts: Array<{ type: 'ext'; src: string; async?: boolean } | { type: 'inline'; code: string }>;
  bodyHtml: string;
}

// Boots one of the original standalone map apps inside the Next.js document.
// Runs in the parent document (not an iframe) so window.location — and thus the
// ?pin=<id> share links and URL state — behave exactly as before, and so the
// page keeps the server-rendered SEO <head> from the route's metadata.
export default function LegacyApp({ slug }: { slug: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bootedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (bootedRef.current) return; // guard against React strict-mode double run
    bootedRef.current = true;

    // NOTE: we intentionally do NOT abort the boot on effect cleanup. Under React
    // Strict Mode the effect mounts → unmounts → remounts; the remount is blocked
    // by bootedRef, so aborting on the first cleanup would cancel the only boot.
    // This is a full-page app component that lives for the page's lifetime.

    async function loadExternal(src: string): Promise<void> {
      return new Promise((resolve) => {
        // Avoid loading the same library twice across client navigations.
        if (document.querySelector(`script[data-legacy-src="${CSS.escape(src)}"]`)) return resolve();
        const el = document.createElement('script');
        el.src = src;
        el.setAttribute('data-legacy-src', src);
        el.onload = () => resolve();
        el.onerror = () => resolve(); // non-blocking; app degrades gracefully
        document.head.appendChild(el);
      });
    }

    function runInline(code: string) {
      const el = document.createElement('script');
      el.textContent = code;
      document.body.appendChild(el);
    }

    async function boot() {
      try {
        // Fetch the app bundle through the browser's HTTP cache (revalidating,
        // not `no-store`). The bundle is a static file served with an ETag, so a
        // repeat visit sends a conditional request and gets a tiny 304 instead of
        // re-downloading the whole ~150KB payload — the single biggest repeat-load
        // win — while a changed bundle (new deploy) is still picked up immediately.
        // Our service worker stays network-first on top of this, so it never
        // serves stale content either.
        const res = await fetch(`/legacy/${slug}.json`, { cache: 'default' });
        if (!res.ok) throw new Error(`Failed to load app bundle (${res.status})`);
        const bundle: Bundle = await res.json();

        // 1) stylesheet links
        for (const href of bundle.headLinks) {
          if (document.querySelector(`link[data-legacy-href="${CSS.escape(href)}"]`)) continue;
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = href;
          link.setAttribute('data-legacy-href', href);
          document.head.appendChild(link);
        }

        // 2) inline styles
        if (bundle.styles && !document.querySelector(`style[data-legacy-style="${slug}"]`)) {
          const style = document.createElement('style');
          style.setAttribute('data-legacy-style', slug);
          style.textContent = bundle.styles;
          document.head.appendChild(style);
        }

        // 3) body markup
        if (containerRef.current) containerRef.current.innerHTML = bundle.bodyHtml;

        // 4) scripts, in original document order. External non-async scripts are
        //    awaited so libraries (Leaflet/MapLibre/shim) exist before app code;
        //    async ones (e.g. Google Maps) are fire-and-forget with a callback.
        for (const s of bundle.scripts) {
          if (s.type === 'ext') {
            if (s.async) loadExternal(s.src);
            else await loadExternal(s.src);
          } else {
            runInline(s.code);
          }
        }

        // 5) fire lifecycle events some UI positioning code listens for.
        document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
        window.dispatchEvent(new Event('load'));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load the map.');
      }
    }

    boot();
  }, [slug]);

  if (error) {
    return (
      <div role="alert" style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: 18 }}>Couldn’t load the map</h1>
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  // display:contents so the injected markup behaves as if it were a direct
  // child of <body> — preserving the original fixed/absolute positioning.
  return <div ref={containerRef} data-legacy-root={slug} style={{ display: 'contents' }} suppressHydrationWarning />;
}

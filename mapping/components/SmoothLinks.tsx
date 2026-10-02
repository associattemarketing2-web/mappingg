'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Turns every internal <a> click into a client-side navigation (no full page
// reload) — including the anchors inside the server-rendered landing markup,
// which can't be Next <Link> components. External links, new-tab links,
// downloads, modified clicks and same-page hashes are left to the browser, and
// anything another handler already handled (e.preventDefault) is skipped.
export default function SmoothLinks() {
  const router = useRouter();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement)?.closest?.('a');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      if (a.target === '_blank' || a.hasAttribute('download') || a.getAttribute('rel')?.includes('external')) return;

      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return; // external site

      // Same page: let hash links scroll natively; block bare "#" jumps.
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        if (!url.hash || url.hash === '#') e.preventDefault();
        return;
      }

      e.preventDefault();
      router.push(url.pathname + url.search + url.hash);
    }

    // Raw-HTML anchors (the landing markup) don't get <Link>'s automatic
    // prefetching, so warm the route as soon as the user shows intent — hover,
    // keyboard focus or the start of a tap — and the click then feels instant.
    const prefetched = new Set<string>();
    function onIntent(e: Event) {
      const a = (e.target as HTMLElement)?.closest?.('a');
      if (!a || a.target === '_blank') return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (url.pathname.startsWith('/api/') || prefetched.has(url.pathname)) return;
      prefetched.add(url.pathname);
      router.prefetch(url.pathname);
    }

    document.addEventListener('click', onClick);
    document.addEventListener('mouseover', onIntent, { passive: true });
    document.addEventListener('focusin', onIntent);
    document.addEventListener('touchstart', onIntent, { passive: true });
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('mouseover', onIntent);
      document.removeEventListener('focusin', onIntent);
      document.removeEventListener('touchstart', onIntent);
    };
  }, [router]);

  return null;
}

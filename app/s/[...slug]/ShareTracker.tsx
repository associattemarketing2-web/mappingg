'use client';

import { useEffect } from 'react';

// Tells the server this person opened the share page, and which file they
// opened / downloaded (any element with data-track="<item id>"). Runs in the
// browser only, so WhatsApp's link-preview crawler is never counted as an open.
export default function ShareTracker({ code, token }: { code: string; token: string }) {
  useEffect(() => {
    const send = (e: 'open' | 'click', i = '') => {
      const body = JSON.stringify({ c: code, t: token, e, i });
      try {
        if (navigator.sendBeacon && navigator.sendBeacon('/api/s/track', new Blob([body], { type: 'text/plain' }))) return;
      } catch { /* fall back to fetch */ }
      fetch('/api/s/track', { method: 'POST', body, keepalive: true }).catch(() => {});
    };
    send('open');
    const onClick = (ev: MouseEvent) => {
      const el = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-track]');
      if (el) send('click', el.dataset.track || '');
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [code, token]);
  return null;
}

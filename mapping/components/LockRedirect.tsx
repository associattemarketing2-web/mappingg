'use client';

import { useEffect } from 'react';

// "Lock to a panel": when an admin taps "Lock to this panel" inside /s-admin,
// we remember it in localStorage on THIS device. Then, when the site is opened
// as an INSTALLED app (PWA, display-mode: standalone), it jumps straight to that
// panel instead of the public home page.
//
// It never redirects in a normal browser tab, so the public site keeps working
// for everyone else; the lock is per-device and cleared from the same menu.
export default function LockRedirect() {
  useEffect(() => {
    try {
      const panel = localStorage.getItem('mg_lock_panel');
      if (!panel || !/^\/(?!\/)/.test(panel)) return;

      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        // iOS Safari exposes this non-standard flag for installed web apps.
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      if (!standalone) return;

      const p = window.location.pathname;
      // Already in the locked panel, or on the sign-in page → leave it be.
      if (p === panel || p.startsWith(panel + '/') || p.startsWith('/signin')) return;

      window.location.replace(panel);
    } catch {
      /* localStorage blocked — ignore, site works normally */
    }
  }, []);

  return null;
}

'use client';

import { useEffect } from 'react';

// Registers the service worker so the app is installable and works offline.
// Registration is deferred to window 'load' so it never competes with the map
// booting. Runs in production; in dev it registers too (Chrome allows install
// on http://localhost).
export default function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        /* ignore — the app works fine without the SW, just not installable/offline */
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}

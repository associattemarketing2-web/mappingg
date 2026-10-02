/* Mappingg service worker — enables PWA install + basic offline support.
 * Strategy: NETWORK-FIRST for pages and app bundles (so content is never stale),
 * falling back to cache when offline. API/auth/db requests are never cached. */
const CACHE = 'mappingg-v2';
const APP_SHELL = ['/', '/map', '/mundhwa-map-3d', '/db-shim.js', '/landing.js', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL).catch(() => {})));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

function isCacheable(url) {
  if (url.origin !== self.location.origin) return false;
  // Never cache dynamic/private endpoints.
  if (url.pathname.startsWith('/api/')) return false;
  if (url.pathname.startsWith('/rest/')) return false;
  return true;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App bundles + navigations + static assets: network-first, cache fallback.
  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(req);
        if (isCacheable(url) && fresh && fresh.status === 200 && fresh.type === 'basic') {
          const copy = fresh.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return fresh;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const home = await caches.match('/');
          if (home) return home;
        }
        throw err;
      }
    })(),
  );
});

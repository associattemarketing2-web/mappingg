/* Mappingg service worker — enables PWA install + basic offline support.
 * Strategy: NETWORK-FIRST for pages and app bundles (so content is never stale),
 * falling back to cache when offline. API/auth/db requests are never cached.
 *
 * Navigations use a network timeout: on a slow/flaky mobile link the SW stops
 * waiting after NAV_TIMEOUT_MS and serves the cached page instead of leaving a
 * blank screen (the "PWA pages sometimes don't load" symptom). The network copy
 * still updates the cache in the background when it eventually arrives. */
const CACHE = 'mappingg-v3';
const NAV_TIMEOUT_MS = 3500;
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

// Cache a successful, cacheable response without blocking the response path.
function cachePut(url, req, res) {
  if (isCacheable(url) && res && res.status === 200 && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  }
}

// Best cached fallback for a request: the exact match, else (for navigations)
// the cached page, else the app shell home.
async function cacheFallback(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  if (req.mode === 'navigate') {
    const home = await caches.match('/');
    if (home) return home;
  }
  return null;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Navigations: race the network against a timeout so a slow/offline link
  // falls back to cache instead of a hanging blank page. The network request
  // keeps running and refreshes the cache if/when it completes.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const net = fetch(req)
          .then((res) => { cachePut(url, req, res); return res; });
        const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
        try {
          const winner = await Promise.race([net, timeout]);
          if (winner) return winner;              // network won in time
          const cached = await cacheFallback(req); // timed out → serve cache
          if (cached) return cached;
          return await net;                        // nothing cached → wait it out
        } catch (err) {
          const cached = await cacheFallback(req);
          if (cached) return cached;
          throw err;
        }
      })(),
    );
    return;
  }

  // App bundles + static assets: network-first, cache fallback.
  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(req);
        cachePut(url, req, fresh);
        return fresh;
      } catch (err) {
        const cached = await cacheFallback(req);
        if (cached) return cached;
        throw err;
      }
    })(),
  );
});

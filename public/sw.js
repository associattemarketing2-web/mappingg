/* Mappingg service worker — enables PWA install + basic offline support.
 * Strategy: NETWORK-FIRST for pages and app bundles (so content is never stale),
 * falling back to cache when offline. API/auth/db requests are never cached.
 *
 * Navigations use a network timeout: on a slow/flaky mobile link the SW stops
 * waiting after NAV_TIMEOUT_MS and serves the cached page instead of leaving a
 * blank screen (the "PWA pages sometimes don't load" symptom). The network copy
 * still updates the cache in the background when it eventually arrives. */
const CACHE = 'mappingg-v7'; // v7: push notifications. v6: private pages, API calls and other origins bypass the worker. v5: drops pages cached before the OTP-paused sign-in (v4: private pages)
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

// Signed-in areas render personal/admin data into the HTML itself. They must
// never be written to the offline cache (a shared device, or a visit after
// sign-out, could otherwise be served someone's cached dashboard).
const PRIVATE_PREFIXES = ['/api/', '/rest/', '/dashboard', '/s-admin', '/signin', '/intake', '/submit', '/partners/'];

function isCacheable(url) {
  if (url.origin !== self.location.origin) return false;
  // Never cache dynamic/private endpoints or signed-in pages.
  if (PRIVATE_PREFIXES.some((p) => url.pathname === p.replace(/\/$/, '') || url.pathname.startsWith(p))) return false;
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
  // Private pages, API calls and other origins are never cached, so the service
  // worker stays out of them entirely and the browser fetches them as usual. (It
  // used to wrap them too: when one failed — e.g. the dashboard's background
  // prefetches while the server was erroring — the console filled with
  // "FetchEvent … network error" and "sw.js Failed to fetch" on top of the real error.)
  if (!isCacheable(url)) return;

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

<<<<<<< Updated upstream
/* ---------------------------------------------------------------------------
 * Web Push — admin alerts on the laptop / phone, even when the site is closed.
 * The server sends { title, body, url, tag }; clicking opens (or focuses) that page. */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data ? event.data.text() : '' }; }
=======
/* ------------------------------ Push notifications ------------------------------ */
// Sent by lib/push.ts to teammates who turned notifications on (components/PushToggle.tsx):
// new leads, WhatsApp messages, tracked links opened. Tapping one opens its page
// in the installed app / an open tab when there is one.
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'Mappingg', body: event.data ? event.data.text() : '' }; }
>>>>>>> Stashed changes
  const title = d.title || 'Mappingg';
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: d.tag || undefined,
<<<<<<< Updated upstream
    renotify: !!d.tag,
=======
    renotify: Boolean(d.tag),
>>>>>>> Stashed changes
    data: { url: d.url || '/dashboard/s-admin' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/dashboard/s-admin', self.location.origin).href;
  event.waitUntil((async () => {
<<<<<<< Updated upstream
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = all.find((c) => c.url === target) || all.find((c) => new URL(c.url).pathname.startsWith('/dashboard'));
    if (same) { await same.focus(); if (same.url !== target && 'navigate' in same) await same.navigate(target).catch(() => {}); return; }
    await self.clients.openWindow(target);
=======
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Reuse an open admin window (the installed app) when there is one.
    const win = wins.find((w) => new URL(w.url).pathname.startsWith('/dashboard/s-admin')) || wins[0];
    if (win) {
      await win.focus();
      if ('navigate' in win) return win.navigate(target).catch(() => self.clients.openWindow(target));
      return undefined;
    }
    return self.clients.openWindow(target);
>>>>>>> Stashed changes
  })());
});

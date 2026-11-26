/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework (X-Powered-By: Next.js) on every response.
  poweredByHeader: false,
  // The legacy map apps rely on data: URLs and remote tile/logo images that are
  // injected as raw <img> tags, so we keep the classic <img> behaviour rather
  // than forcing next/image on the ported markup.
  images: { unoptimized: true },
  // fast-geoip reads its IP-location data files from its own folder at runtime,
  // so it must stay a plain node_modules package (not bundled) — lib/site-analytics.ts.
  experimental: { serverComponentsExternalPackages: ['fast-geoip'] },
  // Clean URLs for the partners intake app (static assets live under
  // /public/partners, but these are the addresses people actually use):
  //   /intake → intake panel (bulk CSV upload, review queue, builders, live);
  //             also embedded as the "Projects Intake" tab inside /s-admin
  //   /submit → builder submission page (opened via a unique ?t=token link)
  async rewrites() {
    // Listing pages 2+ keep their public ?page=N URLs (canonicals, pager links and
    // indexed URLs are unchanged), but are served by a path segment (…/p/N) so the
    // route never reads searchParams. In Next 14 reading searchParams made every
    // listing a per-request server render (`private, no-store`, never CDN-cached).
    // beforeFiles: must run before the real /projects, /blog… routes match.
    const PAGE = [{ type: 'query', key: 'page', value: '(?<page>[2-9]|[1-9]\\d+)' }];
    const beforeFiles = [
      { source: '/projects', has: PAGE, destination: '/projects/p/:page' },
      { source: '/blog', has: PAGE, destination: '/blog/p/:page' },
      { source: '/status/:status', has: PAGE, destination: '/status/:status/p/:page' },
      { source: '/property/:type', has: PAGE, destination: '/property/:type/p/:page' },
    ];
    const afterFiles = [
      // Browsers ask for /favicon.ico on plain HTML pages (intake, submit) — serve the logo mark.
      { source: '/favicon.ico', destination: '/img/mappingg-icon-mark.png' },
      { source: '/intake', destination: '/partners/admin/index.html' },
      { source: '/intake/', destination: '/partners/admin/index.html' },
      { source: '/submit', destination: '/partners/submit/index.html' },
      { source: '/submit/', destination: '/partners/submit/index.html' },
      // Crawlable address for PUBLIC pin images (robots.txt keeps /api/ blocked, so
      // images served from /api/... could never be indexed by Google Images). Same
      // handler and access rules: /api/media only serves whitelisted fields of pins
      // shown on the public map (hidden pins are staff-only there).
      // Official project photos have their own handler: app/media/project/[...path].
      { source: '/media/pins/:id', destination: '/api/media/pins/:id' },
    ];
    return { beforeFiles, afterFiles, fallback: [] };
  },
  async redirects() {
    return [
      // /signin is just an alias for the home page's sign-in modal. As a static
      // page its redirect was prerendered without a Location header; a config
      // redirect is a real 307 that never renders anything.
      { source: '/signin', destination: '/?signin=1', permanent: false },
      // City pages were retired (4 Nov): old links and indexed URLs go to the
      // projects list. (`?city=` is dropped there, so it is not passed on.)
      { source: '/cities', destination: '/projects', permanent: true },
      { source: '/cities/:rest*', destination: '/projects', permanent: true },
      // Locality and developer hubs are live again (22 Nov). Their old BHK/budget
      // sub-pages (/locations/<loc>/<facet>) were not restored: they go to the hub.
      { source: '/locations/:slug/:facet+', destination: '/locations/:slug', permanent: true },
      { source: '/developers/:slug/:rest+', destination: '/developers/:slug', permanent: true },
    ];
  },
  async headers() {
    return [
      {
        // Baseline security headers on every response. Pages are only framed by
        // our own pages (the home page embeds /map?embed=home), so SAMEORIGIN.
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Browser features the site may use: location (map "near me", same-origin
          // map iframe on the home page) and the microphone (voice search on the home
          // page) — only for our own pages. Camera and USB are never used.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(self), usb=(), interest-cohort=()' },
        ],
      },
      {
        // HR & Attendance: employees check in with a front-camera selfie, so the
        // camera is allowed (own origin only) on these pages. Same key as above —
        // the later matching header wins. The super-admin shows the HR pages in a
        // tab (same-origin iframe), so it must allow the camera too.
        source: '/dashboard/:area(hr|s-admin)/:path*',
        headers: [
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self), usb=(), interest-cohort=()' },
        ],
      },
      {
        // Never let search engines index the dashboards (super-admin now lives at
        // /dashboard/s-admin) or the old /s-admin path that redirects to it.
        source: '/:path(dashboard|dashboard/.*|s-admin|s-admin/.*)',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      {
        // Intake app + builder submit page are internal — never index them,
        // their static assets, or the sign-in page.
        source: '/:path(intake|submit|signin|partners/.*)',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      {
        // Static app bundles + the DB shim: revalidate (cheap 304 when unchanged)
        // instead of a full re-download, but always pick up a fresh deploy.
        source: '/legacy/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
      {
        source: '/db-shim.js',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
      {
        // Logos/marks/icons/globe textures change rarely — browsers reuse them for
        // a week and refresh in the background for a month after that.
        // Repeat visits skip re-fetching them (Lighthouse: efficient cache lifetimes).
        source: '/:dir(img|icons|video|og)/:file*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=2592000' }],
      },
    ];
  },
};

export default nextConfig;

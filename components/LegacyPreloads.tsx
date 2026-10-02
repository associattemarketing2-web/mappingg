import fs from 'node:fs';
import path from 'node:path';

// Server-rendered resource hints for a legacy map app. <LegacyApp/> only learns
// what to load after hydrating and fetching its JSON bundle, then loads the
// libraries one by one — a long waterfall on iPads/phones. These hints are in
// the initial HTML, so the browser starts the bundle, its libraries, styles and
// map-tile connections immediately and in parallel.
type Bundle = { headLinks?: string[]; scripts?: Array<{ src?: string; async?: boolean }> };

const cache = new Map<string, Bundle>();
function readBundle(slug: string): Bundle {
  if (!cache.has(slug)) {
    try {
      cache.set(slug, JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'legacy', `${slug}.json`), 'utf8')));
    } catch {
      cache.set(slug, {});
    }
  }
  return cache.get(slug)!;
}

const PRECONNECT = [
  'https://a.tile.openstreetmap.org',
  'https://b.tile.openstreetmap.org',
  'https://c.tile.openstreetmap.org',
];

export default function LegacyPreloads({ slug }: { slug: string }) {
  const bundle = readBundle(slug);
  // Libraries the app waits on before it can start (async ones like Google Maps can wait).
  const scripts = (bundle.scripts || []).filter((s) => s.src && !s.async).map((s) => s.src!);
  const styles = (bundle.headLinks || []).filter((h) => !h.includes('fonts.googleapis.com'));
  const origins = [...new Set([...scripts, ...styles].filter((u) => /^https:/.test(u)).map((u) => new URL(u).origin))];

  return (
    <>
      {/* No crossOrigin: tiles and these libraries load as plain (non-CORS) requests. */}
      {[...origins, ...PRECONNECT].map((o) => <link key={o} rel="preconnect" href={o} />)}
      <link rel="preload" href={`/legacy/${slug}.json`} as="fetch" crossOrigin="anonymous" />
      {styles.map((href) => <link key={href} rel="preload" href={href} as="style" />)}
      {scripts.map((src) => <link key={src} rel="preload" href={src} as="script" />)}
    </>
  );
}

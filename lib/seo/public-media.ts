// Crawlable image addresses for the public SEO pages.
//
// Public images are served by handlers under /api/ (pin logos: /api/media,
// official project photos: /api/partners/storage?bucket=project-media&public=1),
// and robots.txt disallows /api/ — so Google could never fetch or index them.
// next.config.mjs maps two public aliases onto the very same handlers:
//   /media/pins/<id>?…          → /api/media/pins/<id>?…
//   /media/project/<path>?w=…   → /api/partners/storage?bucket=project-media&path=<path>&public=1
// This module turns stored/internal URLs into those aliases. Anything else
// (external URLs, other buckets, PDFs) is returned unchanged.

const IMAGE_EXT = /\.(?:jpe?g|png|webp|avif|gif)$/i;

/** Public, crawlable form of an image URL (or the URL unchanged if it has none). */
export function publicImageUrl(url?: string | null, opts: { width?: number } = {}): string | undefined {
  if (!url) return undefined;
  const w = opts.width ? Math.round(opts.width) : 0;

  // /api/media/pins/<id>?f=image&v=…[&w=…]
  const pinMedia = /^\/api\/media\/pins\/([^?#]+)(\?[^#]*)?$/.exec(url);
  if (pinMedia) {
    const qs = new URLSearchParams(pinMedia[2] ? pinMedia[2].slice(1) : '');
    if (w) qs.set('w', String(w));
    return `/media/pins/${pinMedia[1]}?${qs.toString()}`;
  }

  // /api/partners/storage?bucket=project-media&path=<p>&public=1
  if (url.startsWith('/api/partners/storage?')) {
    const qs = new URLSearchParams(url.slice('/api/partners/storage?'.length));
    const path = qs.get('path') || '';
    if (qs.get('bucket') !== 'project-media' || qs.get('public') !== '1' || !IMAGE_EXT.test(path)) return url;
    // Keep each path segment encoded, but leave the "/" separators readable.
    const clean = path.split('/').map(encodeURIComponent).join('/');
    return `/media/project/${clean}${w ? `?w=${w}` : ''}`;
  }

  return url;
}

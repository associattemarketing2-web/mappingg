import { BLOG_THUMBS } from './blog-thumbs';

// Card-sized WebP copy of a blog cover (scripts/build-blog-thumbs.mjs makes them):
// /img/blog/<name>.jpg → /img/blog/thumbs/<name>-640.webp (~15 KB instead of
// ~100 KB). Only covers listed in lib/blog-thumbs.ts are swapped; anything else
// (a new cover without a thumbnail yet, an external URL) keeps its original.

const HAVE = new Set<string>(BLOG_THUMBS);

export function blogThumb(cover?: string | null): string {
  if (!cover) return '';
  const m = /^\/img\/blog\/([^/?#]+)\.(jpe?g|png)$/i.exec(cover);
  if (!m || !HAVE.has(`${m[1]}.${m[2]}`)) return cover;
  return `/img/blog/thumbs/${m[1]}-640.webp`;
}

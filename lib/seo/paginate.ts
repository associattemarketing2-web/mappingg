// Pagination for the big project listings (/projects, /status/*, /property/*,
// /cities/*). Same URL convention as the blog: page 1 is the plain URL, later
// pages are ?page=N (crawlable links, self-canonical). Before this, /projects
// sent all 965 project cards — about 1.2 MB of HTML.

import { parseBlogPage, type PageParam } from '../blog-pagination';

export type { PageParam };

export const LISTING_PER_PAGE = 48;

export interface Paged<T> {
  page: number;
  pages: number;
  total: number;
  /** 1-based position of the first item on this page. */
  from: number;
  items: T[];
}

/** The requested page of `items`, or null when it is past the last page (→ 404). */
export function paginate<T>(items: T[], param: PageParam, perPage = LISTING_PER_PAGE): Paged<T> | null {
  const page = parseBlogPage(param);
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  if (page > pages) return null;
  const start = (page - 1) * perPage;
  return { page, pages, total: items.length, from: start + 1, items: items.slice(start, start + perPage) };
}

/** /projects for page 1, /projects?page=N otherwise. */
export const pageHref = (base: string, n: number) => (n <= 1 ? base : `${base}?page=${n}`);

/**
 * Page numbers to show: first, last, and up to two either side of the current
 * page, with null marking a gap — e.g. 1 … 4 5 [6] 7 8 … 21.
 */
export function pageWindow(page: number, pages: number): (number | null)[] {
  const keep = new Set([1, pages]);
  for (let n = page - 2; n <= page + 2; n++) if (n >= 1 && n <= pages) keep.add(n);
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, i) => {
    if (i && n - sorted[i - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}

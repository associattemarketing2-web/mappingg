// Pagination for the public blog index (app/blog/page.tsx): page 1 is /blog,
// later pages are /blog?page=N.

export const BLOG_PER_PAGE = 9;

export type PageParam = string | string[] | undefined;

/** /blog for page 1, /blog?page=N otherwise. */
export const blogPageHref = (n: number) => (n <= 1 ? '/blog' : `/blog?page=${n}`);

/**
 * The requested page: a whole number ≥ 2, else 1. Malformed, negative, zero,
 * decimal or empty values all mean page 1 (that URL's canonical is /blog).
 */
export function parseBlogPage(param: PageParam): number {
  const v = Array.isArray(param) ? param[0] : param;
  if (v == null || !/^\d+$/.test(v.trim())) return 1;
  const n = Number(v.trim());
  return Number.isSafeInteger(n) && n > 1 ? n : 1;
}

export function blogPageCount(total: number, perPage = BLOG_PER_PAGE): number {
  return Math.max(1, Math.ceil(total / perPage));
}

/** The posts on a page, or null when the page is past the last one (→ 404). */
export function blogPageSlice<T>(all: T[], page: number, perPage = BLOG_PER_PAGE): T[] | null {
  if (page > blogPageCount(all.length, perPage)) return null;
  return all.slice((page - 1) * perPage, page * perPage);
}

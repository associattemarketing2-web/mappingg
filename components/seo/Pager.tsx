import Link from 'next/link';
import { pageHref, pageWindow } from '@/lib/seo/paginate';

// Crawlable page links for the paginated project listings (plain <a href>, so
// search engines and keyboard users can reach every page).
export default function Pager({ base, page, pages, label }: { base: string; page: number; pages: number; label: string }) {
  if (pages <= 1) return null;
  return (
    <nav className="seo-pager" aria-label={label}>
      {page > 1 ? (
        <Link className="pg-step" href={pageHref(base, page - 1)} rel="prev">← Previous</Link>
      ) : (
        <span className="pg-step off" aria-hidden="true">← Previous</span>
      )}
      <span className="pg-nums">
        {pageWindow(page, pages).map((n, i) =>
          n == null ? (
            <span key={`gap${i}`} className="pg-gap" aria-hidden="true">…</span>
          ) : n === page ? (
            <span key={n} className="pg-num on" aria-current="page">{n}</span>
          ) : (
            <Link key={n} className="pg-num" href={pageHref(base, n)} aria-label={`Page ${n}`}>{n}</Link>
          ),
        )}
      </span>
      {page < pages ? (
        <Link className="pg-step" href={pageHref(base, page + 1)} rel="next">Next →</Link>
      ) : (
        <span className="pg-step off" aria-hidden="true">Next →</span>
      )}
    </nav>
  );
}

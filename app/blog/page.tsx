import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import BlogFooter from '@/components/BlogFooter';
import { listPublished } from '@/lib/blog';
import SiteHeader from '@/components/SiteHeader';

import { SITE_URL } from '@/lib/seo/config';
import { blogPageCount, blogPageHref as pageHref, blogPageSlice, parseBlogPage, type PageParam } from '@/lib/blog-pagination';

export const revalidate = 3600;

// 9 articles per page; page 1 is /blog, later pages /blog?page=N (lib/blog-pagination.ts).

// Page 2+ gets its own title and canonical URL so search engines index each page.
export function generateMetadata({ searchParams }: { searchParams?: { page?: PageParam } }): Metadata {
  const page = parseBlogPage(searchParams?.page);
  if (page === 1) return {};
  return { title: `Blog — Page ${page}`, alternates: { canonical: `${SITE_URL}${pageHref(page)}` } };
}

function fmt(d?: string | null) {
  return d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

const Footer = BlogFooter;

export default async function BlogIndex({ searchParams }: { searchParams?: { page?: PageParam } }) {
  const all = await listPublished();
  const pages = blogPageCount(all.length);
  const page = parseBlogPage(searchParams?.page);
  const posts = blogPageSlice(all, page);
  if (!posts) notFound();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Mappingg Blog',
    url: `${SITE_URL}${pageHref(page)}`,
    blogPost: posts.map((p) => ({
      '@type': 'BlogPosting',
      headline: p.title,
      url: `${SITE_URL}/blog/${p.slug}`,
      datePublished: p.published_at || p.created_at,
      author: { '@type': 'Organization', name: p.author || 'Mappingg' },
    })),
  };

  return (
    <div className="blogwrap">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <SiteHeader />

      <header className="blog-hero">
        <div className="wrap">
          <span className="eyebrow">Mappingg Blog</span>
          <h1>Pune &amp; Mumbai real estate, made clear</h1>
          <p>Locality guides, budget guides and buying tips for Pune and the Mumbai Metropolitan Region — from the team behind the live project map.</p>
        </div>
      </header>

      <main className="wrap">
        {posts.length === 0 ? (
          <div className="blog-empty">
            <p>No articles yet — check back soon.</p>
          </div>
        ) : (
          <div className="blog-grid">
            {posts.map((p) => (
              <a className="post-card" href={`/blog/${p.slug}`} key={p.id}>
                {p.cover_image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="post-cover" src={p.cover_image} alt={p.title} loading="lazy" />
                ) : (
                  <div className="post-cover ph"><i className="fas fa-newspaper" aria-hidden="true">📰</i></div>
                )}
                <div className="post-body">
                  {p.tags && p.tags.length > 0 && (
                    <div className="post-tags">{p.tags.slice(0, 3).map((t) => <span key={t}>{t}</span>)}</div>
                  )}
                  <h2>{p.title}</h2>
                  {p.excerpt && <p>{p.excerpt}</p>}
                  <div className="post-meta">{p.author || 'Mappingg Team'} · {fmt(p.published_at || p.created_at)}</div>
                </div>
              </a>
            ))}
          </div>
        )}

        {pages > 1 && (
          <nav className="blog-pager" aria-label="Blog pages">
            {page > 1
              ? <a className="pg-step" href={pageHref(page - 1)} rel="prev">← Previous</a>
              : <span className="pg-step off" aria-hidden="true">← Previous</span>}
            <span className="pg-nums">
              {Array.from({ length: pages }, (_, i) => i + 1).map((n) =>
                n === page
                  ? <span key={n} className="pg-num on" aria-current="page">{n}</span>
                  : <a key={n} className="pg-num" href={pageHref(n)} aria-label={`Page ${n}`}>{n}</a>)}
            </span>
            {page < pages
              ? <a className="pg-step" href={pageHref(page + 1)} rel="next">Next →</a>
              : <span className="pg-step off" aria-hidden="true">Next →</span>}
          </nav>
        )}
      </main>

      <Footer />
    </div>
  );
}

import BlogFooter from '@/components/BlogFooter';
import { notFound } from 'next/navigation';
import { getPublishedPost as getBySlug, readingTime } from '@/lib/blog';
import SiteHeader from '@/components/SiteHeader';

import { SITE, SITE_URL } from '@/lib/seo/config';
import { breadcrumbSchema } from '@/lib/seo/schema';
import { resolveInternalLinks } from '@/lib/seo/resolve-links';
import { facetHeading, getAllFacetPages } from '@/lib/seo/facet-pages';
import { isFacetGuide } from '@/lib/seo/facets';

export const revalidate = 3600;

function fmt(d?: string | null) {
  return d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

/** True when the post was edited at least a day after it was published (worth showing). */
function wasUpdated(published?: string | null, updated?: string | null): boolean {
  const p = Date.parse(published || '');
  const u = Date.parse(updated || '');
  return Number.isFinite(p) && Number.isFinite(u) && u - p > 86_400_000;
}

export default async function BlogArticle({ params }: { params: { slug: string } }) {
  const post = await getBySlug(params.slug);
  if (!post) notFound();

  const url = `${SITE_URL}/blog/${post.slug}`;
  const body = await resolveInternalLinks(post.content || '');
  // A guide like /blog/2-bhk-flats-in-pune points readers to the live list it explains.
  const liveList = (await getAllFacetPages().catch(() => [])).find(
    (f) => f.scope === 'city' && isFacetGuide(f.facet.slug, f.place.slug, post.slug),
  );
  const published = post.published_at || post.created_at;
  const updated = wasUpdated(published, post.updated_at) ? post.updated_at : null;
  // Structured data wants an absolute image URL; covers may be site-relative (/img/blog/...).
  const cover = post.cover_image?.startsWith('/') ? `${SITE_URL}${post.cover_image}` : post.cover_image;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.seo_description || post.excerpt || '',
    image: cover ? [cover] : [SITE.ogFallback],
    datePublished: published,
    dateModified: post.updated_at || published,
    author: { '@type': 'Organization', name: post.author || 'Mappingg', url: SITE_URL },
    publisher: {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: 'Mappingg',
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/img/mappingg-icon-mark.png` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    keywords: (post.tags || []).join(', '),
  };
  const crumbs = breadcrumbSchema([
    { name: 'Home', path: '/' },
    { name: 'Blog', path: '/blog' },
    { name: post.title, path: `/blog/${post.slug}` },
  ]);

  return (
    <div className="blogwrap">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify([jsonLd, crumbs]) }} />

      <SiteHeader />

      <article className="article">
        <div className="wrap narrow">
          <nav aria-label="Breadcrumb" className="back">
            <a href="/">Home</a>
            <span aria-hidden="true">›</span>
            <a href="/blog">All articles</a>
          </nav>
          {post.tags && post.tags.length > 0 && (
            <div className="kicker">{post.tags.map((t) => <span key={t}>{t}</span>)}</div>
          )}
          <h1>{post.title}</h1>
          <div className="a-meta">
            <span>{post.author || 'Mappingg Team'}</span>
            <span>·</span>
            <span>{fmt(published)}</span>
            {updated && (
              <>
                <span>·</span>
                <span>Updated {fmt(updated)}</span>
              </>
            )}
            <span>·</span>
            <span>{readingTime(post.content)} min read</span>
          </div>
          {post.cover_image && (
            // Above-the-fold article image: loaded eagerly with high priority (LCP).
            // eslint-disable-next-line @next/next/no-img-element
            <img className="a-cover" src={post.cover_image} alt={post.title} width={1200} height={630} fetchPriority="high" />
          )}
          {liveList && (
            <p className="a-live-list">
              Live list: <a href={liveList.path}>{facetHeading(liveList.facet)} in {liveList.placeShort}</a> — {liveList.pins.length}{' '}
              projects, updated as listings change. This guide explains prices and what to check; the live list shows every
              current project.
            </p>
          )}
          <div className="article-body" dangerouslySetInnerHTML={{ __html: body }} />

          <div className="article-cta">
            <h3>See these projects on the live map</h3>
            <p>Every project, its RERA registration number and what’s around it — at no cost to buyers.</p>
            <a href="/map"><i aria-hidden="true">🗺️</i> Open the live map</a>
          </div>
        </div>
      </article>

      <BlogFooter />
    </div>
  );
}

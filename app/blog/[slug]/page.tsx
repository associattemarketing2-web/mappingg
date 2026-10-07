import BlogFooter from '@/components/BlogFooter';
import { notFound } from 'next/navigation';
import { getBySlug, readingTime } from '@/lib/blog';
import SiteHeader from '@/components/SiteHeader';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

export const revalidate = 600;

function fmt(d?: string | null) {
  return d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

export default async function BlogArticle({ params }: { params: { slug: string } }) {
  const post = await getBySlug(params.slug);
  if (!post) notFound();

  const url = `${SITE_URL}/blog/${post.slug}`;
  // Structured data wants an absolute image URL; covers may be site-relative (/img/blog/...).
  const cover = post.cover_image?.startsWith('/') ? `${SITE_URL}${post.cover_image}` : post.cover_image;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.seo_description || post.excerpt || '',
    image: cover ? [cover] : [`${SITE_URL}/img/mappingg-icon-mark.png`],
    datePublished: post.published_at || post.created_at,
    dateModified: post.updated_at || post.published_at || post.created_at,
    author: { '@type': 'Organization', name: post.author || 'Mappingg' },
    publisher: {
      '@type': 'Organization',
      name: 'Mappingg',
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/img/mappingg-icon-mark.png` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    keywords: (post.tags || []).join(', '),
  };

  return (
    <div className="blogwrap">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <SiteHeader />

      <article className="article">
        <div className="wrap narrow">
          <a className="back" href="/blog"><i aria-hidden="true">←</i> All articles</a>
          {post.tags && post.tags.length > 0 && (
            <div className="kicker">{post.tags.map((t) => <span key={t}>{t}</span>)}</div>
          )}
          <h1>{post.title}</h1>
          <div className="a-meta">
            <span>{post.author || 'Mappingg Team'}</span>
            <span>·</span>
            <span>{fmt(post.published_at || post.created_at)}</span>
            <span>·</span>
            <span>{readingTime(post.content)} min read</span>
          </div>
          {post.cover_image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="a-cover" src={post.cover_image} alt={post.title} />
          )}
          <div className="article-body" dangerouslySetInnerHTML={{ __html: post.content || '' }} />

          <div className="article-cta">
            <h3>See these projects on the live map</h3>
            <p>Every project, its MahaRERA-verified RERA number and what’s around it — at no cost to buyers.</p>
            <a href="/map"><i aria-hidden="true">🗺️</i> Open the live map</a>
          </div>
        </div>
      </article>

      <BlogFooter />
    </div>
  );
}

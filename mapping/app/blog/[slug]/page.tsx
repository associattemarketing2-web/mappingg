import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import '../blog.css';
import { getBySlug, readingTime } from '@/lib/blog';
import SiteHeader from '@/components/SiteHeader';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

export const revalidate = 600;

function fmt(d?: string | null) {
  return d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const post = await getBySlug(params.slug);
  if (!post) return { title: 'Post not found', robots: { index: false, follow: false } };
  const title = post.seo_title || post.title;
  const description = post.seo_description || post.excerpt || `${post.title} — on the Mappingg blog.`;
  const url = `${SITE_URL}/blog/${post.slug}`;
  return {
    title,
    description,
    keywords: post.tags && post.tags.length ? post.tags : undefined,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      title,
      description,
      url,
      images: post.cover_image ? [post.cover_image] : ['/img/mappingg-icon-mark.png'],
      publishedTime: post.published_at || post.created_at,
      authors: [post.author || 'Mappingg'],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: post.cover_image ? [post.cover_image] : undefined,
    },
  };
}

export default async function BlogArticle({ params }: { params: { slug: string } }) {
  const post = await getBySlug(params.slug);
  if (!post) notFound();

  const url = `${SITE_URL}/blog/${post.slug}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.seo_description || post.excerpt || '',
    image: post.cover_image ? [post.cover_image] : [`${SITE_URL}/img/mappingg-icon-mark.png`],
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

      <footer className="blog-foot">
        <div className="wrap">
          <span>© {new Date().getFullYear()} Mappingg.com — a product by Associatte.</span>
          <span><a href="/">Home</a> · <a href="/map">Live map</a></span>
        </div>
      </footer>
    </div>
  );
}

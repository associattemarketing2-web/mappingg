import type { Metadata } from 'next';
import './blog.css';
import { listPublished } from '@/lib/blog';
import SiteHeader from '@/components/SiteHeader';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Blog — Pune Real Estate Insights, Guides & News',
  description:
    'Practical guides, area insights and market news for buying property in Pune — RERA, possession, pricing, infrastructure and more, from the Mappingg team.',
  keywords: [
    'Pune real estate blog', 'property buying guide Pune', 'MahaRERA guide', 'Pune property news',
    'best areas to buy in Pune', 'Kharadi property', 'Mundhwa flats', 'Hadapsar real estate',
    'property investment Pune', 'new projects Pune', 'possession date guide', 'Mappingg blog',
  ],
  alternates: { canonical: `${SITE_URL}/blog` },
  openGraph: {
    type: 'website',
    title: 'Mappingg Blog — Pune Real Estate Insights & Guides',
    description: 'Guides, area insights and market news for buying property in Pune.',
    url: `${SITE_URL}/blog`,
  },
};

function fmt(d?: string | null) {
  return d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

function Footer() {
  return (
    <footer className="blog-foot">
      <div className="wrap">
        <span>© {new Date().getFullYear()} Mappingg.com — a product by Associatte.</span>
        <span><a href="/">Home</a> · <a href="/map">Live map</a></span>
      </div>
    </footer>
  );
}

export default async function BlogIndex() {
  const posts = await listPublished();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Mappingg Blog',
    url: `${SITE_URL}/blog`,
    blogPost: posts.slice(0, 50).map((p) => ({
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
          <h1>Pune real estate, made clear</h1>
          <p>Guides, area insights and market news to help you buy smarter — from the team behind the live project map.</p>
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
      </main>

      <Footer />
    </div>
  );
}

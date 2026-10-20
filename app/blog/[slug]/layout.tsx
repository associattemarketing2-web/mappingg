import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublishedPost as getBySlug } from '@/lib/blog';

import { SITE, SITE_URL } from '@/lib/seo/config';

// SEO metadata for /blog/<slug> lives here; page.tsx renders the article.
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const post = await getBySlug(params.slug);
  // Thrown here (before streaming starts) so a missing post is a real 404.
  if (!post) notFound();
  const title = post.seo_title || post.title;
  const description = post.seo_description || post.excerpt || `${post.title} — on the Mappingg blog.`;
  const url = `${SITE_URL}/blog/${post.slug}`;
  const images = post.cover_image
    ? [{ url: post.cover_image, width: 1200, height: 630, alt: post.title }]
    : [{ url: SITE.ogFallback, width: 1200, height: 630, alt: SITE.ogFallbackAlt }];
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      siteName: SITE.name,
      locale: SITE.locale,
      title,
      description,
      url,
      images,
      publishedTime: post.published_at || post.created_at,
      modifiedTime: post.updated_at || post.published_at || post.created_at,
      authors: [post.author || 'Mappingg'],
      tags: post.tags && post.tags.length ? post.tags : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images,
    },
  };
}

export default function BlogPostLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

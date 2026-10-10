import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getBySlug } from '@/lib/blog';

import { SITE_URL } from '@/lib/seo/config';

// SEO metadata for /blog/<slug> lives here; page.tsx renders the article.
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const post = await getBySlug(params.slug);
  // Thrown here (before streaming starts) so a missing post is a real 404.
  if (!post) notFound();
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

export default function BlogPostLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

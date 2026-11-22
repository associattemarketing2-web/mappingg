import type { Metadata } from 'next';
import BlogListing, { blogPageMetadata } from '../../listing';

// /blog?page=N — internal path for the rewrite in next.config.mjs. Canonical stays
// /blog?page=N (blogPageMetadata); pages past the last one 404.
export const revalidate = 3600;
export const dynamic = 'force-static';

type Props = { params: { page: string } };

export function generateMetadata({ params }: Props): Metadata {
  return blogPageMetadata(params.page);
}

export default function BlogPagedPage({ params }: Props) {
  return <BlogListing page={params.page} />;
}

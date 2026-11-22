import BlogListing from './listing';

// /blog — page 1 of the article list. Pages 2+ are /blog?page=N, served by
// app/blog/p/[page] through a rewrite (next.config.mjs), so this route never
// reads searchParams and is cached like a static page.
export const revalidate = 3600;
export const dynamic = 'force-static';

export default function BlogIndex() {
  return <BlogListing page={undefined} />;
}

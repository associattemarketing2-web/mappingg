import { getTypeGroups } from '@/lib/seo/entities';
import PropertyTypeListing from './listing';

// Page 1 of /property/<type>. Pages 2+ (/property/<type>?page=N) are served by
// ./p/[page] through a rewrite (next.config.mjs), so this route never reads
// searchParams and is prerendered + cached.
export const revalidate = 3600;
export const dynamic = 'force-static';
// Property types come from the live project data, so new ones appear between deploys.
// Known ones are prerendered; a new one renders on first request (ISR). Unknown
// slugs get a real 404 from this route's layout.tsx (generateMetadata), which
// runs before streaming starts.
export const dynamicParams = true;
export async function generateStaticParams() {
  return (await getTypeGroups()).map((g) => ({ type: g.slug }));
}

export default function PropertyTypePage({ params }: { params: { type: string } }) {
  return <PropertyTypeListing type={params.type} page={undefined} />;
}

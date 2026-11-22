import { STATUS_ROUTES } from '@/lib/seo/entities';
import StatusListing from './listing';

// Page 1 of /status/<status>. Pages 2+ (/status/<status>?page=N) are served by
// ./p/[page] through a rewrite (next.config.mjs), so this route never reads
// searchParams and is prerendered + cached.
export const revalidate = 3600;
export const dynamic = 'force-static';
// Closed set (3 indexed statuses) → prerender + hard-404 on unknown slugs.
export const dynamicParams = false;
export async function generateStaticParams() {
  return STATUS_ROUTES.map((s) => ({ status: s.slug }));
}

export default function StatusPage({ params }: { params: { status: string } }) {
  return <StatusListing status={params.status} page={undefined} />;
}

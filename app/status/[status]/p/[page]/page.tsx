import type { Metadata } from 'next';
import StatusListing, { statusPageMetadata } from '../../listing';

// /status/<status>?page=N — internal path for the rewrite in next.config.mjs.
// Canonical stays /status/<status>?page=N; pages past the last one 404.
export const revalidate = 3600;
export const dynamic = 'force-static';

type Props = { params: { status: string; page: string } };

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return statusPageMetadata(params.status, params.page);
}

export default function StatusPagedPage({ params }: Props) {
  return <StatusListing status={params.status} page={params.page} />;
}

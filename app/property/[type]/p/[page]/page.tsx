import type { Metadata } from 'next';
import PropertyTypeListing, { propertyTypePageMetadata } from '../../listing';

// /property/<type>?page=N — internal path for the rewrite in next.config.mjs.
// Canonical stays /property/<type>?page=N; pages past the last one 404.
export const revalidate = 3600;
export const dynamic = 'force-static';

type Props = { params: { type: string; page: string } };

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return propertyTypePageMetadata(params.type, params.page);
}

export default function PropertyTypePagedPage({ params }: Props) {
  return <PropertyTypeListing type={params.type} page={params.page} />;
}

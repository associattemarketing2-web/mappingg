import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /features lives here; page.tsx renders the content.
export const metadata: Metadata = buildMetadata({
  title: 'Features',
  description:
    'See every real estate project differently — project pins by status, map and satellite views, area labels, nearby places, upcoming infrastructure, project info and plot-by-plot layouts.',
  path: '/features',
});

export default function FeaturesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

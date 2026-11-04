import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /data-sources lives here; page.tsx renders the content.
export const metadata: Metadata = buildMetadata({
  title: 'Data Sources, RERA Checks & Editorial Policy',
  description:
    'Where Mappingg project data comes from, what a RERA number on a project page does and does not mean, how prices are shown, and how to report a correction.',
  path: '/data-sources',
});

export default function DataSourcesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

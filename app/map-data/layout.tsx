import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /map-data lives here; page.tsx renders the content.
export const metadata: Metadata = buildMetadata({
  title: 'Map Data & OpenStreetMap Policy',
  description:
    'Where Mappingg’s maps come from, how we credit OpenStreetMap contributors, the licences that apply, how we use map tile servers fairly, and how to report map errors.',
  path: '/map-data',
});

export default function MapDataLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

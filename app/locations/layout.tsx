import type { Metadata } from 'next';
import { buildSectionMetadata } from '@/lib/seo/metadata';

// SEO metadata for /locations lives here; page.tsx renders the content.
export const metadata: Metadata = buildSectionMetadata({
  title: 'Real Estate by Locality in Pune & MMR',
  description:
    'Explore real estate projects locality by locality across Pune and the Mumbai Metropolitan Region — Kharadi, Mundhwa, Magarpatta, Wagholi, Thane, Kharghar and more.',
  path: '/locations',
  keywords: ['real estate localities Pune', 'property by area Pune', 'MMR localities'],
});

export default function LocationsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

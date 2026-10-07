import type { Metadata } from 'next';
import { buildSectionMetadata } from '@/lib/seo/metadata';

// SEO metadata for /property lives here; page.tsx renders the content.
export const metadata: Metadata = buildSectionMetadata({
  title: 'Property Types in Pune & MMR',
  description:
    'Explore real estate by property type across Pune and the Mumbai Metropolitan Region — residential, commercial and more, with projects, locations and status on Mappingg.',
  path: '/property',
});

export default function PropertyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

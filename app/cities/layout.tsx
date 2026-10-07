import type { Metadata } from 'next';
import { buildSectionMetadata } from '@/lib/seo/metadata';

// SEO metadata for /cities lives here; page.tsx renders the content.
export const metadata: Metadata = buildSectionMetadata({
  title: 'Real Estate by City — Pune & Mumbai (MMR)',
  description:
    'Explore real estate projects city by city. Choose Pune or the Mumbai Metropolitan Region to drill into localities, developers and projects on Mappingg.',
  path: '/cities',
});

export default function CitiesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

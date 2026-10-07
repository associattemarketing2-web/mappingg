import type { Metadata } from 'next';
import { buildSectionMetadata } from '@/lib/seo/metadata';

// SEO metadata for /developers lives here; page.tsx renders the content.
export const metadata: Metadata = buildSectionMetadata({
  title: 'Real Estate Developers in Pune & MMR',
  description:
    'Browse real estate developers building across Pune and the Mumbai Metropolitan Region, and explore their projects, locations and current status on Mappingg.',
  path: '/developers',
  keywords: ['real estate developers Pune', 'builders Pune', 'developers MMR'],
});

export default function DevelopersLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

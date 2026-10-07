import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /careers lives here; page.tsx renders the content.
export const metadata: Metadata = buildMetadata({
  title: 'Careers',
  description:
    'Work with the team behind Mappingg, the live real estate project map by Associatte PropTech in Pune.',
  path: '/careers',
});

export default function CareersLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

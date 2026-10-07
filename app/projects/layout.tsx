import type { Metadata } from 'next';
import { buildSectionMetadata } from '@/lib/seo/metadata';

// SEO metadata for /projects lives here; page.tsx renders the content.
export const metadata: Metadata = buildSectionMetadata({
  title: 'Real Estate Projects in Pune & MMR',
  description:
    'Browse real estate projects across Pune and the Mumbai Metropolitan Region — by locality, developer, status and property type, with configurations, pricing and possession timelines.',
  path: '/projects',
  keywords: ['real estate projects Pune', 'property projects Mumbai', 'new projects MMR'],
});

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

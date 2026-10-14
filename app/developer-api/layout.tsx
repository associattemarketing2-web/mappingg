import type { Metadata } from 'next';
import { buildSectionMetadata } from '@/lib/seo/metadata';

// SEO metadata for /developer-api (page.tsx renders the docs; /reference has its own).
export const metadata: Metadata = buildSectionMetadata({
  title: 'Developer API',
  description:
    'Mappingg Developer API: read-only, key-based access to public real-estate project, developer, locality, map and article data for approved partners.',
  path: '/developer-api',
});

export default function DeveloperApiLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /how-it-works lives here; page.tsx renders the content.
export const metadata: Metadata = buildMetadata({
  title: 'How It Works',
  description:
    'How Mappingg works: home buyers search, compare and enquire on a live map of projects in Pune & Mumbai; developers put verified projects on the map and receive enquiries.',
  path: '/how-it-works',
});

export default function HowItWorksLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

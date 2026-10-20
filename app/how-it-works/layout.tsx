import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /how-it-works lives here; page.tsx renders the content.
export const metadata: Metadata = buildMetadata({
  title: 'How It Works — For Home Buyers & Developers',
  description:
    'Home buyers search, compare and enquire on one live map of projects in Pune, Mumbai, Bengaluru and more. Developers list verified projects and get enquiries.',
  path: '/how-it-works',
});

export default function HowItWorksLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /about lives here; page.tsx renders the content.
export const metadata: Metadata = buildMetadata({
  title: 'About Us — Real Estate Project Map by Associatte Ai Technologies LLP',
  description:
    'Mappingg puts every live real estate project on one interactive map. A product by Associatte Ai Technologies LLP, Pune.',
  path: '/about',
});

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

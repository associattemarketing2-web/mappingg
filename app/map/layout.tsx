import type { Metadata } from 'next';

import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /map lives here; page.tsx renders the content.
export const metadata: Metadata = buildMetadata({
  title: 'Live Project Map — Pune, Mumbai, Bengaluru & Delhi NCR',
  description:
    'Every mapped real estate project on one live map, colour-coded by status — with developer, price, configuration, RERA number, possession and nearby infrastructure.',
  path: '/map',
});

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /pricing lives here; page.tsx renders the plans from the database.
export const metadata: Metadata = buildMetadata({
  title: 'Plans & Pricing for Developers, Channel Partners and Buyers',
  description:
    'Mappingg membership plans: free and premium plans for real estate developers, channel partners and home buyers — project listings, brochures, CRM, unlimited project access and buyer premium tools.',
  path: '/pricing',
});

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

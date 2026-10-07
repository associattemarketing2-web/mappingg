import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /advertise lives here; page.tsx renders the content.
export const metadata: Metadata = buildMetadata({
  title: 'Advertise With Us',
  description:
    'Put your real estate project in front of buyers exploring the Mappingg live project map in Pune.',
  path: '/advertise',
});

export default function AdvertiseLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /disclaimer lives here; page.tsx renders the content.
export const metadata: Metadata = buildMetadata({
  title: 'Disclaimer',
  description:
    'Project information on Mappingg.com is for reference only. Please confirm all details with the developer and MahaRERA.',
  path: '/disclaimer',
});

export default function DisclaimerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

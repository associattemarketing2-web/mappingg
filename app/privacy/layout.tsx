import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /privacy lives here; page.tsx renders the content.
export const metadata: Metadata = buildMetadata({
  title: 'Privacy Policy',
  description:
    'How Mappingg and Associatte PropTech collect, use and protect your personal information, including how our OpenStreetMap-based maps work.',
  path: '/privacy',
});

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /cookies lives here; page.tsx renders the content.
export const metadata: Metadata = buildMetadata({
  title: 'Cookie Policy',
  description:
    'Which cookies Mappingg sets: essential cookies to sign you in and keep the site secure, Google Analytics only after you accept, and how to change your choice at any time.',
  path: '/cookies',
});

export default function CookiesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

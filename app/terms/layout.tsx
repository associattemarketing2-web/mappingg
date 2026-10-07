import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /terms lives here; page.tsx renders the content.
export const metadata: Metadata = buildMetadata({
  title: 'Terms of Use',
  description:
    'The terms that apply when you use Mappingg.com, the live real estate project map by Associatte PropTech.',
  path: '/terms',
});

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

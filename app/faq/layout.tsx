import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /faq lives here; page.tsx renders the content.
export const metadata: Metadata = buildMetadata({
  title: 'FAQ',
  description:
    'Answers to common questions about Mappingg — what it is, how projects are verified on MahaRERA, which areas are covered, the infrastructure we show and how to list your project.',
  path: '/faq',
});

export default function FaqLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

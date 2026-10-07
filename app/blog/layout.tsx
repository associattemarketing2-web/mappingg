import type { Metadata } from 'next';
import { buildSectionMetadata } from '@/lib/seo/metadata';
import './blog.css';

// SEO metadata for /blog lives here; page.tsx renders the content.
export const metadata: Metadata = buildSectionMetadata({
  title: 'Blog — Pune Real Estate Insights, Guides & News',
  description:
    'Practical guides, area insights and market news for buying property in Pune — RERA, possession, pricing, infrastructure and more, from the Mappingg team.',
  path: '/blog',
  keywords: [
    'Pune real estate blog', 'property buying guide Pune', 'MahaRERA guide', 'Pune property news',
    'best areas to buy in Pune', 'Kharadi property', 'Mundhwa flats', 'Hadapsar real estate',
    'property investment Pune', 'new projects Pune', 'possession date guide', 'Mappingg blog',
  ],
});

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

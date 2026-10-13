import type { Metadata } from 'next';
import { buildSectionMetadata } from '@/lib/seo/metadata';
import './blog.css';

// SEO metadata for /blog lives here; page.tsx renders the content.
export const metadata: Metadata = buildSectionMetadata({
  title: 'Blog — Pune & Mumbai Real Estate Guides, Insights & News',
  description:
    'Practical guides, locality insights and market news for buying property in Pune and the Mumbai Metropolitan Region — RERA, possession, pricing, stamp duty, home loans and more, from the Mappingg team.',
  path: '/blog',
  keywords: [
    'Pune real estate blog', 'property buying guide Pune', 'MahaRERA guide', 'Pune property news',
    'best areas to buy in Pune', 'Kharadi property', 'Mundhwa flats', 'Hadapsar real estate',
    'property investment Pune', 'new projects Pune', 'possession date guide', 'Mappingg blog',
    'Mumbai real estate blog', 'new projects Navi Mumbai', 'flats in Thane', 'Kalyan Dombivli projects',
  ],
});

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

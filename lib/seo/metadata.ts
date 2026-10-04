import type { Metadata } from 'next';
import { SITE, abs } from './config';

// One builder so every page produces a unique title/description, a correct
// self-canonical, and matching Open Graph + Twitter cards. Titles are passed
// WITHOUT the "— Mappingg" suffix; the root layout template appends it.

export interface BuildMeta {
  title: string;
  description: string;
  path: string;
  image?: string;
  type?: 'website' | 'article';
  noIndex?: boolean;
  keywords?: string[];
}

export function buildMetadata(o: BuildMeta): Metadata {
  const url = abs(o.path);
  const images = [o.image ? abs(o.image) : SITE.ogFallback];
  return {
    title: o.title,
    description: o.description,
    keywords: o.keywords && o.keywords.length ? o.keywords : undefined,
    alternates: { canonical: url },
    robots: o.noIndex ? { index: false, follow: false } : undefined,
    openGraph: {
      type: o.type || 'website',
      siteName: SITE.name,
      url,
      title: o.title,
      description: o.description,
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title: o.title,
      description: o.description,
      images,
    },
  };
}

import { SITE, abs } from './config';

// JSON-LD builders. Keep schema in sync with what is actually visible on the
// page — never emit fake ratings/reviews. Each returns a plain object that a
// page renders inside <script type="application/ld+json">.

export function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE.url}/#organization`,
    name: SITE.name,
    legalName: SITE.legalName,
    url: SITE.url,
    logo: SITE.logo,
    description: SITE.description,
    areaServed: ['Pune', 'Mumbai Metropolitan Region'],
  };
}

export function websiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE.url}/#website`,
    name: SITE.name,
    url: SITE.url,
    publisher: { '@id': `${SITE.url}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE.url}/map?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function breadcrumbSchema(items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: abs(it.path),
    })),
  };
}

export function itemListSchema(items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: abs(it.path),
      name: it.name,
    })),
  };
}

export function faqSchema(qas: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: qas.map((x) => ({
      '@type': 'Question',
      name: x.q,
      acceptedAnswer: { '@type': 'Answer', text: x.a },
    })),
  };
}

/** A single project (pin). Uses Residence inside a Place for a real-estate listing. */
export function projectSchema(opts: {
  name: string;
  description?: string;
  url: string;
  image?: string;
  locality?: string;
  city?: string;
  lat?: number;
  lng?: number;
  developer?: string;
}) {
  const geo = opts.lat && opts.lng ? { '@type': 'GeoCoordinates', latitude: opts.lat, longitude: opts.lng } : undefined;
  return {
    '@context': 'https://schema.org',
    '@type': 'Residence',
    name: opts.name,
    description: opts.description || undefined,
    url: abs(opts.url),
    image: opts.image ? abs(opts.image) : undefined,
    ...(opts.developer ? { provider: { '@type': 'Organization', name: opts.developer } } : {}),
    address: {
      '@type': 'PostalAddress',
      addressLocality: opts.locality || undefined,
      addressRegion: opts.city || undefined,
      addressCountry: 'IN',
    },
    ...(geo ? { geo } : {}),
  };
}

/** Extract a YouTube video id from the common URL forms, or null. */
export function youtubeId(url?: string): string | null {
  if (!url) return null;
  const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/.exec(url);
  return m ? m[1] : null;
}

/** VideoObject for a project's YouTube walkthrough. Only emit when a video exists. */
export function videoSchema(opts: { id: string; name: string; description?: string; uploadDate?: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: opts.name,
    description: opts.description || opts.name,
    thumbnailUrl: [`https://i.ytimg.com/vi/${opts.id}/hqdefault.jpg`],
    embedUrl: `https://www.youtube.com/embed/${opts.id}`,
    contentUrl: `https://www.youtube.com/watch?v=${opts.id}`,
    uploadDate: opts.uploadDate || undefined,
  };
}

/** Serialize one or more schema objects for a single <script> tag. */
export function jsonLd(...schemas: object[]): string {
  return JSON.stringify(schemas.length === 1 ? schemas[0] : schemas);
}

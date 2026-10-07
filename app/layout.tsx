import type { Metadata } from 'next';
import './globals.css';
import PwaRegister from '@/components/PwaRegister';
import SmoothLinks from '@/components/SmoothLinks';
import LockRedirect from '@/components/LockRedirect';
import { getPublicSettings } from '@/lib/site-settings';
import { jsonLd, organizationSchema, websiteSchema } from '@/lib/seo/schema';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Mappingg — Live Real Estate Project Map for India & Dubai',
    template: '%s — Mappingg',
  },
  description:
    'Explore a live, interactive map of real estate projects across Pune, the Mumbai Metropolitan Region and Dubai — colour-coded by status, with developer, pricing, configuration and infrastructure details.',
  applicationName: 'Mappingg',
  icons: {
    // Small copy of the brand mark (the 629x920 original is ~250 KB — kept for OG/schema).
    icon: '/img/mappingg-icon-mark-sm.png',
    apple: '/icons/apple-touch-icon.png',
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: 'website',
    siteName: 'Mappingg',
    url: SITE_URL,
    title: 'Mappingg — Live Real Estate Project Map',
    description: 'Explore live projects, upcoming launches and infrastructure across India and Dubai.',
    images: ['/img/mappingg-icon-mark.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mappingg — Live Real Estate Project Map',
    description: 'Explore live projects, upcoming launches and infrastructure across India and Dubai.',
    images: ['/img/mappingg-icon-mark.png'],
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
  themeColor: '#1b2430',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Admin-editable SEO/analytics values (Search Console verification + GTM).
  // Falls back to the site's own IDs when the admin Settings fields are empty.
  const settings = await getPublicSettings();
  const gsc = settings.search_console_verification || 'xjmisC7LNZagrEObXyZOZoVzRQW2g72BbVjGuaBXsL8';
  const gtm = settings.gtm_container_id || 'GTM-59Q6QBP6';

  return (
    <html lang="en">
      <head>
        {/* Google Tag Manager — kept first in <head>, as Google recommends. */}
        {gtm ? (
          // eslint-disable-next-line @next/next/next-script-for-ga
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtm}');`,
            }}
          />
        ) : null}

        {/* Warm up the TLS/DNS connections to the external origins the legacy map
            apps pull from (Leaflet/MapLibre on unpkg, Google Fonts). These are
            otherwise only discovered late — after the app bundle is fetched and
            injected — so pre-connecting here removes a serial round-trip from the
            critical path and makes the map paint noticeably sooner. */}
        <link rel="preconnect" href="https://unpkg.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://unpkg.com" />
        {/* Icon font CDN (Font Awesome) used by the landing and company/legal pages. */}
        <link rel="preconnect" href="https://cdnjs.cloudflare.com" crossOrigin="anonymous" />

        {/* Google Search Console verification — set from the admin Settings page. */}
        {gsc ? <meta name="google-site-verification" content={gsc} /> : null}

      </head>
      <body>
        {/* Google Tag Manager (noscript) — immediately after the opening <body> tag. */}
        {gtm ? (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${gtm}`}
              height="0"
              width="0"
              style={{ display: 'none', visibility: 'hidden' }}
            />
          </noscript>
        ) : null}
        {/* Site-wide Organization + WebSite (with sitelinks SearchAction) graph. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(organizationSchema(), websiteSchema()) }}
        />
        <LockRedirect />
        <SmoothLinks />
        {children}
        <PwaRegister />
        {/* The "Install app" button lives in the super-admin layout only. */}
      </body>
    </html>
  );
}

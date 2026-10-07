import type { Metadata } from 'next';
import './globals.css';
import PwaRegister from '@/components/PwaRegister';
import SmoothLinks from '@/components/SmoothLinks';
import LockRedirect from '@/components/LockRedirect';
import CookieConsent from '@/components/CookieConsent';
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
  // Admin-editable SEO/analytics values (Search Console verification, GTM, GA4).
  // getPublicSettings falls back to the site's own IDs when a Settings field is
  // empty, so these always match what the SEO & Health checks report.
  const settings = await getPublicSettings();
  const gsc = settings.search_console_verification;
  const gtm = settings.gtm_container_id;
  const ga = settings.ga_measurement_id;

  return (
    <html lang="en">
      <head>
        {/* Google Tag Manager — kept first in <head>, as Google recommends. */}
        {gtm || ga ? (
          // Google Consent Mode defaults: analytics/ad cookies stay off until the
          // visitor accepts in the cookie banner (components/CookieConsent.tsx),
          // whose choice is remembered in the mg_cookie_consent cookie.
          <script
            dangerouslySetInnerHTML={{
              __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}var c=/(?:^|; )mg_cookie_consent=all/.test(document.cookie)?'granted':'denied';gtag('consent','default',{analytics_storage:c,ad_storage:c,ad_user_data:c,ad_personalization:c,functionality_storage:'granted',security_storage:'granted',wait_for_update:500});`,
            }}
          />
        ) : null}
        {ga ? (
          // Google tag (gtag.js) for GA4 — after the Consent Mode defaults above.
          // eslint-disable-next-line @next/next/next-script-for-ga
          <script async src={`https://www.googletagmanager.com/gtag/js?id=${ga}`} />
        ) : null}
        {ga ? (
          <script
            dangerouslySetInnerHTML={{
              __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ga}');`,
            }}
          />
        ) : null}
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
        <CookieConsent />
        <PwaRegister />
        {/* The "Install app" button lives in the super-admin layout only. */}
      </body>
    </html>
  );
}

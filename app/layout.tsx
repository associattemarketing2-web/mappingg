import type { Metadata } from 'next';
import './globals.css';
import PwaRegister from '@/components/PwaRegister';
import InstallPrompt from '@/components/InstallPrompt';
import SmoothLinks from '@/components/SmoothLinks';
import LockRedirect from '@/components/LockRedirect';
import { getPublicSettings } from '@/lib/site-settings';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Mappingg — Live Real Estate Project Map for Pune & MMR',
    template: '%s — Mappingg',
  },
  description:
    'Explore a live, interactive map of real estate projects across Pune and the Mumbai Metropolitan Region — colour-coded by status, with developer, pricing, configuration and infrastructure details.',
  applicationName: 'Mappingg',
  icons: {
    icon: '/img/mappingg-icon-mark.png',
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    title: 'Mappingg',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: 'website',
    siteName: 'Mappingg',
    url: SITE_URL,
    title: 'Mappingg — Live Real Estate Project Map',
    description: 'Explore live projects, upcoming launches and infrastructure across Pune and MMR.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mappingg — Live Real Estate Project Map',
    description: 'Explore live projects, upcoming launches and infrastructure across Pune and MMR.',
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
  const { search_console_verification: gsc, gtm_container_id: gtm } = await getPublicSettings();

  return (
    <html lang="en">
      <head>
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

        {/* Google Tag Manager — injected only when a container ID is configured. */}
        {gtm ? (
          // eslint-disable-next-line @next/next/next-script-for-ga
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtm}');`,
            }}
          />
        ) : null}
      </head>
      <body>
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
        <LockRedirect />
        <SmoothLinks />
        {children}
        <PwaRegister />
        <InstallPrompt />
      </body>
    </html>
  );
}

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
        {gtm || ga ? (
          // Tag loader. gtm.start is recorded now (also tells the legacy map apps
          // GTM is handled, so they never inject a second copy), but the GTM
          // script itself is fetched on the visitor's first interaction or 10 s
          // after load — it costs ~0.3–0.8 s of main-thread time on phones, so it
          // stays out of the critical loading window. GA4 is configured
          // inside the GTM container; the standalone gtag.js is only loaded when
          // no GTM container is set, so page views are never counted twice.
          // eslint-disable-next-line @next/next/next-script-for-ga
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(w,d,gtm,ga){var done=0,E=['pointerdown','pointermove','wheel','scroll','keydown','touchstart'];if(gtm)w.dataLayer.push({'gtm.start':new Date().getTime(),event:'gtm.js'});function add(src){var j=d.createElement('script');j.async=true;j.src=src;d.head.appendChild(j);}function load(){if(done)return;done=1;E.forEach(function(e){w.removeEventListener(e,load);});if(gtm)add('https://www.googletagmanager.com/gtm.js?id='+gtm);else{gtag('js',new Date());gtag('config',ga);add('https://www.googletagmanager.com/gtag/js?id='+ga);}}E.forEach(function(e){w.addEventListener(e,load,{passive:true,once:true});});function later(){setTimeout(load,10000);}if(d.readyState==='complete')later();else w.addEventListener('load',later,{once:true});})(window,document,'${gtm || ''}','${ga || ''}');`,
            }}
          />
        ) : null}

        {/* Icon font CDN (Font Awesome) used by the landing and company/legal
            pages. The map apps' own origins (unpkg, Google Fonts, tiles) are
            preconnected by <LegacyPreloads/> on the map pages only. */}
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

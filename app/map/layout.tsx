import type { Metadata } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

// SEO metadata for /map lives here; page.tsx renders the content.
export const metadata: Metadata = {
  title: 'Live Real Estate Map — Projects in Pune & MMR',
  description:
    'Explore a live, interactive map of real estate projects across Pune (Mundhwa, Kharadi, Magarpatta, Hadapsar, Viman Nagar, Wagholi, Kothrud) and the Mumbai region (Andheri, Khar, Vashi, Nerul, Kharghar, Thane, Dombivli, Palava). Colour-coded by status with developer, pricing, configuration, carpet area, possession and infrastructure details.',
  keywords: [
    'real estate map', 'property map Pune', 'projects in Mundhwa', 'Kharadi projects',
    'Magarpatta property', 'Hadapsar flats', 'MMR real estate', 'new launches Pune',
    'under construction projects', 'ready to move flats', 'Mappingg', 'Associatte Proptech',
  ],
  alternates: { canonical: `${SITE_URL}/map` },
  openGraph: {
    title: 'Mappingg Live Map — Real Estate Projects, Pune & MMR',
    description: 'Explore live projects, upcoming launches and infrastructure across Pune and the Mumbai region.',
    url: `${SITE_URL}/map`,
    images: ['/img/mappingg-icon-mark.png'],
  },
};

export default function MapLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

import type { Metadata } from 'next';
import LegacyApp from '@/components/LegacyApp';
import LegacyPreloads from '@/components/LegacyPreloads';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

export const metadata: Metadata = {
  title: '3D Project Map — Mundhwa, Pune',
  description:
    'A 3D, tilt-and-rotate view of live real estate projects and infrastructure around Mundhwa, Pune — with status, RERA and possession details.',
  keywords: [
    '3D property map Pune', 'Mundhwa projects', 'Mundhwa real estate', '3D real estate map',
    'Pune property 3D view', 'Mundhwa flats', 'projects near Mundhwa', 'Mappingg 3D',
  ],
  alternates: { canonical: `${SITE_URL}/mundhwa-map-3d` },
  openGraph: {
    type: 'website',
    title: '3D Project Map — Mundhwa, Pune',
    description: 'Explore live projects & infrastructure around Mundhwa in an interactive 3D map.',
    url: `${SITE_URL}/mundhwa-map-3d`,
    images: ['/img/mappingg-icon-mark.png'],
  },
};

export default function Map3DPage() {
  return (
    <>
      <LegacyPreloads slug="map-3d" />
      <LegacyApp slug="map-3d" />
    </>
  );
}

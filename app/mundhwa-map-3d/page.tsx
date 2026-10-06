import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';
import LegacyApp from '@/components/LegacyApp';
import LegacyPreloads from '@/components/LegacyPreloads';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

export const metadata: Metadata = buildMetadata({
  title: '3D Project Map — Mundhwa, Pune',
  description:
    'A 3D, tilt-and-rotate view of live real estate projects and infrastructure around Mundhwa, Pune — with status, RERA and possession details.',
  path: '/mundhwa-map-3d',
  keywords: [
    '3D property map Pune', 'Mundhwa projects', 'Mundhwa real estate', '3D real estate map',
    'Pune property 3D view', 'Mundhwa flats', 'projects near Mundhwa', 'Mappingg 3D',
  ],
});

export default function Map3DPage() {
  return (
    <>
      {/* The 3D app renders no heading of its own; a visually-hidden h1 gives the
          page one for search engines and screen readers (map UI unchanged). */}
      <h1 className="sr-only">3D map of real estate projects and infrastructure around Mundhwa, Pune</h1>
      <LegacyPreloads slug="map-3d" />
      <LegacyApp slug="map-3d" />
    </>
  );
}

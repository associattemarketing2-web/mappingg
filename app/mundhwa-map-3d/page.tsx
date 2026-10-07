import LegacyApp from '@/components/LegacyApp';
import LegacyPreloads from '@/components/LegacyPreloads';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

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

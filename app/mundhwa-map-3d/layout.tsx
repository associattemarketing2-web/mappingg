import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /mundhwa-map-3d lives here; page.tsx renders the content.
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

export default function MundhwaMap3dLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

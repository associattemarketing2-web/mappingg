import { NextResponse } from 'next/server';
import type { MetadataRoute } from 'next';

// Web App Manifest, served at /manifest.webmanifest.
//
// Installing the app is a super-admin tool only, so this is deliberately a plain
// route instead of app/manifest.ts (which Next links from EVERY page). Only the
// super-admin layout links it (see app/dashboard/s-admin/layout.tsx), so browsers
// offer "Install app" there and nowhere else. The service worker still precaches
// this URL, so it must stay publicly readable.
const manifest: MetadataRoute.Manifest = {
  name: 'Mappingg — Live Real Estate Project Map',
  short_name: 'Mappingg',
  description:
    'Live, interactive map of real estate projects across Pune and the Mumbai Metropolitan Region.',
  id: '/',
  start_url: '/dashboard/s-admin',
  scope: '/',
  display: 'standalone',
  orientation: 'any',
  background_color: '#ffffff',
  theme_color: '#1b2430',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

export const dynamic = 'force-static';

export function GET() {
  return NextResponse.json(manifest, {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' },
  });
}

import type { MetadataRoute } from 'next';

// Web App Manifest — makes the site installable as a PWA on Android, iOS,
// Windows, macOS and ChromeOS. Served at /manifest.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mappingg — Live Real Estate Project Map',
    short_name: 'Mappingg',
    description:
      'Live, interactive map of real estate projects across Pune and the Mumbai Metropolitan Region.',
    id: '/',
    start_url: '/',
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
}

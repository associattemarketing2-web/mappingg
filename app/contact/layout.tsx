import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /contact lives here; page.tsx renders the content.
export const metadata: Metadata = buildMetadata({
  title: 'Contact Us',
  description:
    'Get in touch with the Mappingg team at Associatte PropTech, Hadapsar, Pune.',
  path: '/contact',
});

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

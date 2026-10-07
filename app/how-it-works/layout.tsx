import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

// SEO metadata for /how-it-works lives here; page.tsx renders the content.
export const metadata: Metadata = buildMetadata({
  title: 'How It Works',
  description:
    'From project data to an intelligent map in three simple steps — connect your data, map your project, then visualise and share it. See how a project goes live on Mappingg.',
  path: '/how-it-works',
});

export default function HowItWorksLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

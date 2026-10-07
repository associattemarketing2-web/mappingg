import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';

// /signin only redirects to the home-page auth modal, so keep it out of the index.
export const metadata: Metadata = buildMetadata({
  title: 'Sign In',
  description: 'Sign in to Mappingg as a buyer, developer, channel partner or admin.',
  path: '/signin',
  noIndex: true,
});

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

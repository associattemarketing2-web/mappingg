import type { Metadata } from 'next';
import { buildSectionMetadata } from '@/lib/seo/metadata';
import { getPublicPins } from '@/lib/seo/entities';
import { projectsMeta } from '@/lib/seo/listing-meta';

// SEO metadata for /projects lives here; page.tsx renders the content (and
// overrides title/canonical for ?page=N). The cities in the title come from the
// mapped projects, so it stays true as coverage grows.
export async function generateMetadata(): Promise<Metadata> {
  return buildSectionMetadata(projectsMeta(await getPublicPins()));
}

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

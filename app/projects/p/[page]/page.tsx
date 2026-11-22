import type { Metadata } from 'next';
import ProjectsListing, { projectsPageMetadata } from '../../listing';

// /projects?page=N (N ≥ 2) — internal path for the rewrite in next.config.mjs.
// The canonical stays /projects?page=N (pagedMetadata), so this address is never
// indexed on its own. Pages past the last one get a real 404.
export const revalidate = 3600;
export const dynamic = 'force-static';

type Props = { params: { page: string } };

export function generateMetadata({ params }: Props): Promise<Metadata> {
  return projectsPageMetadata(params.page);
}

export default function ProjectsPage({ params }: Props) {
  return <ProjectsListing page={params.page} />;
}

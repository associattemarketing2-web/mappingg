import ProjectsListing from './listing';

// /projects — page 1 of the list. Pages 2+ are /projects?page=N, served by
// app/projects/p/[page] through a rewrite (next.config.mjs), so this route never
// reads searchParams and is cached like a static page.
//
// Old filter URLs (?q=, ?bhk=, ?budget=, ?size=, ?city=) now get this same page
// with its self-canonical (/projects) instead of a 308: the filters were removed
// earlier, and reading the query here would make every visit a server render.
export const revalidate = 3600;
export const dynamic = 'force-static';

export default function ProjectsIndex() {
  return <ProjectsListing page={undefined} />;
}

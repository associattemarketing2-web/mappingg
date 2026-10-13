// Which derived SEO pages should be indexed. Pages that fail stay reachable
// (useful for navigation) but render `noindex, follow` and are left out of the
// sitemap. They are NOT blocked in robots.txt, so crawlers can see the noindex.
//
// Rules (see seo-doc/THIN-PAGES-*.md for the per-URL list):
// - Locality: index with ≥ 3 projects, or with fewer when the page has its own
//   written area guide (lib/seo/locality-guides.ts) — unique, useful content.
// - Developer: index with ≥ 3 projects (a 1–2 item list adds nothing a project
//   page doesn't already say).
// - Project: index unless it has no location, price, configuration or
//   description at all (an empty placeholder page).

import { hasLocalityGuide } from './locality-guides';

export const MIN_PROJECTS_TO_INDEX = 3;

export interface IndexDecision { index: boolean; reason: string }

export function localityIndexing(slug: string, projectCount: number): IndexDecision {
  if (projectCount >= MIN_PROJECTS_TO_INDEX) return { index: true, reason: `${projectCount} projects` };
  if (hasLocalityGuide(slug)) return { index: true, reason: `${projectCount} project(s), but has a written area guide` };
  return { index: false, reason: `only ${projectCount} project(s) and no unique area guide` };
}

export function developerIndexing(projectCount: number): IndexDecision {
  return projectCount >= MIN_PROJECTS_TO_INDEX
    ? { index: true, reason: `${projectCount} projects` }
    : { index: false, reason: `only ${projectCount} project(s)` };
}

export interface ProjectContent {
  location?: string; price?: string; configuration?: string; description?: string; key_usp?: string;
}

export function projectIndexing(p: ProjectContent): IndexDecision {
  const has = (v?: string) => !!(v && v.trim());
  if (!has(p.location) && !has(p.price) && !has(p.configuration) && !has(p.description) && !has(p.key_usp)) {
    return { index: false, reason: 'no location, price, configuration or description yet' };
  }
  return { index: true, reason: 'has project details' };
}

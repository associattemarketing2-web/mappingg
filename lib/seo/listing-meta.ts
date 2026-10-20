// Titles and descriptions for the project listing pages, in one place so page 1
// (the route's layout.tsx) and page 2+ (?page=N, the route's page.tsx) match.

import type { Metadata } from 'next';
import { buildMetadata, type BuildMeta } from './metadata';
import { citiesPhrase, type Group, type Pin } from './entities';
import { TITLE_BUDGET, clip } from './project-meta';

export function projectsMeta(pins: Pin[]): BuildMeta {
  return {
    title: `Real Estate Projects in ${citiesPhrase(pins, 3)}`,
    description: `Browse ${pins.length} real estate projects in ${citiesPhrase(pins, 5)} by city, locality, developer and status, with prices, RERA numbers and possession dates.`,
    path: '/projects',
  };
}

export function statusMeta(g: Group): BuildMeta {
  const where = citiesPhrase(g.pins);
  const title = `${g.label} Projects in ${where}`;
  return {
    title: title.length <= TITLE_BUDGET ? title : `${g.label} Projects in ${citiesPhrase(g.pins, 2)}`,
    description: `Explore ${g.count} ${g.label.toLowerCase()} real estate project${g.count === 1 ? '' : 's'} in ${where} — locations, developers, pricing and configurations on Mappingg.`,
    path: `/status/${g.slug}`,
  };
}

export function typeMeta(g: Group): BuildMeta {
  const where = citiesPhrase(g.pins);
  const title = `${g.label} Projects in ${where}`;
  return {
    title: title.length <= TITLE_BUDGET ? title : `${g.label} Projects in ${citiesPhrase(g.pins, 2)}`,
    description: `Explore ${g.count} ${g.label.toLowerCase()} project${g.count === 1 ? '' : 's'} in ${where} — locations, developers, pricing and status on Mappingg.`,
    path: `/property/${g.slug}`,
  };
}

export function cityMeta(g: Group): BuildMeta {
  return {
    title: `Real Estate Projects in ${g.label}`,
    description: `Explore ${g.count} real estate project${g.count === 1 ? '' : 's'} across ${g.label} — by locality, developer and status, with an interactive map on Mappingg.`,
    path: `/cities/${g.slug}`,
  };
}

/**
 * Metadata for page N (≥ 2) of a listing: its own title and description and a
 * self-referencing canonical (each page lists different projects). Page 1 keeps
 * the layout's metadata, so this returns {} for it.
 */
export function pagedMetadata(base: BuildMeta, page: number, pages: number): Metadata {
  if (page <= 1) return {};
  return buildMetadata({
    ...base,
    title: `${base.title} — Page ${page} of ${pages}`,
    description: clip(`Page ${page} of ${pages}. ${base.description}`, 160),
    path: `${base.path}?page=${page}`,
  });
}

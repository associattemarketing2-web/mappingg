import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { paginate, type PageParam } from '@/lib/seo/paginate';
import { facetMetadata, getAllFacetPages, getLocalityFacetPage } from '@/lib/seo/facet-pages';
import FacetListing from '@/components/seo/FacetListing';

// /locations/<locality>/<facet> — e.g. /locations/mundhwa/3-bhk-flats.
// Exists only when enough projects match (lib/seo/facets.ts); otherwise 404.
export const revalidate = 3600;
export const dynamicParams = true;
export async function generateStaticParams() {
  return (await getAllFacetPages()).filter((p) => p.scope === 'locality').map((p) => ({ slug: p.place.slug, facet: p.facet.slug }));
}

type Props = { params: { slug: string; facet: string }; searchParams?: { page?: PageParam } };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const p = await getLocalityFacetPage(params.slug, params.facet);
  if (!p) notFound();
  const pg = paginate(p.pins, searchParams?.page);
  if (!pg) notFound();
  return facetMetadata(p, pg.page, pg.pages);
}

export default async function LocalityFacetPage({ params, searchParams }: Props) {
  const p = await getLocalityFacetPage(params.slug, params.facet);
  if (!p) notFound();
  const pg = paginate(p.pins, searchParams?.page);
  if (!pg) notFound();
  return <FacetListing p={p} pg={pg} />;
}

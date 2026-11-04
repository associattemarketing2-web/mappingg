import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { paginate, type PageParam } from '@/lib/seo/paginate';
import { facetMetadata, getAllFacetPages, getCityFacetPage } from '@/lib/seo/facet-pages';
import FacetListing from '@/components/seo/FacetListing';

// /cities/<city>/<facet> — e.g. /cities/pune/2-bhk-flats, /cities/pune/flats-under-1-crore.
// Exists only when enough projects match (lib/seo/facets.ts); otherwise 404.
export const revalidate = 3600;
export const dynamicParams = true;
export async function generateStaticParams() {
  return (await getAllFacetPages()).filter((p) => p.scope === 'city').map((p) => ({ city: p.place.slug, facet: p.facet.slug }));
}

type Props = { params: { city: string; facet: string }; searchParams?: { page?: PageParam } };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const p = await getCityFacetPage(params.city, params.facet);
  if (!p) notFound();
  const pg = paginate(p.pins, searchParams?.page);
  if (!pg) notFound();
  return facetMetadata(p, pg.page, pg.pages);
}

export default async function CityFacetPage({ params, searchParams }: Props) {
  const p = await getCityFacetPage(params.city, params.facet);
  if (!p) notFound();
  const pg = paginate(p.pins, searchParams?.page);
  if (!pg) notFound();
  return <FacetListing p={p} pg={pg} />;
}

import Link from 'next/link';
import { CITY_LABELS } from '@/lib/seo/entities';
import { facetHeading, getAllFacetPages } from '@/lib/seo/facet-pages';

// "Browse by BHK and budget": every city-level facet page that currently exists,
// grouped by city, as plain crawlable links (used on /cities and /property).
export default async function FacetIndex({ heading = 'Browse by BHK and budget' }: { heading?: string }) {
  const pages = (await getAllFacetPages()).filter((p) => p.scope === 'city');
  if (!pages.length) return null;
  const byCity = new Map<string, typeof pages>();
  for (const p of pages) byCity.set(p.cityKey, [...(byCity.get(p.cityKey) || []), p]);
  return (
    <section className="seo-section">
      <h2>{heading}</h2>
      <div className="seo-prose">
        <p>
          Each page lists only projects whose own configuration or published price matches — sold-out projects are
          left out, and a page appears only once at least six projects qualify.
        </p>
      </div>
      {[...byCity].map(([city, list]) => (
        <div key={city}>
          <h3>{CITY_LABELS[city as keyof typeof CITY_LABELS]}</h3>
          <div className="seo-pills">
            {list.map((p) => (
              <Link key={p.path} href={p.path}>
                {facetHeading(p.facet)}
                <b>{p.pins.length}</b>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

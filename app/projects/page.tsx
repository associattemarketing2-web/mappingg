import type { Metadata } from 'next';
import Link from 'next/link';
import { paginate, type PageParam } from '@/lib/seo/paginate';
import { notFound } from 'next/navigation';
import EntityListing from '@/components/seo/EntityListing';
import { buildMetadata } from '@/lib/seo/metadata';
import { pagedMetadata, projectsMeta } from '@/lib/seo/listing-meta';
import { getPublicPins, getLocalityGroups, getStatusGroups, getCityGroups, citiesPhrase, cityOf, type Pin } from '@/lib/seo/entities';
import { BHK_OPTIONS, BUDGET_OPTIONS, SIZE_OPTIONS, hasBhk, inBudget, inSize, matchesQuery } from '@/lib/home/finder';

export const revalidate = 3600;

type Param = string | string[] | undefined;
type Props = { searchParams?: { page?: PageParam; q?: Param; bhk?: Param; budget?: Param; size?: Param; city?: Param } };

const one = (v: Param) => (Array.isArray(v) ? v[0] : v || '').trim();

/** The search / filters from the URL (home page search, "Browse flats your way" links). Unknown values are ignored. */
function filtersOf(sp: Props['searchParams']) {
  const q = one(sp?.q).slice(0, 80);
  const bhk = BHK_OPTIONS.find((o) => o.slug === one(sp?.bhk));
  const budget = BUDGET_OPTIONS.find((o) => o.slug === one(sp?.budget));
  const size = SIZE_OPTIONS.find((o) => o.slug === one(sp?.size));
  const city = ['pune', 'mumbai'].includes(one(sp?.city)) ? one(sp?.city) : '';
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (city) params.set('city', city);
  if (bhk) params.set('bhk', bhk.slug);
  if (budget) params.set('budget', budget.slug);
  if (size) params.set('size', size.slug);
  const qs = params.toString();
  const labels = [q && `“${q}”`, city && (city === 'pune' ? 'Pune' : 'Mumbai & MMR'), bhk?.label, budget?.label, size?.label].filter(Boolean) as string[];
  const test = (p: Pin) =>
    (!q || matchesQuery(q, p.title, p.developer, p.location, p.configuration, p.rera_number)) &&
    (!city || cityOf(p) === city) &&
    (!bhk || hasBhk(p.configuration, bhk.slug)) &&
    (!budget || inBudget(p.price, budget.slug)) &&
    (!size || inSize(p.sqft, size.slug));
  return { q, bhk, budget, size, city, qs, labels, active: !!qs, test };
}

// Page 2+ (?page=N) gets its own title and self-canonical; page 1 uses the layout's.
// Search / filter results are for visitors, not search engines: noindex, canonical /projects.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const pins = await getPublicPins();
  const f = filtersOf(searchParams);
  if (f.active) {
    return buildMetadata({ title: `Search: ${f.labels.join(' · ')}`, description: projectsMeta(pins).description, path: '/projects', noIndex: true, follow: true });
  }
  const pg = paginate(pins, searchParams?.page);
  return pg ? pagedMetadata(projectsMeta(pins), pg.page, pg.pages) : {};
}

function Filters({ f }: { f: ReturnType<typeof filtersOf> }) {
  return (
    <section className="seo-section">
      <form className="seo-filters" action="/projects" method="get" role="search" aria-label="Filter projects">
        <label className="wide">
          <span>Locality, project or developer</span>
          <input type="search" name="q" defaultValue={f.q} placeholder="e.g. Kharadi, Godrej, P521…" maxLength={80} enterKeyHint="search" />
        </label>
        <label>
          <span>City</span>
          <select name="city" defaultValue={f.city}>
            <option value="">All cities</option>
            <option value="pune">Pune</option>
            <option value="mumbai">Mumbai &amp; MMR</option>
          </select>
        </label>
        <label>
          <span>BHK</span>
          <select name="bhk" defaultValue={f.bhk?.slug || ''}>
            <option value="">Any BHK</option>
            {BHK_OPTIONS.map((o) => <option key={o.slug} value={o.slug}>{o.label}</option>)}
          </select>
        </label>
        <label>
          <span>Budget</span>
          <select name="budget" defaultValue={f.budget?.slug || ''}>
            <option value="">Any budget</option>
            {BUDGET_OPTIONS.map((o) => <option key={o.slug} value={o.slug}>{o.label}</option>)}
          </select>
        </label>
        <label>
          <span>Size</span>
          <select name="size" defaultValue={f.size?.slug || ''}>
            <option value="">Any size</option>
            {SIZE_OPTIONS.map((o) => <option key={o.slug} value={o.slug}>{o.label}</option>)}
          </select>
        </label>
        <div className="seo-filters-actions">
          <button type="submit">Show projects</button>
          {f.active && <Link href="/projects">Clear filters</Link>}
        </div>
        {(f.budget || f.size) && (
          <p className="seo-filters-note">Budget and size filters only include projects that have published a price or area. Prices are as listed by the developer — confirm the latest with them.</p>
        )}
      </form>
    </section>
  );
}

export default async function ProjectsIndex({ searchParams }: Props) {
  const [all, locs, statuses, cities] = await Promise.all([getPublicPins(), getLocalityGroups(), getStatusGroups(), getCityGroups()]);
  const f = filtersOf(searchParams);
  const pins = f.active ? all.filter(f.test) : all;
  const pg = paginate(pins, searchParams?.page);
  if (!pg) notFound();
  const where = citiesPhrase(all, 4);
  const related = [
    ...cities.map((c) => ({ label: `Projects in ${c.label}`, path: `/cities/${c.slug}`, count: c.count })),
    ...statuses.map((s) => ({ label: s.label, path: `/status/${s.slug}`, count: s.count })),
    ...locs.slice(0, 10).map((l) => ({ label: l.label, path: `/locations/${l.slug}`, count: l.count })),
  ];
  return (
    <EntityListing
      crumbs={[{ name: 'Home', path: '/' }, { name: 'Projects', path: '/projects' }]}
      eyebrow={f.active ? 'Search results' : 'All projects'}
      title={f.active ? `Projects: ${f.labels.join(' · ')}` : `Real Estate Projects in ${where}`}
      lede={f.active
        ? `${pins.length} ${pins.length === 1 ? 'project matches' : 'projects match'} your search. Open a project for its price, configuration, RERA number and possession date, or enquire straight from its page.`
        : `Every project we map in ${citiesPhrase(all, 6)}, with developer, status, configuration and pricing details — and a live map to see exactly where each one is.`}
      stats={f.active ? undefined : [
        { b: all.length, span: 'Projects mapped' },
        { b: locs.length, span: 'Localities' },
      ]}
      filters={<Filters f={f} />}
      pins={pg.items}
      pagination={{ ...pg, base: f.active ? `/projects?${f.qs}` : '/projects' }}
      projectsHeading={f.active ? `Matching projects (${pins.length})` : `All projects (${pins.length})`}
      empty={f.active ? (
        <p className="seo-prose">
          No projects match all of these filters yet. Try removing one, <Link href="/projects">see all projects</Link>, or{' '}
          <Link href="/buyer-requirement">tell us what you need</Link> and our team will look for you.
        </p>
      ) : undefined}
      relatedTitle="Browse by city, status & locality"
      related={related}
      faqs={f.active ? undefined : [
        {
          q: 'How many real estate projects are listed on Mappingg?',
          a: `Mappingg currently maps ${all.length} projects in ${citiesPhrase(all, 6)}, spanning ${locs.length} localities. New projects are added regularly.`,
        },
        {
          q: 'Can I see where each project is located?',
          a: 'Yes. Every project has a pin on the live interactive map, colour-coded by status, along with a dedicated page covering its developer, configuration, pricing and possession timeline.',
        },
      ]}
    />
  );
}

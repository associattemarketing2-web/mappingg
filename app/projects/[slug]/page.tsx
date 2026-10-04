import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import SeoShell from '@/components/seo/SeoShell';
import ProjectCard from '@/components/seo/ProjectCard';
import {
  getPublicPins,
  getPinByNumber,
  primaryLocality,
  cityOf,
  statusLabel,
  statusRouteSlug,
  typeLabel,
  slugForProject,
  CITY_LABELS,
  type Pin,
} from '@/lib/seo/entities';
import { localitiesOf } from '@/lib/locality';
import { slugify, projectNumberFromSlug } from '@/lib/seo/slug';
import { buildMetadata } from '@/lib/seo/metadata';
import { projectSchema, faqSchema, videoSchema, youtubeId, jsonLd } from '@/lib/seo/schema';

const fmtDate = (d?: string) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

// Open set (grows with every new pin) → on-demand ISR so a newly-added project
// gets its page (and indexing) immediately, which is a core SEO goal. An unknown
// slug renders the 404 UI with `noindex` (so Google never indexes it); a true
// 404 status would require dynamicParams=false, which can't generate new pins on
// demand. The sitemap drives discovery of valid slugs.
export const revalidate = 600;

async function resolve(slug: string): Promise<Pin | null> {
  const n = projectNumberFromSlug(slug);
  if (n == null) return null;
  return getPinByNumber(n);
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const pin = await resolve(params.slug);
  if (!pin) return { title: 'Project not found', robots: { index: false, follow: false } };
  const loc = primaryLocality(pin);
  const city = CITY_LABELS[cityOf(pin)];
  const name = pin.title || `Project #${pin.number}`;
  const where = [loc, city].filter(Boolean).join(', ');
  const title = where ? `${name} in ${where} | Price, Location & Details` : `${name} | Price, Location & Details`;
  const bits = [
    pin.developer ? `by ${pin.developer}` : '',
    pin.configuration || '',
    pin.status ? statusLabel(pin.status) : '',
  ].filter(Boolean).join(', ');
  const description =
    (pin.key_usp || pin.description || '').toString().slice(0, 150).trim() ||
    `Explore ${name}${where ? ` in ${where}` : ''}${bits ? ` — ${bits}` : ''}. View location, configuration, pricing and project details on Mappingg.`;
  return buildMetadata({
    title,
    description,
    path: `/projects/${slugForProject(pin)}`,
    image: pin.image && /^(https?:|\/api\/)/.test(pin.image) ? pin.image : undefined,
    type: 'article',
    keywords: [name, pin.developer, loc, city, pin.type].filter(Boolean) as string[],
  });
}

const specRows = (pin: Pin): { k: string; v: string }[] =>
  [
    { k: 'Developer', v: pin.developer || '' },
    { k: 'Status', v: pin.status ? statusLabel(pin.status) : '' },
    { k: 'Property type', v: pin.type || '' },
    { k: 'Configuration', v: pin.configuration || '' },
    { k: 'Carpet / built-up', v: pin.sqft ? `${pin.sqft} sq.ft` : '' },
    { k: 'Price', v: pin.price || '' },
    { k: 'Possession', v: pin.possession_timeline || '' },
    { k: 'Launch', v: pin.launch_date || '' },
  ].filter((r) => r.v);

export default async function ProjectDetail({ params }: { params: { slug: string } }) {
  const pin = await resolve(params.slug);
  if (!pin) notFound();

  const loc = primaryLocality(pin);
  const cityKey = cityOf(pin);
  const city = CITY_LABELS[cityKey];
  const name = pin.title || `Project #${pin.number}`;
  const hasCover = pin.image && /^(https?:|\/api\/|data:)/.test(pin.image);

  // Related: other projects in the same locality, then by the same developer.
  const all = await getPublicPins();
  const nearby = all
    .filter((p) => p.number !== pin.number && primaryLocality(p) === loc)
    .slice(0, 6);
  const byDev = pin.developer
    ? all.filter((p) => p.number !== pin.number && p.developer === pin.developer && primaryLocality(p) !== loc).slice(0, 3)
    : [];
  const related = [...nearby, ...byDev].slice(0, 6);

  const crumbs = [
    { name: 'Home', path: '/' },
    { name: city, path: `/cities/${cityKey}` },
    ...(loc ? [{ name: loc, path: `/locations/${slugify(loc)}` }] : []),
    { name, path: `/projects/${slugForProject(pin)}` },
  ];

  const faqs = [
    loc && {
      q: `Where is ${name} located?`,
      a: `${name} is located in ${loc}${city ? `, ${city}` : ''}. You can see its exact position, surrounding infrastructure and nearby projects on the Mappingg live map.`,
    },
    pin.developer && { q: `Who is the developer of ${name}?`, a: `${name} is developed by ${pin.developer}.` },
    pin.status && {
      q: `What is the current status of ${name}?`,
      a: `${name} is currently ${statusLabel(pin.status).toLowerCase()}${pin.possession_timeline ? `, with possession ${pin.possession_timeline}` : ''}.`,
    },
  ].filter(Boolean) as { q: string; a: string }[];

  const schema = projectSchema({
    name,
    description: (pin.description || pin.key_usp || '').toString(),
    url: `/projects/${slugForProject(pin)}`,
    image: hasCover ? pin.image : undefined,
    locality: loc,
    city,
    lat: pin.lat,
    lng: pin.lng,
    developer: pin.developer,
  });

  const vid = youtubeId(pin.youtube_video_url);
  const schemas: object[] = [schema];
  if (faqs.length) schemas.push(faqSchema(faqs));
  if (vid) schemas.push(videoSchema({ id: vid, name: `${name} — project walkthrough`, description: pin.key_usp || pin.description, uploadDate: pin.created_at }));

  // Contextual internal links out to every related entity hub (not keyword spam).
  const statusSlug = statusRouteSlug(pin.status);
  const quickLinks: { label: string; path: string }[] = [
    ...(pin.developer ? [{ label: `More by ${pin.developer}`, path: `/developers/${slugify(pin.developer)}` }] : []),
    ...(statusSlug ? [{ label: `${statusLabel(pin.status)} projects`, path: `/status/${statusSlug}` }] : []),
    ...(pin.type ? [{ label: `${typeLabel(pin.type)} projects`, path: `/property/${slugify(pin.type)}` }] : []),
    ...(loc ? [{ label: `All projects in ${loc}`, path: `/locations/${slugify(loc)}` }] : []),
    { label: `Real estate in ${city}`, path: `/cities/${cityKey}` },
  ];
  // Other localities this project touches (projects often span 2 areas).
  const otherLocs = localitiesOf(pin.location)
    .filter((l) => l !== loc)
    .map((l) => ({ label: l, path: `/locations/${slugify(l)}` }));

  const specs = specRows(pin);

  return (
    <SeoShell crumbs={crumbs}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(...schemas) }} />

      <header className="seo-hero">
        <div className="eyebrow">{[loc, city].filter(Boolean).join(' · ') || 'Project'}</div>
        <h1>{name}</h1>
        {pin.key_usp && <p className="lede">{pin.key_usp}</p>}
        {pin.updated_at && (
          <p style={{ fontSize: '0.82rem', color: '#8a94a0', marginTop: 10 }}>
            Last updated: {fmtDate(pin.updated_at)}
          </p>
        )}
      </header>

      <div className="seo-detail-head">
        <div>
          {hasCover && (
            // eslint-disable-next-line @next/next/no-img-element -- optimized WebP via /api/media; next/image disabled site-wide (images.unoptimized)
            <img
              className="cover"
              src={pin.image!}
              alt={`${name}${pin.developer ? ` by ${pin.developer}` : ''}${loc ? ` in ${loc}, ${city}` : ''}`}
              width={720}
              height={450}
              decoding="async"
            />
          )}
          {pin.description && (
            <div className="seo-section seo-prose">
              <h2>About {name}</h2>
              <p>{pin.description}</p>
            </div>
          )}
          <div className="seo-cta">
            <Link className="primary" href={`/contact?project=${encodeURIComponent(name)}`}>Enquire about this project</Link>
            <Link className="ghost" href="/map">See on live map</Link>
          </div>
        </div>

        <div>
          {specs.length > 0 && (
            <ul className="seo-specs" aria-label="Project details">
              {specs.map((r) => (
                <li key={r.k}>
                  <span className="k">{r.k}</span>
                  <span className="v">{r.v}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {vid && (
        <section className="seo-section">
          <h2>Project walkthrough</h2>
          <a
            href={`https://www.youtube.com/watch?v=${vid}`}
            target="_blank"
            rel="noopener"
            aria-label={`Watch the ${name} walkthrough on YouTube`}
            style={{ display: 'block', maxWidth: 560 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- YouTube thumbnail; lazy, click-to-play (no heavy embed on load) */}
            <img
              src={`https://i.ytimg.com/vi/${vid}/hqdefault.jpg`}
              alt={`${name} video walkthrough`}
              width={560}
              height={315}
              loading="lazy"
              decoding="async"
              style={{ width: '100%', height: 'auto', borderRadius: 12 }}
            />
          </a>
        </section>
      )}

      <section className="seo-section">
        <h2>Explore related</h2>
        <div className="seo-pills">
          {[...quickLinks, ...otherLocs].map((l) => (
            <Link key={l.path} href={l.path}>{l.label}</Link>
          ))}
        </div>
      </section>

      {related.length > 0 && (
        <section className="seo-section">
          <h2>{loc ? `Other projects in ${loc}` : 'Related projects'}</h2>
          <div className="seo-grid">
            {related.map((p) => (
              <ProjectCard key={p.id} pin={p} />
            ))}
          </div>
        </section>
      )}

      {faqs.length > 0 && (
        <section className="seo-section seo-faq">
          <h2>Frequently asked questions</h2>
          {faqs.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </section>
      )}
    </SeoShell>
  );
}

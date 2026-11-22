import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import SeoShell from '@/components/seo/SeoShell';
import ProjectCard from '@/components/seo/ProjectCard';
import {
  getPublicPins,
  getPinBySlug,
  duplicateRedirectSlug,
  primaryLocality,
  cityOf,
  statusLabel,
  statusRouteSlug,
  typeLabel,
  slugForProject,
  getLocalityGroups,
  getDeveloperGroups,
  CITY_LABELS,
  type Pin,
} from '@/lib/seo/entities';
import { developerIndexing, localityIndexing } from '@/lib/seo/indexing';
import { slugify } from '@/lib/seo/slug';
import { toCard } from '@/lib/home/cards';
import { parsePriceLakh } from '@/lib/home/finder';
import { projectSchema, faqSchema, videoSchema, youtubeId, jsonLd } from '@/lib/seo/schema';
import { projectFaqs, projectSummary, reraNumber, reraRegistry } from '@/lib/seo/project-meta';
import TrackOnView from '@/components/TrackOnView';
import { withSqft } from '@/lib/area';
import { getProjectPhotos, sized } from '@/lib/seo/project-media';
import { publicImageUrl } from '@/lib/seo/public-media';

const fmtDate = (d?: string) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

// Open set (grows with every new pin) → on-demand ISR so a newly-added project
// gets its page (and indexing) immediately, which is a core SEO goal.
// Not-found and redirect decisions are made in this route's layout.tsx (generateMetadata), which runs
// before the response starts streaming — so they produce a real 404 / 308
// status. (The root loading.tsx streams every page, so a notFound() thrown only
// in the page body would arrive after a 200 had already been sent.)
export const revalidate = 3600;
// Without this, Next 14 built this route as dynamic (ƒ): every project page view
// and every Googlebot fetch was a fresh server render sent `private, no-store`
// (crawl: p90 2.0 s, worst 7.7 s). The page reads no cookies/headers/searchParams
// (verified with dynamic = 'error' on a production build), so it is rendered once
// and refreshed by ISR; pin writes clear the shared data cache it reads from.
export const dynamic = 'force-static';

const specRows = (pin: Pin): { k: string; v: string }[] =>
  [
    { k: 'Developer', v: pin.developer || '' },
    { k: 'Status', v: pin.status ? statusLabel(pin.status) : '' },
    { k: 'Property type', v: pin.type || '' },
    { k: 'Configuration', v: pin.configuration || '' },
    { k: 'Carpet / built-up', v: withSqft(pin.sqft) },
    { k: 'Price', v: pin.price || '' },
    { k: 'Possession', v: pin.possession_timeline || '' },
    { k: 'Launch', v: pin.launch_date || '' },
    // Names the issuing registry ("MahaRERA registration", "RERA Karnataka registration").
    { k: `${reraRegistry(pin.rera_number).name} registration`, v: reraNumber(pin.rera_number) },
  ].filter((r) => r.v);

export default async function ProjectDetail({ params }: { params: { slug: string } }) {
  const pin = await getPinBySlug(params.slug);
  if (!pin) {
    // Normally already handled by generateMetadata; repeated here because the page
    // can finish first on an uncached request.
    const kept = await duplicateRedirectSlug(params.slug);
    if (kept) permanentRedirect(`/projects/${kept}`);
    notFound();
  }

  const loc = primaryLocality(pin);
  const cityKey = cityOf(pin);
  const city = CITY_LABELS[cityKey];
  const name = pin.title || `Project #${pin.number}`;
  const hasCover = pin.image && /^(https?:|\/api\/|data:)/.test(pin.image);
  // Pin image = usually the developer's logo. Served from its crawlable /media/ address.
  const logoSrc = hasCover ? publicImageUrl(pin.image) : undefined;
  // Official project photos (collected from the developer's site), when we have them.
  const photos = await getProjectPhotos(pin.intake_project_id);
  const photoAlt = (i: number) => `${name}${loc ? `, ${loc}` : ''} — project photo ${i + 1}`;

  // Related: other projects in the same locality, then by the same developer.
  const all = await getPublicPins();
  const nearby = all
    .filter((p) => p.number !== pin.number && primaryLocality(p) === loc)
    .slice(0, 6);
  const byDev = pin.developer
    ? all.filter((p) => p.number !== pin.number && p.developer === pin.developer && primaryLocality(p) !== loc).slice(0, 3)
    : [];
  const related = [...nearby, ...byDev].slice(0, 6);

  // Facts-only overview (each sentence appears only when its field is filled).
  const overview = projectSummary(pin, loc, city, {
    sameLocality: loc ? all.filter((p) => p.number !== pin.number && primaryLocality(p) === loc).length : 0,
    sameDeveloper: pin.developer ? all.filter((p) => p.number !== pin.number && p.developer === pin.developer).length : 0,
  });

  // Locality / developer hubs this project belongs to — linked only when that hub is
  // indexable itself (lib/seo/indexing.ts), so links never point at thin pages.
  const [locGroups, devGroups] = await Promise.all([getLocalityGroups(), getDeveloperGroups()]);
  const locHub = loc ? locGroups.find((g) => g.slug === slugify(loc)) : undefined;
  const locHubOk = !!locHub && localityIndexing(locHub.slug, locHub.count).index;
  const devHub = pin.developer ? devGroups.find((g) => g.slug === slugify(pin.developer!)) : undefined;
  const devHubOk = !!devHub && developerIndexing(devHub.count).index;

  const crumbs = [
    { name: 'Home', path: '/' },
    ...(locHubOk ? [{ name: loc, path: `/locations/${locHub!.slug}` }] : []),
    { name, path: `/projects/${slugForProject(pin)}` },
  ];

  // Every answer comes from a field shown on this page (lib/seo/project-meta.ts).
  const faqs = projectFaqs(pin, loc, city);

  const listedPrice = parsePriceLakh(pin.price);
  const schema = projectSchema({
    name,
    description: (pin.description || pin.key_usp || '').toString(),
    url: `/projects/${slugForProject(pin)}`,
    // Real photos first; the logo only when there are none.
    image: photos.gallery.length ? photos.gallery.map((g) => sized(g, 1200)) : logoSrc,
    locality: loc,
    city,
    lat: pin.lat,
    lng: pin.lng,
    reraNumber: reraNumber(pin.rera_number),
    // Same parser as the price shown on the page. Above ₹50 Cr is left out: those
    // listings were flagged as likely Lakh/Crore mix-ups (seo-doc/PROJECT-DATA-AUDIT.md D-4).
    priceInr: listedPrice && listedPrice.max <= 5000
      ? { low: Math.round(listedPrice.min * 1e5), high: Math.round(listedPrice.max * 1e5) }
      : undefined,
  });

  const vid = youtubeId(pin.youtube_video_url);
  const schemas: object[] = [schema];
  if (faqs.length) schemas.push(faqSchema(faqs));
  if (vid) schemas.push(videoSchema({ id: vid, name: `${name} — project walkthrough`, description: pin.key_usp || pin.description, uploadDate: pin.created_at }));

  // Contextual internal links out to every related entity hub (not keyword spam).
  const statusSlug = statusRouteSlug(pin.status);
  const quickLinks: { label: string; path: string }[] = [
    ...(locHubOk ? [{ label: `All projects in ${loc}`, path: `/locations/${locHub!.slug}` }] : []),
    ...(devHubOk ? [{ label: `More by ${pin.developer}`, path: `/developers/${devHub!.slug}` }] : []),
    ...(statusSlug ? [{ label: `${statusLabel(pin.status)} projects`, path: `/status/${statusSlug}` }] : []),
    ...(pin.type ? [{ label: `${typeLabel(pin.type)} projects`, path: `/property/${slugify(pin.type)}` }] : []),
  ];

  const specs = specRows(pin);
  // Key facts for the top of the page — same rules as the home cards: only
  // values that parse cleanly, area labelled "carpet" only when the source says so.
  const card = toCard(pin);
  const keyFacts = [
    card.price && { k: 'Price', v: card.price },
    card.config && { k: 'Configuration', v: card.config },
    card.area && { k: 'Area', v: card.area },
    card.possession && { k: 'Possession', v: card.possession },
  ].filter(Boolean) as { k: string; v: string }[];
  const enquireHref = `/contact?project=${encodeURIComponent(name)}&pin=${pin.number}`;
  const mapHref = `/map?pin=${encodeURIComponent(pin.id)}`;
  const status = (pin.status || '').toLowerCase();
  const rera = reraNumber(pin.rera_number);
  // "Tower | 1 BHK homes | Lobby" (or one per line) → a bulleted list.
  const highlights = (pin.key_usp || '').split(/\s*(?:\||\n|•)\s*/).map((h) => h.trim()).filter(Boolean).slice(0, 8);
  // Drop the empty "()" left in descriptions whose RERA id was never filled in.
  const about = (pin.description || '').replace(/\s*\(\s*\)/g, '').trim();

  return (
    <SeoShell crumbs={crumbs}>
      <TrackOnView event="view_item" params={{ item_id: pin.number, item_name: name, locality: loc, city: cityKey }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(...schemas) }} />

      <header className="pd-hero">
        <div className="pd-hero-top">
          {hasCover && (
            // The pin image is usually the developer's logo: shown whole on white, never cropped.
            <div className="pd-logo">
              {/* eslint-disable-next-line @next/next/no-img-element -- optimized WebP via /api/media; next/image disabled site-wide (images.unoptimized) */}
              <img
                src={logoSrc!}
                alt={`${name}${pin.developer ? ` by ${pin.developer}` : ''}${loc ? ` in ${loc}, ${city}` : ''}`}
                width={160}
                height={160}
                decoding="async"
                fetchPriority="high"
              />
            </div>
          )}
          <div className="pd-hero-copy">
            <div className="pd-tags">
              {pin.status && <span className={`pd-status st-${status}`}><i aria-hidden="true" />{statusLabel(pin.status)}</span>}
              {pin.type && <span className="pd-tag">{typeLabel(pin.type)}</span>}
              {rera && <span className="pd-tag pd-tag-rera"><i className="fas fa-circle-check" aria-hidden="true" /> RERA</span>}
            </div>
            <h1>{name}</h1>
            <p className="pd-where">
              <i className="fas fa-location-dot" aria-hidden="true" />
              <span>
                {[loc, city].filter(Boolean).join(', ') || 'Location on the live map'}
                {pin.developer && <> · by <b>{pin.developer}</b></>}
              </span>
            </p>
          </div>
        </div>

        {keyFacts.length > 0 && (
          <dl className="pd-facts">
            {keyFacts.map((f) => (
              <div key={f.k} className={f.k === 'Price' ? 'price' : undefined}>
                <dt>{f.k}</dt>
                <dd>{f.v}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="pd-cta">
          <Link className="pd-btn pd-btn-solid" href={enquireHref}>
            Enquire now <i className="fas fa-arrow-right" aria-hidden="true" />
          </Link>
          <Link className="pd-btn pd-btn-line" href={mapHref}>
            <i className="fas fa-map-location-dot" aria-hidden="true" /> See on live map
          </Link>
        </div>
        {pin.updated_at && (
          <p className="pd-updated">
            Last updated {fmtDate(pin.updated_at)} · <Link href="/data-sources">How we source and check project data</Link>
          </p>
        )}
      </header>

      <div className="pd-body">
        <div className="pd-main">
          {highlights.length > 0 && (
            <section className="pd-card">
              <h2>Highlights</h2>
              <ul className="pd-highlights">
                {highlights.map((h) => (
                  <li key={h}><i className="fas fa-check" aria-hidden="true" />{h}</li>
                ))}
              </ul>
            </section>
          )}
          <section className="pd-card seo-prose">
            <h2>{name} overview</h2>
            <p>{overview.join(' ')}</p>
          </section>
          {about && (
            <section className="pd-card seo-prose">
              <h2>About {name}</h2>
              <p>{about}</p>
            </section>
          )}
        </div>

        {specs.length > 0 && (
          <aside className="pd-side">
            <div className="pd-card pd-specs-card">
              <h2>Project details</h2>
              <ul className="pd-specs" aria-label="Project details">
                {specs.map((r) => (
                  <li key={r.k}>
                    <span className="k">{r.k}</span>
                    <span className="v">{r.v}</span>
                  </li>
                ))}
              </ul>
              <Link className="pd-btn pd-btn-solid pd-btn-block" href={enquireHref}>
                Enquire about this project
              </Link>
            </div>
          </aside>
        )}
      </div>

      {/* Official photos come after the overview: placed above it they competed with the
          text and fonts of the first screen on slow mobile networks (Lighthouse: LCP +1 s). */}
      {photos.cover && (
        <section className="seo-section pd-gallery">
          <h2>{name} photos</h2>
          {/* Fixed-ratio boxes: no layout shift while the photos load. WebP sizes come from the storage handler (?w=). */}
          {/* eslint-disable-next-line @next/next/no-img-element -- next/image is disabled site-wide (images.unoptimized); sized WebP via ?w= */}
          <img
            className="pd-gallery-cover"
            src={sized(photos.cover, 960)}
            srcSet={`${sized(photos.cover, 480)} 480w, ${sized(photos.cover, 720)} 720w, ${sized(photos.cover, 960)} 960w, ${sized(photos.cover, 1400)} 1400w`}
            sizes="(max-width: 720px) 100vw, 860px"
            alt={photoAlt(0)}
            width={960}
            height={540}
            // Not high priority: the page's largest paint is its text, and an eager
            // photo competed with the CSS/fonts that text needs (measured: LCP +1.1 s).
            loading="lazy"
            decoding="async"
          />
          {photos.gallery.length > 1 && (
            <ul className="pd-gallery-strip">
              {/* 4 thumbnails (≈10 KB each): a short page loads "lazy" images right away,
                  and 8 larger ones slowed the first screen on mobile. All photos stay in the schema. */}
              {photos.gallery.slice(1, 5).map((g, i) => (
                <li key={g}>
                  <a href={sized(g, 1400)} target="_blank" rel="noopener">
                    {/* eslint-disable-next-line @next/next/no-img-element -- lazy WebP thumbnail via ?w= */}
                    <img src={sized(g, 320)} alt={photoAlt(i + 1)} width={150} height={100} loading="lazy" decoding="async" />
                  </a>
                </li>
              ))}
            </ul>
          )}
          {photos.gallery.length > 5 && (
            <p className="pd-gallery-more">
              More photos:{' '}
              {photos.gallery.slice(5).map((g, i) => (
                <a key={g} href={sized(g, 1400)} target="_blank" rel="noopener" aria-label={`${photoAlt(i + 5)} (opens full size)`}>{i + 6}</a>
              ))}
            </p>
          )}
          <p className="pd-gallery-note">Photos: official project material published by the developer.</p>
        </section>
      )}

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
          {quickLinks.map((l) => (
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

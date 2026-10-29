import Link from 'next/link';
import SeoShell from '@/components/seo/SeoShell';
import ProjectCard from '@/components/seo/ProjectCard';
import type { Pin } from '@/lib/seo/entities';
import { slugForProject } from '@/lib/seo/entities';
import { itemListSchema, faqSchema, jsonLd } from '@/lib/seo/schema';
import Pager from '@/components/seo/Pager';

export interface RelatedPill {
  label: string;
  path: string;
  count?: number;
}

// Reusable template for every "list of projects" page — locations, developers,
// cities, status and property type. Server-rendered, emits ItemList + FAQ
// JSON-LD, and carries internal links out to related entities (never orphaned).
export default function EntityListing(props: {
  crumbs: { name: string; path: string }[];
  eyebrow: string;
  title: string;
  lede: string;
  stats?: { b: string | number; span: string }[];
  prose?: React.ReactNode;
  pins: Pin[];
  projectsHeading?: string;
  relatedTitle?: string;
  related?: RelatedPill[];
  faqs?: { q: string; a: string }[];
  /** Shown between the intro and the project list (e.g. the /projects filters). */
  filters?: React.ReactNode;
  /** Shown instead of the default text when the list is empty. */
  empty?: React.ReactNode;
  /** For long lists: `pins` is this page's slice; intro and FAQs show on page 1 only. */
  pagination?: { page: number; pages: number; total: number; from: number; base: string };
}) {
  const { pins, pagination: pg } = props;
  const first = !pg || pg.page === 1;
  const faqs = first ? props.faqs : undefined;
  const listItems = pins.map((p) => ({
    name: p.title || `Project #${p.number}`,
    path: `/projects/${slugForProject(p)}`,
  }));
  const schemas: object[] = [];
  if (listItems.length) schemas.push(itemListSchema(listItems));
  if (faqs && faqs.length) schemas.push(faqSchema(faqs));

  return (
    <SeoShell crumbs={props.crumbs}>
      {schemas.length > 0 && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(...schemas) }} />
      )}

      <header className="seo-hero">
        <div className="eyebrow">{props.eyebrow}</div>
        <h1>{props.title}</h1>
        <p className="lede">{props.lede}</p>
        {props.stats && props.stats.length > 0 && (
          <div className="stats">
            {props.stats.map((s) => (
              <div key={s.span}>
                <b>{s.b}</b>
                <span>{s.span}</span>
              </div>
            ))}
          </div>
        )}
      </header>

      {first && props.prose && (
        <section className="seo-section">
          <div className="seo-prose">{props.prose}</div>
        </section>
      )}

      {props.filters}

      <section className="seo-section">
        <h2>{props.projectsHeading || `Projects (${pins.length})`}</h2>
        {pg && pg.pages > 1 && (
          <p className="seo-range">
            Showing {pg.from}–{pg.from + pins.length - 1} of {pg.total} · page {pg.page} of {pg.pages}
          </p>
        )}
        {pins.length > 0 ? (
          <div className="seo-grid">
            {pins.map((p) => (
              <ProjectCard key={p.id} pin={p} />
            ))}
          </div>
        ) : (
          props.empty || <p className="seo-prose">No projects listed here yet. Explore the <Link href="/map">live map</Link>.</p>
        )}
        {pg && <Pager base={pg.base} page={pg.page} pages={pg.pages} label="Project list pages" />}
      </section>

      {props.related && props.related.length > 0 && (
        <section className="seo-section">
          <h2>{props.relatedTitle || 'Explore more'}</h2>
          <div className="seo-pills">
            {props.related.map((r) => (
              <Link key={r.path} href={r.path}>
                {r.label}
                {typeof r.count === 'number' && <b>{r.count}</b>}
              </Link>
            ))}
          </div>
        </section>
      )}

      {faqs && faqs.length > 0 && (
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

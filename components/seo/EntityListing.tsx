import Link from 'next/link';
import SeoShell from '@/components/seo/SeoShell';
import ProjectCard from '@/components/seo/ProjectCard';
import type { Pin } from '@/lib/seo/entities';
import { slugForProject } from '@/lib/seo/entities';
import { itemListSchema, faqSchema, jsonLd } from '@/lib/seo/schema';

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
}) {
  const { pins } = props;
  const listItems = pins.map((p) => ({
    name: p.title || `Project #${p.number}`,
    path: `/projects/${slugForProject(p)}`,
  }));
  const schemas: object[] = [];
  if (listItems.length) schemas.push(itemListSchema(listItems));
  if (props.faqs && props.faqs.length) schemas.push(faqSchema(props.faqs));

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

      {props.prose && (
        <section className="seo-section">
          <div className="seo-prose">{props.prose}</div>
        </section>
      )}

      <section className="seo-section">
        <h2>{props.projectsHeading || `Projects (${pins.length})`}</h2>
        {pins.length > 0 ? (
          <div className="seo-grid">
            {pins.map((p) => (
              <ProjectCard key={p.id} pin={p} />
            ))}
          </div>
        ) : (
          <p className="seo-prose">No projects listed here yet. Explore the <Link href="/map">live map</Link>.</p>
        )}
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

      {props.faqs && props.faqs.length > 0 && (
        <section className="seo-section seo-faq">
          <h2>Frequently asked questions</h2>
          {props.faqs.map((f) => (
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

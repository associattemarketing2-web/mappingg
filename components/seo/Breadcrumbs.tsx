import Link from 'next/link';
import { breadcrumbSchema, jsonLd } from '@/lib/seo/schema';

// Visible breadcrumb trail + matching BreadcrumbList JSON-LD. The last item is
// the current page and is rendered as plain text (not a link).
export default function Breadcrumbs({ items }: { items: { name: string; path: string }[] }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="seo-crumbs">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbSchema(items)) }} />
      <ol>
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={it.path}>
              {last ? <span aria-current="page">{it.name}</span> : <Link href={it.path}>{it.name}</Link>}
              {!last && <span className="sep" aria-hidden="true">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

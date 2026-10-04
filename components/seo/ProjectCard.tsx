import Link from 'next/link';
import type { Pin } from '@/lib/seo/entities';
import { slugForProject, primaryLocality, statusLabel } from '@/lib/seo/entities';

// Crawlable project card used on every listing page. Server-rendered HTML (no
// client JS), text-only (no heavy base64 images) so listings stay fast.
export default function ProjectCard({ pin }: { pin: Pin }) {
  const loc = primaryLocality(pin);
  const status = (pin.status || '').toLowerCase();
  return (
    <Link href={`/projects/${slugForProject(pin)}`} className="seo-card">
      <h3 className="title">{pin.title || `Project #${pin.number}`}</h3>
      <p className="meta">
        {[pin.developer, loc].filter(Boolean).join(' · ') || 'Real estate project'}
      </p>
      {pin.key_usp && <p className="usp">{pin.key_usp}</p>}
      <div className="chips">
        {pin.status && <span className={`chip status-${status}`}>{statusLabel(pin.status)}</span>}
        {pin.type && <span className="chip">{pin.type}</span>}
        {pin.configuration && <span className="chip">{pin.configuration}</span>}
      </div>
    </Link>
  );
}

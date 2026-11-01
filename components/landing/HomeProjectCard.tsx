import type { ProjectCardData } from '@/lib/home/cards';

// Project card for the home page carousels ("Featured projects", "Projects near
// you"): picture, status, name, place, price, BHK and RERA. "View Project" opens
// the "Enquire now" popup (ProjectQuickView); with no JavaScript it goes to the
// project's own page. Plain markup with no hooks, so server and client sections
// both render it. `photo` is a real project photo when one is known; otherwise
// the pin's image (usually the developer's logo) is shown whole on white.
const STATUS_CLASS: Record<string, string> = {
  'Ready to Move': 'st-ready',
  'Under Construction': 'st-uc',
  Upcoming: 'st-up',
  Sold: 'st-sold',
};

export default function HomeProjectCard({ card, distanceKm, photo }: { card: ProjectCardData; distanceKm?: number; photo?: string }) {
  const where = [card.locality, card.city].filter(Boolean).join(', ');
  const img = photo || card.image;
  const st = STATUS_CLASS[card.status] || 'st-other';
  return (
    <article className="hf-card">
      <a className={`hf-card-media${photo ? ' photo' : ''}`} href={card.href} tabIndex={-1} aria-hidden="true">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element -- /api/media already serves a resized, cached WebP
          <img src={img} alt="" width={320} height={200} loading="lazy" decoding="async" />
        ) : (
          <span className="hf-card-ph"><i className="fas fa-building" /></span>
        )}
        {card.status && <span className={`hf-card-status ${st}`}><i aria-hidden="true" />{card.status}</span>}
      </a>
      <div className="hf-card-body">
        <h3><a href={card.href}>{card.title}</a></h3>
        <p className="hf-card-where">
          {where || 'Location on map'}
          {typeof distanceKm === 'number' && <span className="hf-dist"> · {distanceKm < 1 ? '<1 km' : `${distanceKm} km`}</span>}
        </p>
        <p className="hf-card-price">{card.price || 'Price on request'}</p>
        <p className="hf-card-bhk">{card.bhk || card.area || ' '}</p>
        <div className="hf-card-tags">
          {card.rera && <span className="t-rera" title={`RERA ${card.rera}`}>RERA</span>}
          {card.possession && card.status !== 'Ready to Move' && <span className="t-pos">{card.possession}</span>}
        </div>
        <a
          className="hf-btn hf-btn-solid hf-card-cta"
          href={card.href}
          data-quickview={card.number}
          aria-label={`View ${card.title}`}
        >
          View Project <i className="fas fa-arrow-right" aria-hidden="true" />
        </a>
      </div>
    </article>
  );
}

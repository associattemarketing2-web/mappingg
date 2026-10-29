import type { ProjectCardData } from '@/lib/home/cards';

// Compact project card for the home page carousels: picture, name, place and
// the two facts buyers compare first (price, BHK). Everything else lives in the
// "Enquire now" popup (ProjectQuickView), which this card's button opens; with
// no JavaScript the button still goes to the contact form for this project.
// Plain markup with no hooks, so server and client sections both render it.
export default function HomeProjectCard({ card, distanceKm }: { card: ProjectCardData; distanceKm?: number }) {
  const where = [card.locality, card.city].filter(Boolean).join(', ');
  const facts = [card.price, card.bhk].filter(Boolean).join(' · ');
  return (
    <article className="hf-card">
      <a className="hf-card-media" href={card.href} tabIndex={-1} aria-hidden="true">
        {card.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- /api/media already serves a resized, cached WebP
          <img src={card.image} alt="" width={320} height={180} loading="lazy" decoding="async" />
        ) : (
          <span className="hf-card-ph"><i className="fas fa-building" /></span>
        )}
        {card.status && <span className="hf-card-status">{card.status}</span>}
      </a>
      <div className="hf-card-body">
        <h3><a href={card.href}>{card.title}</a></h3>
        <p className="hf-card-where">
          {where || 'Location on map'}
          {typeof distanceKm === 'number' && <span className="hf-dist"> · {distanceKm < 1 ? '<1 km' : `${distanceKm} km`}</span>}
        </p>
        <p className="hf-card-facts">{facts || 'Price on enquiry'}</p>
        <a
          className="hf-btn hf-btn-solid hf-card-cta"
          href={`/contact?project=${encodeURIComponent(card.title)}&pin=${card.number}`}
          data-quickview={card.number}
          aria-label={`Enquire about ${card.title}`}
        >
          Enquire now
        </a>
      </div>
    </article>
  );
}

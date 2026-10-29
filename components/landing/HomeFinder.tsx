import type { ProjectCardData } from '@/lib/home/cards';
import { completeness } from '@/lib/home/cards';
import { localityOptions } from '@/lib/home/nearby';
import { BHK_OPTIONS, BUDGET_OPTIONS, SIZE_OPTIONS } from '@/lib/home/finder';
import type { BlogPost } from '@/lib/blog';
import HomeProjectCard from './HomeProjectCard';
import NearbyProjects from './NearbyProjects';
import Carousel from './Carousel';
import ProjectQuickView from './ProjectQuickView';

// The home buyer's path, right under the hero: projects near you → popular
// localities → featured projects → browse by BHK / budget / size → buying
// guides → talk to us. Server-rendered from the same cached project cards the
// rest of the site uses; only "Projects near you" runs in the browser.

const HUBS = ['Pune', 'Mumbai'];

export default function HomeFinder({ cards, posts }: { cards: ProjectCardData[]; posts: BlogPost[] }) {
  const homes = cards.filter((c) => c.residential);
  const localities = localityOptions(cards, undefined, 3).slice(0, 80);
  const popular = HUBS.map((city) => ({ city, items: localityOptions(cards, [city], 3, { localitiesOnly: true }).slice(0, 10) })).filter((g) => g.items.length);

  // Featured = projects the team marked as featured, best-documented first; Pune & Mumbai lead.
  const featured = homes
    .filter((c) => c.featured && c.price)
    .sort((a, b) => Number(HUBS.includes(b.city)) - Number(HUBS.includes(a.city)) || completeness(b) - completeness(a) || a.number - b.number)
    .slice(0, 12);

  const withRera = homes.filter((c) => c.rera).length;
  const guides = posts.slice(0, 3);

  return (
    <div className="hf">
      <div className="hf-wrap">
        {homes.length > 0 && (
          <ul className="hf-stats" aria-label="What's on Mappingg">
            <li><b>{homes.length.toLocaleString('en-IN')}</b><span>residential projects mapped</span></li>
            <li><b>{withRera.toLocaleString('en-IN')}</b><span>with a RERA registration number</span></li>
            <li><b>{localities.length}</b><span>localities with 3+ projects</span></li>
          </ul>
        )}

        <NearbyProjects localities={localities} />

        {popular.length > 0 && (
          <section className="hf-sec" aria-labelledby="hf-loc-title">
            <div className="hf-head"><div>
              <h2 id="hf-loc-title">Popular localities in Pune &amp; Mumbai</h2>
              <p>Localities with the most mapped residential projects.</p>
            </div></div>
            <div className="hf-loc-grid">
              {popular.map((g) => (
                <div key={g.city} className="hf-loc-col">
                  <h3><a href={`/cities/${g.city.toLowerCase()}`}>Flats in {g.city} <i className="fas fa-arrow-right" aria-hidden="true" /></a></h3>
                  <ul className="hf-chips">
                    {g.items.map((l) => (
                      <li key={l.slug}><a href={`/locations/${l.slug}`}>{l.label} <b>{l.count}</b></a></li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {featured.length > 0 && (
          <section className="hf-sec" aria-labelledby="hf-feat-title">
            <div className="hf-head">
              <div>
                <h2 id="hf-feat-title">Featured residential projects</h2>
                <p>Picked by our team. Confirm the latest price with the developer.</p>
              </div>
              <a className="hf-more" href="/projects">All projects <i className="fas fa-arrow-right" aria-hidden="true" /></a>
            </div>
            <Carousel label="Featured projects">
              {featured.map((c) => <HomeProjectCard key={c.number} card={c} />)}
            </Carousel>
          </section>
        )}

        <section className="hf-sec" aria-labelledby="hf-browse-title">
          <div className="hf-head"><div>
            <h2 id="hf-browse-title">Browse flats your way</h2>
            <p>Budget and size filters only include projects that have published a price or area.</p>
          </div></div>
          <div className="hf-browse">
            <div>
              <h3>By BHK</h3>
              <ul className="hf-chips">{BHK_OPTIONS.map((o) => <li key={o.slug}><a href={`/projects?bhk=${o.slug}`}>{o.label}</a></li>)}</ul>
            </div>
            <div>
              <h3>By budget</h3>
              <ul className="hf-chips">{BUDGET_OPTIONS.map((o) => <li key={o.slug}><a href={`/projects?budget=${o.slug}`}>{o.label}</a></li>)}</ul>
            </div>
            <div>
              <h3>By size</h3>
              <ul className="hf-chips">{SIZE_OPTIONS.map((o) => <li key={o.slug}><a href={`/projects?size=${o.slug}`}>{o.label}</a></li>)}</ul>
            </div>
            <div>
              <h3>By status</h3>
              <ul className="hf-chips">
                <li><a href="/status/ready-to-move">Ready to move</a></li>
                <li><a href="/status/under-construction">Under construction</a></li>
                <li><a href="/status/upcoming">Upcoming</a></li>
              </ul>
            </div>
          </div>
        </section>

        {guides.length > 0 && (
          <section className="hf-sec" aria-labelledby="hf-guides-title">
            <div className="hf-head">
              <div>
                <h2 id="hf-guides-title">Home-buying guides</h2>
                <p>Plain-language guides to RERA, carpet area, costs and checks before you book.</p>
              </div>
              <a className="hf-more" href="/blog">All guides <i className="fas fa-arrow-right" aria-hidden="true" /></a>
            </div>
            <ul className="hf-guides">
              {guides.map((p) => (
                <li key={p.slug}>
                  <a href={`/blog/${p.slug}`}>
                    <b>{p.title}</b>
                    {p.excerpt && <span>{p.excerpt}</span>}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="hf-cta" aria-labelledby="hf-cta-title">
          <div>
            <h2 id="hf-cta-title">Not sure where to start?</h2>
            <p>Tell us your budget, BHK and preferred area. Our team will shortlist matching projects and get back to you — no sign-up needed.</p>
          </div>
          <div className="hf-cta-actions">
            <a className="hf-btn hf-btn-solid" href="/buyer-requirement">Share what you need</a>
            <a className="hf-btn hf-btn-ghost" href="/contact">Contact the team</a>
          </div>
        </section>
      </div>
      {/* The "Enquire now" popup for every card above. */}
      <ProjectQuickView />
    </div>
  );
}

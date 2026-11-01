import type { HomeStats } from './home-sections';

// Phone-only sections of the home page (≤ 720 px; hidden above that by
// app/mobile-home.css). They fill the <!--M_…--> markers in
// components/landing/body.ts, around the page's existing sections, which keep
// all their behaviour and are only restyled on phones. Every count and
// article comes from live data.

export interface MobilePost { href: string; title: string; tag: string; minutes: number; image: string }

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** "970" → "970+", small counts exact (same rounding as the desktop counts). */
const fmt = (n: number) => (n >= 50 ? `${(Math.floor(n / 10) * 10).toLocaleString('en-IN')}+` : n.toLocaleString('en-IN'));

const arrow = '<i class="fas fa-arrow-right" aria-hidden="true"></i>';

const head = (title: string, href?: string) =>
  `<div class="mh-head"><h2>${esc(title)}</h2>${href ? `<a href="${href}">View All ${arrow}</a>` : ''}</div>`;

/** Inside the hero, under the intro: the three promises, then the skyline
 *  photo band — its photo is drawn up behind the whole hero (app/mobile-home.css)
 *  and the search card overlaps its lower edge. */
export function mobileTrustHtml(): string {
  return `<ul class="mh-only mh-trust" aria-label="Why Mappingg">
        <li><i class="fas fa-shield-halved" aria-hidden="true"></i><span>Verified Projects</span></li>
        <li><i class="fas fa-indian-rupee-sign" aria-hidden="true"></i><span>Real Prices</span></li>
        <li><i class="fas fa-award" aria-hidden="true"></i><span>RERA Focused</span></li>
      </ul>
      <div class="mh-only mh-hero-photo" aria-hidden="true"></div>`;
}

/** Under the hero search: quick links by status. */
export function mobileCatsHtml(): string {
  return `<nav class="mh-only mh-cats" aria-label="Browse by status">
        <a href="/status/ready-to-move"><span class="ic g"><i class="fas fa-house-chimney" aria-hidden="true"></i></span>Ready to Move</a>
        <a href="/status/under-construction"><span class="ic o"><i class="fas fa-person-digging" aria-hidden="true"></i></span>Under Construction</a>
        <a href="/status/upcoming"><span class="ic o"><i class="fas fa-rocket" aria-hidden="true"></i></span>New Launch</a>
        <a href="/projects?budget=2-5-crore"><span class="ic o"><i class="fas fa-gem" aria-hidden="true"></i></span>Luxury Homes</a>
      </nav>`;
}

/** After "Projects near you": why Mappingg, and a link to how it works. */
export function mobileDiscoverHtml(): string {
  return `<div class="mh-only mh">
  <section class="mh-sec mh-why">
    <h2>Why Choose Mappingg.com?</h2>
    <p class="mh-sub">Everything you need for a smarter home buying journey — in one place.</p>
    <ul>
      <li><span class="ic"><i class="fas fa-shield-halved" aria-hidden="true"></i></span><b>Verified Projects</b><small>With RERA details</small></li>
      <li><span class="ic"><i class="fas fa-indian-rupee-sign" aria-hidden="true"></i></span><b>Real Prices</b><small>Where developers publish them</small></li>
      <li><span class="ic"><i class="fas fa-map-location-dot" aria-hidden="true"></i></span><b>Interactive Map</b><small>Exact project locations</small></li>
      <li><span class="ic"><i class="fas fa-right-left" aria-hidden="true"></i></span><b>Compare Easily</b><small>Prices, BHK &amp; possession</small></li>
    </ul>
    <a href="/how-it-works" class="mh-promo">
      <b>Make a Smarter Home Buying Decision</b>
      <small>With real data, real locations and real insights.</small>
      <i class="fas fa-arrow-right mh-go" aria-hidden="true"></i>
    </a>
  </section>
</div>`;
}

/** Before the closing call to action: blog articles and the "better futures" card with live counts. */
export function mobileInsightsHtml(posts: MobilePost[], s: HomeStats): string {
  // Filter chips: the most common first tags (CSS-only filter, app/mobile-home.css).
  const tagCount = new Map<string, number>();
  for (const p of posts) if (p.tag) tagCount.set(p.tag, (tagCount.get(p.tag) || 0) + 1);
  const tags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
  const stats = [
    { icon: 'fa-house-circle-check', v: s.projects, label: 'Verified Projects' },
    { icon: 'fa-building', v: s.developers, label: 'Top Developers' },
    { icon: 'fa-location-dot', v: s.localities, label: 'Key Locations' },
    { icon: 'fa-shield-halved', v: s.rera, label: 'RERA Registered' },
  ].filter((x) => x.v > 0);

  return `<div class="mh-only mh">
  ${posts.length ? `<section class="mh-sec mh-ins">
    ${head('Key Insights for Home Buyers', '/blog')}
    ${tags.length > 1 ? `<div class="mh-chips" role="radiogroup" aria-label="Filter articles">
      <input type="radio" name="mh-ins" id="mh-ins-0" checked><label for="mh-ins-0">All</label>
      ${tags.map((t, i) => `<input type="radio" name="mh-ins" id="mh-ins-${i + 1}"><label for="mh-ins-${i + 1}">${esc(t)}</label>`).join('')}
    </div>` : ''}
    <ul class="mh-ins-list">${posts.map((p) => `<li data-t="${tags.indexOf(p.tag) + 1}"><a href="${esc(p.href)}">
      ${p.image ? `<span class="mh-photo" style="background-image:url('${esc(p.image)}')" aria-hidden="true"></span>` : '<span class="mh-ins-ph"><i class="fas fa-newspaper" aria-hidden="true"></i></span>'}
      <span class="tx">${p.tag ? `<em>${esc(p.tag)}</em>` : ''}<b>${esc(p.title)}</b><small><i class="far fa-clock" aria-hidden="true"></i> ${p.minutes} min read</small></span>
      <i class="fas fa-chevron-right mh-chev" aria-hidden="true"></i></a></li>`).join('')}</ul>
  </section>` : ''}
  <section class="mh-sec">
    <div class="mh-future">
      <div class="mh-future-hero"><b>Not just homes. Better futures.</b><small>Find the right home, in the right location, with the right information.</small></div>
      ${stats.length ? `<ul class="mh-future-stats">${stats.map((x) => `<li><i class="fas ${x.icon}" aria-hidden="true"></i><b>${fmt(x.v)}</b><small>${x.label}</small></li>`).join('')}</ul>` : ''}
    </div>
  </section>
</div>`;
}

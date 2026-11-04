import { featuredPool, type HomeStats } from './home-sections';
import type { ProjectCardData } from '@/lib/home/cards';

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

/** The project shown in the phone hero's floating card and the "Explore Properties
 *  Around You" pin: a new launch with a price if there is one, else the best
 *  documented featured project (same pool as the desktop hero card). */
function heroPick(cards: ProjectCardData[]): ProjectCardData | undefined {
  const list = featuredPool(cards).list.filter((c) => c.price && c.bhk);
  return list.find((c) => c.status === 'Upcoming') || list.find((c) => c.status === 'Under Construction') || list[0];
}

/** Inside the hero, under the intro: the floating project card, the four promises,
 *  then the photo band — its photo is drawn up behind the whole hero
 *  (app/mobile-home.css) and the search card overlaps its lower edge. */
export function mobileTrustHtml(cards: ProjectCardData[]): string {
  const c = heroPick(cards);
  const badge = c ? (c.status === 'Upcoming' ? 'New Launch' : c.status || 'Featured') : '';
  // "3, 4 BHK" → "3 & 4 BHK Homes"; "₹1.37 Cr – ₹2 Cr" → "From ₹1.37 Cr"
  const bhk = c ? `${c.bhk.replace(/, (?=[^,]*$)/, ' & ')} Homes` : '';
  const from = c ? c.price.split(' – ')[0].replace(/ onwards$/, '') : '';
  return `<div class="mh-only mh-hero-foot">
        ${c ? `<a class="mh-launch" href="${esc(c.href)}" data-quickview="${c.number}" aria-label="${esc(`${c.title}: ${bhk}, from ${from}`)}">
          ${c.image ? `<img src="${esc(c.image)}" alt="" width="52" height="52" decoding="async" loading="lazy">` : ''}
          <span class="tx"><em>${esc(badge)}</em><small>${esc(bhk)}</small><b>From ${esc(from)}</b></span>
          <i class="fas fa-chevron-right" aria-hidden="true"></i>
        </a><span class="mh-launch-pin" aria-hidden="true"></span>` : ''}
        <ul class="mh-trust" aria-label="Why Mappingg">
          <li><i class="fas fa-shield-halved" aria-hidden="true"></i><span>Verified Projects</span></li>
          <li><i class="fas fa-layer-group" aria-hidden="true"></i><span>Real Prices</span></li>
          <li><i class="far fa-file-lines" aria-hidden="true"></i><span>RERA Details</span></li>
          <li><i class="fas fa-location-dot" aria-hidden="true"></i><span>Nearby Infra</span></li>
        </ul>
      </div>
      <div class="mh-only mh-hero-photo" aria-hidden="true"></div>`;
}

/** Under the hero search: shortcut cards (a swipeable row with an arrow and page
 *  dots, wired up in /landing.js), then the "Explore Properties Around You" card. */
export function mobileCatsHtml(cards: ProjectCardData[]): string {
  const c = heroPick(cards);
  const items = [
    { href: '/map', cls: 'trial-link on', icon: 'fa-map-location-dot', tone: 'gold', label: 'Live Map View' },
    { href: '/status/upcoming', icon: 'fa-rocket', tone: 'orange', label: 'New Launches' },
    { href: '/projects', icon: 'fa-fire', tone: 'orange', label: 'Trending Projects' },
    { href: '/status/ready-to-move', icon: 'fa-house-chimney', tone: 'green', label: 'Ready to Move' },
    { href: '/status/under-construction', icon: 'fa-person-digging', tone: 'orange', label: 'Under Construction' },
    { href: '/projects?budget=2-5-crore', icon: 'fa-gem', tone: 'gold', label: 'Luxury Homes' },
  ];
  // A few house pins around the project's photo pin on the illustrated map.
  const pins = [[44, 22], [84, 16], [40, 78], [86, 64]];
  return `<div class="mh-only mh-cats">
        <nav class="mh-cats-row" id="mhCats" aria-label="Browse projects">
          ${items.map((x) => `<a href="${x.href}"${x.cls ? ` class="${x.cls}"` : ''}><i class="fas ${x.icon} ${x.tone}" aria-hidden="true"></i><span>${x.label}</span></a>`).join('')}
        </nav>
        <button type="button" class="mh-cats-next" id="mhCatsNext" aria-label="More shortcuts"><i class="fas fa-chevron-right" aria-hidden="true"></i></button>
        <div class="mh-cats-dots" id="mhCatsDots" aria-hidden="true"><span class="on"></span><span></span></div>
      </div>
      <section class="mh-only mh-around" aria-labelledby="mhAroundTitle">
        <div class="mh-around-map" aria-hidden="true">
          <svg viewBox="0 0 240 200" preserveAspectRatio="xMidYMid slice">
            <rect width="240" height="200" fill="#eef2ea"/>
            <g fill="#d4ebc6"><rect x="8" y="10" width="58" height="40" rx="8"/><rect x="150" y="118" width="70" height="46" rx="8"/><rect x="96" y="20" width="40" height="30" rx="8"/></g>
            <g fill="#e4e8df"><rect x="160" y="16" width="64" height="44" rx="6"/><rect x="14" y="120" width="56" height="50" rx="6"/></g>
            <path d="M120 210 C 150 170 190 160 200 120 S 230 70 260 60" stroke="#9ccbee" stroke-width="16" fill="none" stroke-linecap="round"/>
            <g fill="none" stroke-linecap="round">
              <path d="M-10 92 C 60 80 140 104 250 84M84 -10 C 92 60 70 140 96 210M-10 180 L 250 140" stroke="#fff" stroke-width="9"/>
              <path d="M140 -10 C 130 60 160 120 150 210M-10 40 L 250 64" stroke="#f6d78c" stroke-width="7"/>
            </g>
          </svg>
          ${pins.map(([x, y]) => `<span class="mh-hpin" style="left:${x}%;top:${y}%"><i class="fas fa-house"></i></span>`).join('')}
          <span class="mh-ppin">${c?.image ? `<img src="${esc(c.image)}" alt="" width="64" height="64" decoding="async" loading="lazy">` : '<i class="fas fa-building"></i>'}</span>
        </div>
        <div class="mh-around-tx">
          <h2 id="mhAroundTitle">Explore Properties Around You</h2>
          <p>View projects on an interactive map with prices, RERA &amp; more.</p>
          <a href="/map" class="trial-link mh-around-btn">Open Map <i class="fas fa-arrow-right" aria-hidden="true"></i></a>
        </div>
      </section>`;
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

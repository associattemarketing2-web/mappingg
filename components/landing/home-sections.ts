import { completeness, type ProjectCardData } from '@/lib/home/cards';
import { isAdminArea } from '@/lib/home/nearby';
import { slugify } from '@/lib/seo/slug';

// Server-rendered bits of the home page that come from live data: the counts in
// the hero stats bar and the dark numbers band, and the popular-locality chips
// under the hero search (they fill the markers in components/landing/body.ts).
// Every number is counted from the public project cards — nothing is made up.

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface HomeStats {
  projects: number;
  developers: number;
  localities: number;
  rera: number;
  cities: number;
}

export function homeStats(cards: ProjectCardData[]): HomeStats {
  const devs = new Set<string>(), locs = new Set<string>(), cities = new Set<string>();
  let rera = 0;
  for (const c of cards) {
    if (c.developer) devs.add(c.developer.trim().toLowerCase());
    if (c.locality && !isAdminArea(c.locality)) locs.add(slugify(c.locality));
    if (c.city) cities.add(c.city);
    if (c.rera) rera += 1;
  }
  return { projects: cards.length, developers: devs.size, localities: locs.size, rera, cities: cities.size };
}

/** "1,234" → "1,230+" for big counts; small counts stay exact. */
const fmt = (n: number) => (n >= 50 ? `${(Math.floor(n / 10) * 10).toLocaleString('en-IN')}+` : n.toLocaleString('en-IN'));

type Stat = { icon: string; value: string; label: string };

function list(s: HomeStats): Stat[] {
  const out: Stat[] = [
    { icon: 'fa-house', value: fmt(s.projects), label: 'Verified Projects' },
    { icon: 'fa-building', value: fmt(s.developers), label: 'Top Developers' },
    { icon: 'fa-location-dot', value: fmt(s.localities), label: 'Key Locations' },
    { icon: 'fa-shield-halved', value: fmt(s.rera), label: 'RERA Registered' },
  ];
  // With no data (database unreachable) the row is left out rather than showing zeros.
  return out.filter((x) => x.value !== '0');
}

const item = (x: Stat) =>
  `<div class="hm-stat"><span class="ic"><i class="fas ${x.icon}"></i></span><div><b>${x.value}</b><small>${x.label}</small></div></div>`;

/** Right under the hero: three photo cards linking to the live map
 *  (.trial-link: guests get the free-projects map, signed-in visitors /map).
 *  Each card keeps the shape of its photo (public/img/strip-*.webp) and sizes
 *  its text and arrow in cqw, so they sit where the design draws them. */
export function statsStripHtml(): string {
  const links = [
    { href: '/map', title: 'Modern Homes', sub: 'For every family', icon: 'fa-building', img: 'modern', w: 396 },
    { href: '/map', title: 'Better Connectivity', sub: 'Live near what matters', icon: 'fa-train', img: 'connect', w: 304 },
    { href: '/map', title: 'Growing Locations', sub: 'Higher future value', icon: 'fa-chart-line', img: 'growth', w: 353 },
  ];

  return `<section class="hm-strip" aria-label="Mappingg at a glance">
  <div class="hm-wrap">
    <div class="hm-strip-cards">${links.map((c) => `<a class="hm-scard trial-link" href="${c.href}">
        <img class="hm-scard-img" src="/img/strip-${c.img}.webp" alt="" width="${c.w}" height="325" loading="lazy" decoding="async">
        <span class="hm-scard-ic" aria-hidden="true"><i class="fas ${c.icon}"></i></span>
        <span class="hm-scard-tx"><b>${c.title.replace(' ', '<br>')}</b><small>${c.sub}</small></span>
        <span class="hm-scard-go" aria-hidden="true"><i class="fas fa-arrow-right"></i></span>
      </a>`).join('')}</div>
  </div>
</section>`;
}

/** The white numbers card above the closing call to action. */
export function statsBandHtml(s: HomeStats): string {
  const items = list(s);
  return items.length ? `<div class="hm-bandrow">${items.map(item).join('')}</div>` : '';
}

// ---------- Hero map preview ----------
// What every visitor sees in the hero before the live map loads (it loads on
// their first interaction, to keep the page fast): a real map of Mundhwa,
// Pune with each of its projects as a pin — so it is obvious at a glance that
// this is a map of real estate projects. "Near me" (landing.js) swaps in the
// projects around the visitor when they ask for it. OpenStreetMap tiles (same
// as the live map), a 4×4 block (1024 px) chosen so the centre has at least
// 384 px of map on every side.
const TILE = 256;

export function mapPreviewHtml(cards: ProjectCardData[], card = '', locality = 'mundhwa'): string {
  // Every project in the locality, as a pin with its logo (the same pins the live map shows).
  const inIt = cards.filter((c) => c.residential && c.lat != null && c.lng != null && c.locality && slugify(c.locality) === locality);
  if (inIt.length < 3) return '';
  const titleCase = (v: string) => (v === v.toUpperCase() ? v.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase()) : v);
  const label = titleCase(inIt.find((c) => c.locality !== c.locality.toUpperCase())?.locality || inIt[0].locality);
  const at = (lat: number, lng: number, z: number) => {
    const n = TILE * 2 ** z, sn = Math.sin((lat * Math.PI) / 180);
    return { x: ((lng + 180) / 360) * n, y: (0.5 - Math.log((1 + sn) / (1 - sn)) / (4 * Math.PI)) * n };
  };
  const cLat = inIt.reduce((t, c) => t + (c.lat as number), 0) / inIt.length;
  const cLng = inIt.reduce((t, c) => t + (c.lng as number), 0) / inIt.length;
  // The closest zoom that keeps (nearly) all of them in view.
  let z = 15;
  for (; z > 12; z--) {
    const o = at(cLat, cLng, z);
    const fit = inIt.filter((c) => { const q = at(c.lat as number, c.lng as number, z); return Math.abs(q.x - o.x) < 230 && Math.abs(q.y - o.y) < 170; }).length;
    if (fit >= inIt.length * 0.9) break;
  }
  const centre = at(cLat, cLng, z);
  const tx = Math.floor(centre.x / TILE), ty = Math.floor(centre.y / TILE);
  const x0 = tx - (centre.x / TILE - tx < 0.5 ? 2 : 1), y0 = ty - (centre.y / TILE - ty < 0.5 ? 2 : 1);
  const ox = centre.x - x0 * TILE, oy = centre.y - y0 * TILE; // centre, in px inside the 1024 px block

  const tiles: string[] = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    // data-sat: the same tile as satellite imagery (Esri, as on the live map), swapped in by the Satellite button.
    tiles.push(`<img src="https://tile.openstreetmap.org/${z}/${x0 + i}/${y0 + j}.png" data-sat="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y0 + j}/${x0 + i}" alt="" width="256" height="256" style="left:${i * TILE}px;top:${j * TILE}px" decoding="async" fetchpriority="low">`);
  }
  // Northern pins first, so the ones lower down sit in front (like the live map).
  const pins = [...inIt].sort((a, b) => (b.lat as number) - (a.lat as number)).map((c, k) => {
    const q = at(c.lat as number, c.lng as number, z);
    const dx = Math.round(q.x - centre.x), dy = Math.round(q.y - centre.y);
    if (Math.abs(dx) > 480 || Math.abs(dy) > 480) return '';
    return `<a class="hm-ppin" href="${esc(c.href)}" data-quickview="${c.number}" title="${esc(c.title)}" style="left:${Math.round(ox + dx)}px;top:${Math.round(oy + dy)}px;--d:${(k * 0.03).toFixed(2)}s">`
      + `<span>${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy" decoding="async">` : '<i class="fas fa-building"></i>'}</span><em>${esc(c.title)}</em></a>`;
  }).join('');

  return `<div class="hm-preview">
      <div class="hm-preview-tiles" style="left:calc(50% - ${Math.round(ox)}px + var(--pin-shift, 0px));top:calc(50% - ${Math.round(oy)}px)">${tiles.join('')}${pins}</div>
      <nav class="hm-ov-filters" aria-label="Browse projects">
        <a href="/projects" class="on">All Projects</a>
        <a href="/status/under-construction">Under Construction</a>
        <a href="/status/ready-to-move">Ready to Move</a>
        <a href="/status/upcoming">Upcoming</a>
        <a class="trial-link" href="/map">Premium</a>
        <a href="/projects" class="hm-ov-more"><i class="fas fa-sliders"></i>Filters <i class="fas fa-arrow-right"></i></a>
      </nav>
      <div class="hm-ov-layers" role="group" aria-label="Map style">
        <button type="button" data-layer="map" class="on" aria-pressed="true"><i class="fas fa-map"></i>Map</button>
        <button type="button" data-layer="sat" aria-pressed="false"><i class="fas fa-satellite"></i>Satellite</button>
        <button type="button" data-near="1" aria-pressed="false"><i class="fas fa-location-crosshairs"></i>Near me</button>
      </div>
      ${card}
      <div class="hm-preview-cta">
        <button type="button" class="hm-btn hm-btn-solid" id="mapStart"><i class="fas fa-map-location-dot"></i> Explore the live map</button>
        <small id="hmPreviewNote">${inIt.length} projects in ${esc(label)}, Pune · 3 projects free, no sign-up</small>
      </div>
      <span class="hm-osm">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a></span>
    </div>`;
}

// ---------- Featured projects ----------
/** Candidates for the hero's sample project card: highlighted by the
 *  super admin first, then paid developer promotion (lib/subscriptions), then the best documented; Pune when it has enough. A project
 *  listed twice under the same name (separate pins) is shown once. */
export function featuredPool(cards: ProjectCardData[], min = 4): { list: ProjectCardData[]; inPune: boolean } {
  const usable = cards.filter((c) => c.residential && c.image && c.status !== 'Sold');
  const rank = (a: ProjectCardData, b: ProjectCardData) =>
    Number(b.featured) - Number(a.featured) || (b.promoted || 0) - (a.promoted || 0) || completeness(b) - completeness(a) || a.number - b.number;
  const pune = usable.filter((c) => c.city === 'Pune');
  const inPune = pune.length >= min;
  const seen = new Set<string>();
  const list = (inPune ? pune : usable).sort(rank).filter((c) => {
    const key = c.title.trim().toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { list, inPune };
}

/** The project card floating on the hero map (like the live map's own pin card). */
export function heroProjectHtml(cards: ProjectCardData[]): string {
  const c = featuredPool(cards).list.find((x) => x.price && x.bhk);
  if (!c) return '';
  const where = [c.locality, c.city].filter(Boolean).join(', ');
  return `<div class="hm-pcard" id="hmPcard">
        <button type="button" class="hm-pcard-x" id="hmPcardX" aria-label="Close project card"><i class="fas fa-xmark"></i></button>
        <a class="hm-pcard-img" href="${esc(c.href)}" tabindex="-1" aria-hidden="true"><img src="${esc(c.image)}" alt="" width="120" height="120" decoding="async"></a>
        <div class="hm-pcard-body">
          <b>${esc(c.title)}</b>
          <small>${esc(where)}</small>
          <span class="hm-pcard-price">${esc(c.price)}</span>
          <small>${esc(c.bhk)}</small>
          <span class="hm-pcard-tags">${c.rera ? '<em class="t-rera">RERA</em>' : ''}${c.status ? `<em class="t-st">${esc(c.status)}</em>` : ''}</span>
          <a class="hm-btn hm-btn-solid hm-btn-sm" href="${esc(c.href)}" data-quickview="${c.number}">View Project <i class="fas fa-arrow-right"></i></a>
        </div>
      </div>`;
}

/** Building tops in the hero skyline photo (x, y in px of the 1100 × 677 image), picked
 *  in the strip that stays clear of the headline and the map on desktop. 'r' opens the
 *  card to the right, where opening it upwards would cover the intro text. */
const SKYLINE_SPOTS: [number, number, ('r' | '')?][] = [[742, 214], [900, 208], [830, 402, 'r']];

/** Map pins standing on a few buildings of the hero's background photo. Each opens a
 *  small card for a real project (landing.js cycles them); desktop only (home.css). */
export function heroSkylinePinsHtml(cards: ProjectCardData[]): string {
  // Skip the project already shown on the hero map's card.
  const { list } = featuredPool(cards);
  const hero = list.find((x) => x.price && x.bhk);
  const picks = list.filter((c) => c !== hero && c.price).slice(0, SKYLINE_SPOTS.length);
  if (picks.length < 2) return '';
  const pins = picks.map((c, k) => {
    const [x, y, side] = SKYLINE_SPOTS[k];
    const where = [c.locality, c.city].filter(Boolean).join(', ');
    return `<a class="hm-sky-pin${side === 'r' ? ' side-r' : ''}" href="${esc(c.href)}" data-quickview="${c.number}" style="left:${((x / 1100) * 100).toFixed(2)}%;top:${((y / 677) * 100).toFixed(2)}%;--d:${(0.4 + k * 0.25).toFixed(2)}s" aria-label="${esc(c.title)}, ${esc(where)}">`
      + `<span class="hm-sky-mark"><img src="${esc(c.image)}" alt="" width="26" height="26" loading="lazy" decoding="async"></span>`
      + `<span class="hm-sky-card" aria-hidden="true"><b>${esc(c.title)}</b><small>${esc(where)}</small><strong>${esc(c.price)}</strong></span></a>`;
  }).join('');
  return `<div class="hm-hero-sky" id="hmSky"><div class="hm-hero-sky-in">${pins}</div></div>`;
}

// ---------- "Built for every home buyer" (bento grid) ----------
// Two tiles: what's nearby (an illustrated map with example distances + the
// place types), and a free account with a phone showing a real featured
// project + the 40-second walkthrough video (landing.js opens it in #hmVideo).

/** Place types on the "What's nearby" tile: icon, colour class, and where its
 *  example tag sits on the illustrated map (% of the map box). */
const NEAR_TYPES = [
  { label: 'Schools', icon: 'fa-graduation-cap', tone: 'gr', km: '1.2', x: 26, y: 16 },
  { label: 'Hospitals', icon: 'fa-square-plus', tone: 'rd', km: '2.4', x: 74, y: 22 },
  { label: 'Metro & Transport', short: 'Metro', icon: 'fa-train-subway', tone: 'pu', km: '3.1', x: 18, y: 50 },
  { label: 'IT Parks', icon: 'fa-building', tone: 'bl', km: '4.5', x: 80, y: 62 },
  { label: 'Malls', icon: 'fa-bag-shopping', tone: 'or', km: '2.8', x: 28, y: 84 },
];

/** The illustrated neighbourhood behind the "What's nearby" tags: parks, blocks, a river and roads. */
const NEAR_MAP_SVG = `<svg viewBox="0 0 300 240" preserveAspectRatio="xMidYMid slice">
  <rect width="300" height="240" fill="#e9efe2"/>
  <g fill="#bcdba5"><rect x="6" y="8" width="70" height="46" rx="8"/><rect x="200" y="150" width="92" height="56" rx="8"/><rect x="118" y="8" width="54" height="34" rx="8"/><rect x="10" y="170" width="52" height="62" rx="8"/></g>
  <g fill="#d9dfd2"><rect x="206" y="12" width="84" height="50" rx="6"/><rect x="84" y="150" width="58" height="40" rx="6"/><rect x="200" y="84" width="40" height="44" rx="6"/><rect x="20" y="96" width="44" height="50" rx="6"/></g>
  <path d="M150 260 C 170 210 230 196 246 150 S 280 90 320 76" stroke="#8fc3ea" stroke-width="18" fill="none" stroke-linecap="round"/>
  <g fill="none" stroke-linecap="round">
    <path d="M-10 74 C 80 64 180 92 310 70M-10 140 C 90 132 200 150 310 128M96 -10 C 104 70 84 160 108 250M190 -10 C 180 80 206 160 196 250" stroke="#fff" stroke-width="10"/>
    <path d="M-10 206 L 310 172M250 -10 C 236 60 262 110 250 140" stroke="#f3d27e" stroke-width="7"/>
  </g>
  <g fill="#7fae63"><circle cx="30" cy="30" r="7"/><circle cx="52" cy="40" r="6"/><circle cx="232" cy="176" r="7"/><circle cx="262" cy="188" r="8"/><circle cx="140" cy="24" r="6"/><circle cx="30" cy="196" r="7"/><circle cx="44" cy="214" r="6"/></g>
</svg>`;

export function buyersSectionHtml(cards: ProjectCardData[]): string {
  return `<section class="hm-sec hm-buyers">
  <div class="hm-wrap">
    <div class="hm-head hm-center">
      <span class="hm-eyebrow"><i class="fas fa-house" aria-hidden="true"></i>For home buyers</span>
      <h2>Built for every <span class="accent">home buyer</span></h2>
      <p class="hm-sub">Everything you need to find the right home — in one place, and free for buyers.</p>
    </div>
    <div class="hm-bento">
      <div class="hm-tile hm-t-near">
        <h3 class="hm-vh">What's nearby</h3>
        <div class="hm-near-map" aria-hidden="true">
          ${NEAR_MAP_SVG}
          <span class="hm-near-home"><i class="fas fa-house"></i></span>
          ${NEAR_TYPES.map((t) => `<span class="hm-near-tag" style="left:${t.x}%;top:${t.y}%"><span class="ic ${t.tone}"><i class="fas ${t.icon}"></i></span><span><b>${t.short || t.label}</b><small>${t.km} km</small></span></span>`).join('')}
        </div>
        <div class="hm-near-side">
          <ul class="hm-near-list" aria-label="See what's nearby on the map">
            ${NEAR_TYPES.map((t) => `<li><a class="trial-link" href="/map"><span class="ic ${t.tone}"><i class="fas ${t.icon}" aria-hidden="true"></i></span>${t.label}<i class="fas fa-chevron-right hm-near-chev" aria-hidden="true"></i></a></li>`).join('')}
          </ul>
          <a class="hm-near-btn trial-link" href="/map"><i class="far fa-map" aria-hidden="true"></i>Explore on Map<i class="fas fa-arrow-right" aria-hidden="true"></i></a>
        </div>
      </div>

      <div class="hm-tile hm-t-save">
        <span class="hm-save-art" aria-hidden="true"></span>
        <div class="hm-save-tx">
          <h3>Save, Compare &amp; Track Projects <span>— Free</span></h3>
          <p>Create a free buyer account with just your WhatsApp number and make a smarter, faster decision.</p>
          <ul class="hm-save-feats">
            <li><i class="far fa-bookmark" aria-hidden="true"></i>Shortlist Projects</li>
            <li><i class="fas fa-scale-balanced" aria-hidden="true"></i>Compare Options</li>
            <li><i class="far fa-folder-open" aria-hidden="true"></i>Open Every Project</li>
            <li><i class="fab fa-whatsapp" aria-hidden="true"></i>Enquire Directly</li>
          </ul>
          <div class="hm-save-btns">
            <a href="#" class="hm-btn hm-btn-white open-signup" data-role="buyer"><i class="fab fa-whatsapp hm-wa"></i>Sign Up Free <i class="fas fa-arrow-right"></i></a>
            <button type="button" class="hm-bvideo" id="hmVideoBtn"><span class="play"><i class="fas fa-play"></i></span><span><b>See How It Works</b><small>40 sec video</small></span></button>
          </div>
        </div>
      </div>
    </div>
  </div>
  <dialog class="hm-video" id="hmVideo" aria-label="How to use Mappingg — 40-second video">
    <button type="button" class="hm-video-x" id="hmVideoX" aria-label="Close video"><i class="fas fa-xmark"></i></button>
    <video src="/video/how-mappingg-works-v1.mp4" poster="/video/how-mappingg-works-v1.jpg" controls playsinline preload="none"></video>
  </dialog>
</section>`;
}

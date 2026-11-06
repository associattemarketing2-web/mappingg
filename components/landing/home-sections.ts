import { completeness, type ProjectCardData } from '@/lib/home/cards';
import { isAdminArea } from '@/lib/home/nearby';
import { slugify } from '@/lib/seo/slug';
import { BHK_OPTIONS, BUDGET_OPTIONS } from '@/lib/home/finder';

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

function list(s: HomeStats, band: boolean): Stat[] {
  const out: Stat[] = [
    { icon: 'fa-shield-halved', value: fmt(s.projects), label: 'Verified Projects' },
    { icon: 'fa-building', value: fmt(s.developers), label: 'Developers' },
    { icon: 'fa-location-dot', value: fmt(s.localities), label: 'Key Locations' },
    band
      ? { icon: 'fa-city', value: fmt(s.cities), label: s.cities === 1 ? 'City' : 'Cities' }
      : { icon: 'fa-house-circle-check', value: fmt(s.rera), label: 'RERA Registered' },
  ];
  // With no data (database unreachable) the row is left out rather than showing zeros.
  return out.filter((x) => x.value !== '0');
}

const item = (x: Stat) =>
  `<div class="hm-stat"><span class="ic"><i class="fas ${x.icon}"></i></span><div><b>${x.value}</b><small>${x.label}</small></div></div>`;

/** The panel right under the hero: the cities covered, live counts (they count
 *  up when scrolled into view — landing.js) and three quick links to the live map
 *  (.trial-link: guests get the free-projects map, signed-in visitors /map). */
export function statsStripHtml(s: HomeStats, cards: ProjectCardData[]): string {
  // Counts as a number + "+" so landing.js can animate them; the final text is server-rendered.
  const n = (v: number) => (v >= 50 ? Math.floor(v / 10) * 10 : v);
  const stats = [
    { icon: 'fa-house-circle-check', v: s.projects, label: 'Verified Projects' },
    { icon: 'fa-building', v: s.developers, label: 'Top Developers' },
    { icon: 'fa-location-dot', v: s.localities, label: 'Key Locations' },
    { icon: 'fa-shield-halved', v: s.rera, label: 'RERA Registered' },
  ].filter((x) => x.v > 0);

  // Cities with the most projects, for the label on the skyline.
  const byCity = new Map<string, number>();
  for (const c of cards) if (c.city) byCity.set(c.city, (byCity.get(c.city) || 0) + 1);
  const cities = [...byCity.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const cityLine = cities.length > 3 ? `${cities.slice(0, 3).join(' · ')} & more` : cities.join(' · ');

  const img = (id: string) => `https://images.unsplash.com/${id}?w=420&h=300&auto=format&fit=crop&q=70`;
  const links = [
    { href: '/map', title: 'Modern Homes', sub: 'For every family', img: img('photo-1567684014761-b65e2e59b9eb') },
    { href: '/map', title: 'Better Connectivity', sub: 'Live near what matters', img: img('photo-1565402170291-8491f14678db') },
    { href: '/map', title: 'Growing Locations', sub: 'Higher future value', img: img('photo-1582407947304-fd86f028f716') },
  ];

  return `<section class="hm-strip" aria-label="Mappingg at a glance">
  <div class="hm-wrap">
    <div class="hm-strip-panel">
      <div class="hm-strip-city" aria-hidden="true"><span><i class="fas fa-location-dot"></i>${esc(cityLine)}</span></div>
      ${stats.length ? `<div class="hm-strip-stats">${stats.map((x) => {
        const v = n(x.v), plus = x.v >= 50 ? '+' : '';
        return `<div><span class="ic"><i class="fas ${x.icon}"></i></span><span><b class="hm-count" data-count="${v}" data-suffix="${plus}">${v.toLocaleString('en-IN')}${plus}</b><small>${x.label}</small></span></div>`;
      }).join('')}</div>` : ''}
      <div class="hm-strip-cards">${links.map((c) => `<a class="hm-scard trial-link" href="${c.href}">
          <span class="hm-scard-img" style="background-image:url('${c.img}')"></span>
          <span class="hm-scard-tx"><b>${c.title}</b><small>${c.sub}</small></span>
          <i class="fas fa-arrow-right hm-scard-go"></i>
        </a>`).join('')}</div>
    </div>
  </div>
</section>`;
}

export function statsBandHtml(s: HomeStats): string {
  const items = list(s, true);
  return items.length ? `<div class="hm-bandrow">${items.map(item).join('')}</div>` : '';
}

// ---------- Hero map preview ----------
// What every visitor sees in the hero before the live map loads (it loads on
// their first interaction, to keep the page fast): a real map of Mundhwa,
// Pune with each of its projects as a pin — so it is obvious at a glance that
// this is a map of real estate projects. "Near me" (landing.js) swaps in the
// projects around the visitor when they ask for it. OpenStreetMap tiles (same
// as the live map), a 4×4 block (1024 px) chosen so the centre has at least
// 384 px of map on every side. worldPx (fixed zoom) is used by the mini map
// in "Built for every home buyer".
const Z = 12;
const TILE = 256;
const worldPx = (lat: number, lng: number) => {
  const n = TILE * 2 ** Z;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
};

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
 *  super admin first, then the best documented; Pune when it has enough. A project
 *  listed twice under the same name (separate pins) is shown once. */
export function featuredPool(cards: ProjectCardData[], min = 4): { list: ProjectCardData[]; inPune: boolean } {
  const usable = cards.filter((c) => c.residential && c.image && c.status !== 'Sold');
  const rank = (a: ProjectCardData, b: ProjectCardData) =>
    Number(b.featured) - Number(a.featured) || completeness(b) - completeness(a) || a.number - b.number;
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
// Six tiles, each one a real way in: a small real map of the busiest
// localities, RERA count, compare, budget / BHK shortcuts (they open the
// live map), what's nearby, and a free account + the 40-second
// walkthrough video (landing.js opens it in #hmVideo).

/** Photo on the "What's nearby" tile — swap for your own (e.g. '/img/home/buyers.jpg'). */
const BUYERS_PHOTO = 'https://images.unsplash.com/photo-1609220136736-443140cffec6?w=900&auto=format&fit=crop&q=70';

/** A 3×3-tile (768 px) real map around a city's busiest localities, with their project counts. */
function miniMapHtml(cards: ProjectCardData[], city = 'Pune', max = 6): string {
  const groups = new Map<string, { label: string; count: number; lat: number; lng: number }>();
  for (const c of cards) {
    if (c.city !== city || !c.residential || !c.locality || isAdminArea(c.locality) || c.lat == null || c.lng == null) continue;
    const slug = slugify(c.locality);
    const g = groups.get(slug) || { label: c.locality, count: 0, lat: 0, lng: 0 };
    if (g.label === g.label.toUpperCase() && c.locality !== c.locality.toUpperCase()) g.label = c.locality;
    g.count += 1; g.lat += c.lat; g.lng += c.lng;
    groups.set(slug, g);
  }
  const top = [...groups.entries()]
    .map(([slug, g]) => ({ slug, label: g.label, count: g.count, lat: g.lat / g.count, lng: g.lng / g.count }))
    .filter((g) => g.count >= 3).sort((a, b) => b.count - a.count).slice(0, max);
  if (top.length < 2) return '';
  const total = top.reduce((s, g) => s + g.count, 0);
  const centre = worldPx(top.reduce((s, g) => s + g.lat * g.count, 0) / total, top.reduce((s, g) => s + g.lng * g.count, 0) / total);
  const tx = Math.floor(centre.x / TILE) - 1, ty = Math.floor(centre.y / TILE) - 1;
  const ox = centre.x - tx * TILE, oy = centre.y - ty * TILE;
  const tiles: string[] = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    tiles.push(`<img src="https://tile.openstreetmap.org/${Z}/${tx + i}/${ty + j}.png" alt="" width="256" height="256" style="left:${i * TILE}px;top:${j * TILE}px" loading="lazy" decoding="async">`);
  }
  const placed: { dx: number; dy: number }[] = [];
  const pins = top.map((g) => {
    const p = worldPx(g.lat, g.lng);
    const dx = Math.round(p.x - centre.x), dy = Math.round(p.y - centre.y);
    if (Math.abs(dx) > 220 || Math.abs(dy) > 150) return '';
    if (placed.some((q) => Math.abs(q.dx - dx) < 120 && Math.abs(q.dy - dy) < 40)) return '';
    placed.push({ dx, dy });
    const label = g.label === g.label.toUpperCase() ? g.label.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase()) : g.label;
    return `<a class="hm-mpin trial-link" href="/map" style="left:${Math.round(ox + dx)}px;top:${Math.round(oy + dy)}px"><span>${g.count}</span>${esc(label)}</a>`;
  }).join('');
  return `<div class="hm-mini"><div class="hm-mini-tiles" style="left:calc(50% - ${Math.round(ox)}px);top:calc(50% - ${Math.round(oy)}px)">${tiles.join('')}${pins}</div><span class="hm-osm">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a></span></div>`;
}

export function buyersSectionHtml(cards: ProjectCardData[], s: HomeStats): string {
  const budgets = BUDGET_OPTIONS.map((b) => `<a class="trial-link" href="/map">${esc(b.label)}</a>`).join('');
  const bhks = BHK_OPTIONS.map((b) => `<a class="trial-link" href="/map">${esc(b.label)}</a>`).join('');
  const go = (label: string) => `<span class="hm-tgo">${label} <i class="fas fa-arrow-right"></i></span>`;

  return `<section class="hm-sec hm-buyers">
  <div class="hm-wrap">
    <div class="hm-head hm-center">
      <span class="hm-eyebrow">For home buyers</span>
      <h2>Built for every <span class="accent">home buyer</span></h2>
      <p class="hm-sub">Everything you need to find the right home — in one place, and free for buyers.</p>
    </div>
    <div class="hm-bento">
      <div class="hm-tile hm-t-map">
        <div class="hm-tile-head">
          <span class="ic"><i class="fas fa-location-dot"></i></span>
          <div><h3>Search by location</h3><p>Every project is a pin on the map — see what's being built in the area you want.</p></div>
        </div>
        ${miniMapHtml(cards)}
        <a class="hm-tgo trial-link" href="/map">Explore the live map <i class="fas fa-arrow-right"></i></a>
      </div>

      <a class="hm-tile hm-t-rera trial-link" href="/map">
        <span class="ic"><i class="fas fa-shield-halved"></i></span>
        <h3>Verified &amp; trusted</h3>
        ${s.rera ? `<p class="hm-big"><b>${fmt(s.rera)}</b> RERA-registered projects</p>` : ''}
        <p>RERA numbers from official state registries, with the developer behind each project.</p>
        ${go('Check on the map')}
      </a>

      <a class="hm-tile hm-t-cmp trial-link" href="/map">
        <span class="ic"><i class="fas fa-code-compare"></i></span>
        <h3>Compare projects</h3>
        <div class="hm-cmp" aria-hidden="true"><span><small>Price</small><b>₹1.25 Cr</b><b>₹1.10 Cr</b></span><span><small>Possession</small><b>Dec 2029</b><b>Ready</b></span></div>
        <p>Add projects from the map and see them side by side.</p>
        ${go('Start comparing')}
      </a>

      <div class="hm-tile hm-t-budget">
        <span class="ic"><i class="fas fa-indian-rupee-sign"></i></span>
        <h3>Smart budget filters</h3>
        <p>Filter projects by budget and BHK on the live map.</p>
        <div class="hm-chiprow" aria-label="Budget">${budgets}</div>
        <div class="hm-chiprow" aria-label="BHK">${bhks}</div>
      </div>

      <a class="hm-tile hm-t-near trial-link" href="/map">
        <span class="hm-near-bg" style="background-image:url('${BUYERS_PHOTO}')" aria-hidden="true"></span>
        <div class="hm-near-tx">
          <h3>What's nearby</h3>
          <p>See schools, hospitals, metro, IT parks and malls around each project before you visit.</p>
          <div class="hm-near-chips" aria-hidden="true"><span><i class="fas fa-school"></i>Schools</span><span><i class="fas fa-hospital"></i>Hospitals</span><span><i class="fas fa-train-subway"></i>Metro</span><span><i class="fas fa-building"></i>IT parks</span><span><i class="fas fa-bag-shopping"></i>Malls</span></div>
          ${go('See it on the map')}
        </div>
      </a>

      <div class="hm-tile hm-t-save">
        <span class="ic"><i class="fas fa-heart"></i></span>
        <h3>Save &amp; shortlist — free</h3>
        <p>Create a free buyer account with just your WhatsApp number to open every project, shortlist and compare.</p>
        <div class="hm-save-btns">
          <a href="#" class="hm-btn hm-btn-white open-signup" data-role="buyer">Sign up free <i class="fas fa-arrow-right"></i></a>
          <button type="button" class="hm-bvideo" id="hmVideoBtn"><span class="play"><i class="fas fa-play"></i></span><span><b>See how it works</b><small>40 sec video</small></span></button>
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

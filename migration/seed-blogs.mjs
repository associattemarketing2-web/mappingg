// Seed the public blog with SEO articles built from the live project data.
//
//   node --env-file=.env migration/seed-blogs.mjs
//
// - Removes the old placeholder post ("welcome-to-the-mappingg-blog").
// - Generates 1200x630 cover images into public/img/blog/ (also used as the
//   Open Graph / Twitter card image). Commit them so production serves them.
// - Upserts each article by slug, so re-running refreshes the content instead
//   of creating duplicates.
//
// Project names, prices, BHK mixes, possession dates, RERA numbers and photos
// are read from the `pins` table at run time; project links use the same slug
// rules as the /projects/<slug> pages (lib/seo/slug.ts + lib/locality.ts).

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import { projectSlug, slugify } from '../lib/seo/slug.ts';
import { localitiesOf } from '../lib/locality.ts';

const OLD_SLUGS = ['welcome-to-the-mappingg-blog'];
const COVER_DIR = path.resolve('public/img/blog');

// ---- db ---------------------------------------------------------------------

function poolConfig(connectionString) {
  const url = new URL(connectionString);
  const mode = url.searchParams.get('sslmode');
  if (mode === 'disable') return { connectionString };
  url.searchParams.delete('sslmode');
  return { connectionString: url.toString(), ssl: mode ? true : { rejectUnauthorized: false } };
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required (run with --env-file=.env).');
  process.exit(1);
}
const pool = new pg.Pool(poolConfig(process.env.DATABASE_URL));

async function loadPins() {
  const { rows } = await pool.query(`select doc from pins`);
  const byNumber = new Map();
  for (const { doc } of rows) {
    if (doc.hidden === true || doc.rejected === true || doc.pending_review === true) continue;
    byNumber.set(Number(doc.number), doc);
  }
  return byNumber;
}

// ---- html helpers -------------------------------------------------------------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const STATUS = { construction: 'Under construction', upcoming: 'Upcoming', available: 'Ready to move', sold: 'Sold out' };

function makeHelpers(pins) {
  const get = (n) => {
    const p = pins.get(n);
    if (!p) throw new Error(`pin #${n} not found or not public`);
    return p;
  };
  const href = (p) => `/projects/${projectSlug(p.title, localitiesOf(p.location)[0] || '', Number(p.number))}`;
  const locality = (p) => localitiesOf(p.location)[0] || 'Pune';
  const price = (p) => (p.price || '').trim() || 'Price on request';
  const cleanRera = (r) => (r && /^P[A-Z0-9]{8,}/.test(r.trim()) ? r.trim() : '');

  /** <a> to a project page. */
  const link = (n, text) => {
    const p = get(n);
    return `<a href="${href(p)}">${esc(text || p.title)}</a>`;
  };

  /** Comparison table of projects. */
  const table = (numbers, caption) => {
    const rows = numbers
      .map(get)
      .map(
        (p) => `<tr><td>${link(Number(p.number))}<br><small>${esc(p.developer || '')}</small></td>` +
          `<td>${esc(p.configuration || '—')}</td><td>${esc(price(p))}</td>` +
          `<td>${esc(p.possession_timeline || STATUS[p.status] || '—')}</td>` +
          `<td>${cleanRera(p.rera_number) ? `<code>${esc(cleanRera(p.rera_number))}</code>` : '—'}</td></tr>`,
      )
      .join('');
    return `<div class="table-scroll"><table><caption>${esc(caption)}</caption>` +
      `<thead><tr><th>Project</th><th>Configuration</th><th>Starting price</th><th>Possession</th><th>MahaRERA no.</th></tr></thead>` +
      `<tbody>${rows}</tbody></table></div>`;
  };

  /** Image cards for projects that have a photo. */
  const gallery = (numbers) => {
    const cards = numbers
      .map(get)
      .filter((p) => p.image_url)
      .map(
        (p) => `<a class="proj-card" href="${href(p)}">` +
          `<img src="${esc(p.image_url)}" alt="${esc(`${p.title} – ${p.type || 'project'} in ${locality(p)}, Pune`)}" loading="lazy" width="240" height="240">` +
          `<span><strong>${esc(p.title)}</strong><em>${esc(locality(p))} · ${esc(price(p))}</em></span></a>`,
      )
      .join('');
    return cards ? `<div class="proj-grid">${cards}</div>` : '';
  };

  return { get, link, table, gallery, href };
}

// ---- covers -------------------------------------------------------------------

async function fetchImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** 1200x630 cover: headline on the left, a column of three project/developer images on the right. */
async function makeCover(file, { kicker, lines, imageUrls }) {
  const W = 1200, H = 630, tile = 170, gap = 20;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f5c47"/><stop offset="1" stop-color="#0a3d30"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <rect x="60" y="64" rx="18" width="${Math.round(kicker.length * 15.5) + 40}" height="40" fill="#e8f2e1"/>
    <text x="80" y="91" font-family="Segoe UI, Arial, sans-serif" font-size="20" font-weight="700" fill="#2f7a3c" letter-spacing="2">${esc(kicker.toUpperCase())}</text>
    ${lines.map((l, i) => `<text x="60" y="${178 + i * 66}" font-family="Segoe UI, Arial, sans-serif" font-size="56" font-weight="800" fill="#ffffff">${esc(l)}</text>`).join('')}
    <text x="60" y="${H - 50}" font-family="Segoe UI, Arial, sans-serif" font-size="26" font-weight="700" fill="#d9c48f">mappingg.com</text>
    <text x="250" y="${H - 50}" font-family="Segoe UI, Arial, sans-serif" font-size="22" fill="#cfe3d6">Live map · MahaRERA details · Prices</text>
  </svg>`;
  const tiles = await Promise.all(
    imageUrls.slice(0, 3).map(async (u) =>
      sharp(await fetchImage(u))
        .resize(tile, tile, { fit: 'cover' })
        .composite([{ input: Buffer.from(`<svg width="${tile}" height="${tile}"><rect width="${tile}" height="${tile}" rx="22" ry="22"/></svg>`), blend: 'dest-in' }])
        .png()
        .toBuffer(),
    ),
  );
  const top = Math.round((H - (tiles.length * tile + (tiles.length - 1) * gap)) / 2);
  await sharp(Buffer.from(svg))
    .composite(tiles.map((input, i) => ({ input, left: W - 60 - tile, top: top + i * (tile + gap) })))
    .jpeg({ quality: 84, mozjpeg: true })
    .toFile(file);
}

// ---- articles -----------------------------------------------------------------

function mundhwaArticle(h) {
  const budget = [13, 25, 18];
  const mid = [12, 4, 11, 17, 20, 35, 16, 10, 28, 23];
  const luxury = [2, 37, 6, 15, 22, 68];
  const upcoming = [207, 7, 5, 9];
  const commercial = [3, 30, 34, 24];

  return {
    slug: 'new-projects-in-mundhwa-pune',
    title: 'New Projects in Mundhwa, Pune (2026): Prices, BHK Options & RERA Details',
    seo_title: 'New Projects in Mundhwa Pune 2026: Prices & RERA',
    seo_description:
      'Compare 30+ new residential & commercial projects in Mundhwa, Pune – 2, 3 & 4 BHK flats from ₹98 Lacs to luxury villas, with MahaRERA numbers and possession dates.',
    excerpt:
      'A data-backed guide to new launches and under-construction projects in Mundhwa, Pune — budgets, BHK configurations, possession timelines and MahaRERA numbers in one place.',
    tags: ['Mundhwa', 'Pune', 'New Projects', 'Flats in Mundhwa', 'MahaRERA'],
    coverPins: [18, 15, 13],
    coverLines: ['New Projects in', 'Mundhwa, Pune', '2026 Buyer’s Guide'],
    coverKicker: 'Locality guide',
    content: `
<p>Searching for <strong>new projects in Mundhwa, Pune</strong>? Mundhwa has quietly become one of East Pune’s busiest residential micro-markets. It sits between Koregaon Park, Kharadi, Magarpatta and Hadapsar, so you get quick access to the city’s biggest IT parks without paying Koregaon Park prices. On <a href="/locations/mundhwa">Mappingg’s live map of Mundhwa</a> we track more than 30 residential, mixed-use and commercial projects here, which makes it the most active locality on our map.</p>

<p>This guide brings that data together: <strong>flats in Mundhwa by budget</strong>, BHK options, possession dates and MahaRERA registration numbers. Use it to build your shortlist before you go on site visits.</p>

<h2>Why buy property in Mundhwa?</h2>
<ul>
  <li><strong>Close to IT jobs:</strong> Kharadi’s <a href="/locations/kharadi">EON IT Park and World Trade Center</a> and Magarpatta City are a short drive away, so rental demand from working professionals stays strong.</li>
  <li><strong>Koregaon Park without the KP price tag:</strong> the North Main Road / KP Annexe side of Mundhwa gives you KP’s restaurants and schools at a lower price per sq ft.</li>
  <li><strong>Trusted developers:</strong> Godrej Properties, Panchshil Realty, Lodha, Kumar, Magarpatta Group, Mantra and Goel Ganga all have active projects in Mundhwa.</li>
  <li><strong>Lots of choice:</strong> compact 2 BHKs, 3/4 BHK family homes, villas and studio-style investment units are all on offer in the same micro-market.</li>
</ul>

${h.gallery([18, 13, 15, 4, 11, 17])}

<h2>Affordable new projects in Mundhwa (under ₹1.6 Cr)</h2>
<p>For first-time buyers, ${h.link(13)} and ${h.link(25)} start at around ₹1 Cr for 2 and 2.5 BHK homes. ${h.link(18)} offers 3 and 4 BHK homes with a flexi 25x4 payment plan.</p>
${h.table(budget, 'Budget projects in Mundhwa')}

<h2>Mid-segment 3 BHK projects in Mundhwa (₹1.7 Cr – ₹2.5 Cr)</h2>
<p>Most of Mundhwa’s supply falls in this band. These are mainly 3 and 4 BHK homes in large, amenity-rich gated communities. Popular options include ${h.link(4)}, ${h.link(11)}, ${h.link(17)} and ${h.link(16)}.</p>
${h.table(mid, '3 & 4 BHK projects in Mundhwa, ₹1.7–2.5 Cr')}

<h2>Luxury apartments &amp; villas in Mundhwa</h2>
<p>If you’re looking for larger 3.5, 4.5 and 5 BHK homes, Mundhwa now competes with Koregaon Park and Kalyani Nagar. ${h.link(15)} by Panchshil, ${h.link(37)} and ${h.link(6)} all start above ₹3 Cr, and ${h.link(22)} offers independent villas.</p>
${h.table(luxury, 'Luxury projects in Mundhwa')}

<h2>Upcoming launches in Mundhwa</h2>
<p>Several projects are taking expressions of interest (EOI) before their official launch. These include ${h.link(207)} by Kumar Corp and ${h.link(7)}. Buying at the EOI stage can get you launch pricing, but <strong>only pay a booking amount once the project has a MahaRERA registration number</strong>.</p>
${h.table(upcoming, 'Upcoming projects in Mundhwa')}

<h2>Commercial &amp; investment options</h2>
<p>Investors looking for rental income can consider studio units at ${h.link(30)} and ${h.link(34)}, or office space at ${h.link(3)} and ${h.link(24)}. Browse every <a href="/property/commercial">commercial project</a> on the map to compare.</p>
${h.table(commercial, 'Commercial projects in Mundhwa')}

<h2>Checklist before you book a flat in Mundhwa</h2>
<ol>
  <li><strong>Verify the MahaRERA number</strong> on the MahaRERA website (<a href="/blog/how-to-check-maharera-registration-number">here’s how</a>). Check the promoter, the registered carpet areas and the RERA possession date (it can be later than the date in the brochure).</li>
  <li><strong>Compare carpet area, not super built-up area.</strong> Work out the price per sq ft on carpet area.</li>
  <li><strong>Check the exact location on a map.</strong> Mundhwa is spread out, and the KP Annexe side, the Magarpatta side and the Kharadi bridge side each have very different commute times. Open the <a href="/map">live map</a> to see each project alongside its surrounding roads and infrastructure.</li>
  <li><strong>Understand the payment plan.</strong> Flexi plans such as 25x4 reduce your pre-EMI burden, but read the cancellation clauses carefully.</li>
  <li><strong>Visit at peak hours</strong> to see the real traffic on Mundhwa Road and the Kharadi bypass.</li>
</ol>

<h2>FAQs: Buying property in Mundhwa</h2>
<h3>What is the starting price of a 2 BHK in Mundhwa, Pune?</h3>
<p>Among the projects we track, new 2 BHK homes in Mundhwa start at around ₹98 Lacs to ₹1.1 Cr (for example ${h.link(13)} and ${h.link(25)}). Most 3 BHK options fall between ₹1.55 Cr and ₹2.3 Cr.</p>
<h3>Is Mundhwa good for investment?</h3>
<p>Mundhwa benefits from its proximity to Kharadi, Magarpatta and Koregaon Park, and many large developers are active here. That supports both rental demand and resale. As with any purchase, compare possession dates and the developer’s delivery record.</p>
<h3>Which big developers have projects in Mundhwa?</h3>
<p>Godrej Properties, Panchshil Realty, Lodha, Kumar, Magarpatta Group, Mantra Properties, Goel Ganga, Jhamtani and Kanchan Developers. See each one on the <a href="/developers">developers page</a>.</p>
<h3>Where can I see all Mundhwa projects on a map?</h3>
<p>Open <a href="/locations/mundhwa">Mundhwa on Mappingg</a> for the full list, or the <a href="/map">interactive map</a> to see each project with nearby roads and infrastructure.</p>

<p>Comparing localities as well? Read our guide to the <a href="/blog/best-areas-to-buy-property-in-pune">best areas to buy property in Pune</a>.</p>

<blockquote>Prices, configurations and possession dates are as listed on Mappingg in October 2026. Developers may change them at any time, so always confirm with the developer and on MahaRERA before you book.</blockquote>
`,
  };
}

function puneAreasArticle(h) {
  return {
    slug: 'best-areas-to-buy-property-in-pune',
    title: 'Best Areas to Buy Property in Pune in 2026: Locality-wise Price Guide',
    seo_title: 'Best Areas to Invest in Pune 2026: Price Guide',
    seo_description:
      'Best areas to buy a flat in Pune in 2026 — Mundhwa, Kharadi, Hinjewadi, Balewadi, Tathawade, Lohegaon, NIBM & Kalyani Nagar compared by budget, with live project prices.',
    excerpt:
      'Mundhwa, Kharadi, Hinjewadi, Balewadi, Tathawade, Lohegaon, NIBM or Kalyani Nagar? A budget-wise comparison of Pune’s top localities, with real projects, prices and possession dates.',
    tags: ['Pune', 'Real Estate Investment', 'Best Areas in Pune', 'Kharadi', 'Hinjewadi'],
    coverPins: [92, 205, 11],
    coverLines: ['Best Areas to Buy', 'Property in Pune', '2026 Price Guide'],
    coverKicker: 'Pune investment guide',
    content: `
<p>Choosing the <strong>best area to buy property in Pune</strong> comes down to three questions: where you work, what your budget is, and whether you’re buying to live in or to invest. To help, we compared Pune’s most active localities using the projects listed on the <a href="/cities/pune">Mappingg Pune map</a>, including real starting prices, BHK options and possession dates.</p>

<h2>Pune localities at a glance</h2>
<div class="table-scroll"><table>
<caption>Best areas to invest in Pune, by budget</caption>
<thead><tr><th>Locality</th><th>Best for</th><th>New projects from*</th></tr></thead>
<tbody>
<tr><td><a href="/locations/lohegaon">Lohegaon</a></td><td>Budget 2 BHK, airport connectivity</td><td>≈ ₹65 Lacs</td></tr>
<tr><td><a href="/locations/hinjewadi">Hinjewadi</a></td><td>IT professionals, townships</td><td>≈ ₹82 Lacs</td></tr>
<tr><td><a href="/locations/tathawade">Tathawade</a></td><td>Value 2/3 BHK near Hinjewadi &amp; Wakad</td><td>≈ ₹93 Lacs</td></tr>
<tr><td><a href="/locations/nibm">NIBM</a></td><td>Families, schools, quiet green areas</td><td>≈ ₹90 Lacs</td></tr>
<tr><td><a href="/locations/mundhwa">Mundhwa</a></td><td>East Pune, most choice, near KP</td><td>≈ ₹98 Lacs</td></tr>
<tr><td><a href="/locations/kharadi">Kharadi</a></td><td>EON IT Park / WTC, rental demand</td><td>≈ ₹1.12 Cr</td></tr>
<tr><td><a href="/locations/balewadi">Balewadi</a></td><td>West Pune premium, Balewadi High Street</td><td>≈ ₹1 Cr</td></tr>
<tr><td><a href="/locations/kalyani-nagar">Kalyani Nagar</a></td><td>Luxury, established neighbourhood</td><td>≈ ₹3.58 Cr</td></tr>
</tbody></table></div>
<p><small>*Lowest starting price among the projects listed on Mappingg in each locality, October 2026.</small></p>

<h2>1. Mundhwa – the most active market in East Pune</h2>
<p>With 30+ projects on our map, Mundhwa gives you the widest choice in East Pune, from ${h.link(13)} (2 BHK from about ₹98 Lacs) to ${h.link(15)} by Panchshil (3.5/4.5 BHK). It sits between Koregaon Park, Kharadi and Magarpatta. For the full project list, read our detailed guide to <a href="/blog/new-projects-in-mundhwa-pune">new projects in Mundhwa, Pune</a>.</p>
${h.gallery([13, 4, 17])}

<h2>2. Kharadi – Pune’s IT hub with steady rental demand</h2>
<p>Kharadi is home to EON IT Park and the World Trade Center, which keeps demand for rental homes high. There are new 2 and 3 BHK options at ${h.link(135)}, ${h.link(75, 'Mantra Melange')} and ${h.link(208)}, while ${h.link(92)} and ${h.link(226)} serve the 3/4 BHK segment. In Upper Kharadi, ${h.link(87)} offers a 25x4 payment plan. See every option in our <a href="/blog/new-projects-in-kharadi-pune">Kharadi new projects guide</a>.</p>
${h.table([135, 75, 208, 184, 92, 226, 87], 'New projects in Kharadi')}

<h2>3. Hinjewadi – township living near Rajiv Gandhi Infotech Park</h2>
<p>If you work in Hinjewadi, living close by can cut your commute dramatically. The 105-acre Krisala Hiranandani township in North Hinjewadi includes ${h.link(204)}, ${h.link(205)} and the upcoming ${h.link(206)}. Lodha is also active here with ${h.link(182)} and ${h.link(166)}.</p>
${h.gallery([204, 205, 166, 182])}
${h.table([204, 206, 182, 166, 205], 'New projects in Hinjewadi')}

<h2>4. Tathawade – value homes between Hinjewadi and Wakad</h2>
<p>Tathawade gives you Hinjewadi access at lower prices. ${h.link(202)} is IGBC Gold certified, ${h.link(231)} has three swimming pools and a cricket ground, and ${h.link(232)} is due for possession in December 2026.</p>
${h.table([202, 231, 232], 'New projects in Tathawade')}

<h2>5. Balewadi – West Pune’s premium lifestyle address</h2>
<p>Balewadi High Street, the sports complex and easy access to Baner and the Mumbai–Bengaluru highway make Balewadi a top choice for upgraders. Options include ${h.link(200)}, ${h.link(230)} and Majestique’s ${h.link(217)} and ${h.link(216)}.</p>
${h.table([200, 230, 217, 216], 'New projects in Balewadi')}

<h2>6. Lohegaon – the most affordable entry point</h2>
<p>Lohegaon is close to Pune Airport and the planned Ring Road, and it’s where we see the lowest entry prices. ${h.link(233)} and ${h.link(234)} start in the ₹65–67 Lacs range, and ${h.link(256)} is an upcoming project with airport-facing homes.</p>
${h.table([233, 234, 256], 'New projects in Lohegaon')}

<h2>7. NIBM – green, school-friendly South-East Pune</h2>
<p>NIBM and Undri are popular with families because they’re close to schools like Bishop’s, DPS and Euro School. ${h.link(235)} offers 2 and 3 BHK homes from about ₹90 Lacs, with possession due in December 2026.</p>

<h2>8. Kalyani Nagar – established luxury</h2>
<p>For buyers who want a mature neighbourhood, Kalyani Nagar offers premium projects such as ${h.link(194)}, a low-density 3/4 BHK development, and ${h.link(103)}, which also has duplex and penthouse options.</p>
${h.gallery([194, 103])}

<h2>How to choose the right area in Pune</h2>
<ol>
  <li><strong>Start with your commute.</strong> East Pune (Mundhwa, Kharadi) suits people working in Kharadi or Magarpatta. West Pune (Hinjewadi, Tathawade, Balewadi) suits those working in Hinjewadi or Baner.</li>
  <li><strong>Set a budget band</strong> and compare carpet-area prices within it, not across localities.</li>
  <li><strong>Prefer MahaRERA-registered projects</strong> and check the RERA possession date, not just the brochure date.</li>
  <li><strong>Look at what’s around the project.</strong> Upcoming roads, metro lines and infrastructure drive appreciation. Mappingg’s <a href="/map">live map</a> shows them next to every project.</li>
  <li><strong>Shortlist by status.</strong> Compare <a href="/status/ready-to-move">ready-to-move</a>, <a href="/status/under-construction">under-construction</a> and <a href="/status/upcoming">upcoming</a> projects according to when you need possession.</li>
</ol>

<h2>FAQs: Investing in Pune real estate</h2>
<h3>Which is the best area to invest in Pune in 2026?</h3>
<p>For rental yield near IT jobs, Kharadi, Mundhwa and Hinjewadi lead. For lower entry prices, Lohegaon and Tathawade stand out. For premium homes, look at Balewadi and Kalyani Nagar. The right answer depends on your budget and where you or your tenants work.</p>
<h3>Where can I buy a 2 BHK flat in Pune under ₹1 Cr?</h3>
<p>Lohegaon (${h.link(233)}, ${h.link(234)}), Hinjewadi (${h.link(204)}), Tathawade (${h.link(202)}), NIBM (${h.link(235)}) and Mundhwa (${h.link(13)}) all have new 2 BHK options starting under or around ₹1 Cr.</p>
<h3>Is East Pune or West Pune better for investment?</h3>
<p>Both are strong. East Pune (Kharadi, Mundhwa) is driven by the EON IT Park, WTC and Magarpatta. West Pune (Hinjewadi, Balewadi, Tathawade) is driven by Rajiv Gandhi Infotech Park and the Mumbai–Bengaluru highway. Pick the side closest to where demand comes from.</p>
<h3>How do I check if a Pune project is RERA approved?</h3>
<p>Search for the project’s MahaRERA number on the official MahaRERA portal. Our step-by-step guide explains <a href="/blog/how-to-check-maharera-registration-number">how to check a MahaRERA registration number</a>. Mappingg shows the RERA number on each <a href="/projects">project page</a> wherever the developer has shared it.</p>

<blockquote>Prices and possession timelines are as listed on Mappingg in October 2026 and may change. Always confirm with the developer and on MahaRERA before you book.</blockquote>
`,
  };
}

function kharadiArticle(h) {
  return {
    slug: 'new-projects-in-kharadi-pune',
    title: 'New Projects in Kharadi, Pune (2026): 2, 3 & 4 BHK Prices, Possession & RERA',
    seo_title: 'New Projects in Kharadi Pune 2026: Flats & Prices',
    seo_description:
      'New residential projects in Kharadi, Pune — 2, 3 & 4 BHK flats from ₹1.12 Cr near EON IT Park & WTC, with possession dates, MahaRERA numbers and a live map.',
    excerpt:
      'Flats in Kharadi near EON IT Park and the World Trade Center — every new and under-construction project on our map, with BHK options, starting prices, possession dates and MahaRERA numbers.',
    tags: ['Kharadi', 'Pune', 'New Projects', 'Flats in Kharadi', 'EON IT Park'],
    coverPins: [92, 81, 135],
    coverLines: ['New Projects in', 'Kharadi, Pune', '2026 Buyer’s Guide'],
    coverKicker: 'Locality guide',
    content: `
<p>Kharadi is East Pune’s biggest employment hub. EON IT Park, the World Trade Center and a string of large office campuses bring thousands of professionals here every day, and that keeps demand for <strong>flats in Kharadi</strong> strong for both homebuyers and investors. This guide lists the <strong>new projects in Kharadi, Pune</strong> that we track on the <a href="/locations/kharadi">Mappingg Kharadi map</a>, with prices, BHK options, possession dates and MahaRERA numbers.</p>

<h2>Why buy a flat in Kharadi?</h2>
<ul>
  <li><strong>Walk-to-work potential:</strong> many projects are within a short drive of ${h.link(78, 'EON IT Park')} and the ${h.link(79, 'World Trade Center')}.</li>
  <li><strong>Steady rental demand</strong> from IT and corporate tenants, which matters if you are buying to invest.</li>
  <li><strong>Established social infrastructure:</strong> schools, hospitals, malls and the riverside stretch along Kharadi’s eastern edge.</li>
  <li><strong>Close to Mundhwa, Viman Nagar and Wagholi</strong>, so you can compare a wide range of budgets nearby. See our <a href="/blog/new-projects-in-mundhwa-pune">Mundhwa guide</a> for the neighbouring market.</li>
</ul>

${h.gallery([92, 81, 135, 184, 75, 87])}

<h2>2 &amp; 3 BHK projects in Kharadi under ₹1.8 Cr</h2>
<p>The entry point for new homes in Kharadi is a little over ₹1.1 Cr. ${h.link(135)} by Venkatesh Buildcon offers 2, 3 and 4 BHK homes, ${h.link(208)} has 2 and 3 BHK options, and ${h.link(75)} (2 and 3 BHK plus shops) sits on the Kharadi–Wadgaon Sheri side. ${h.link(184)} offers river-facing 3 BHK homes.</p>
${h.table([135, 75, 134, 208, 184], 'Kharadi projects under ₹1.8 Cr')}

<h2>Premium 3, 4 &amp; 4.5 BHK homes in Kharadi</h2>
<p>For larger homes, ${h.link(92)} and ${h.link(226)} cover the 3–4.5 BHK segment from just under ₹2 Cr, while ${h.link(81)} offers 3.5 and 4.5 BHK residences that are nearing possession. ${h.link(84)} offers villas by invitation only. In Upper Kharadi, ${h.link(87)} starts at around ₹2.25 Cr with a 25x4 payment plan.</p>
${h.table([92, 226, 87, 81, 84], 'Premium projects in Kharadi')}

<h2>Commercial &amp; office space in Kharadi</h2>
<p>Kharadi’s offices are what drive its housing demand. On the map you can see ${h.link(78)}, ${h.link(91)}, the ${h.link(79)}, ${h.link(88)} and ${h.link(89)}. Browse all <a href="/property/commercial">commercial projects</a> to compare.</p>

<h2>Things to check before booking in Kharadi</h2>
<ol>
  <li><strong>Which side of Kharadi?</strong> Central Kharadi, the riverside, Upper Kharadi and the Wadgaon Sheri side have very different commutes. Check each project on the <a href="/map">live map</a>.</li>
  <li><strong>MahaRERA registration and possession date.</strong> Match the brochure’s date with the date on MahaRERA. Our guide shows <a href="/blog/how-to-check-maharera-registration-number">how to check a MahaRERA number</a>.</li>
  <li><strong>Carpet area and loading.</strong> Compare price per sq ft on carpet area only.</li>
  <li><strong>Peak-hour traffic</strong> on Nagar Road and the Kharadi bypass.</li>
</ol>

<h2>FAQs: Buying property in Kharadi</h2>
<h3>What is the price of a 2 BHK in Kharadi?</h3>
<p>Among the projects on our map, new 2 BHK homes in Kharadi start at around ₹1.12–1.26 Cr (for example ${h.link(135)} and ${h.link(208)}).</p>
<h3>Is Kharadi good for investment in 2026?</h3>
<p>Kharadi’s large office base supports rental demand and resale. Compare possession dates, the developer’s track record and the exact micro-location before you decide. Our <a href="/blog/best-areas-to-buy-property-in-pune">Pune locality comparison</a> puts Kharadi side by side with other areas.</p>
<h3>Which developers are building in Kharadi?</h3>
<p>Panchshil Realty, Majestique Landmark, Mantra Properties, Marvel Realtors, Lodha, Venkatesh Buildcon, Duville Estate and SSPL, among others. See the <a href="/developers">developers page</a>.</p>

<blockquote>Prices, configurations and possession dates are as listed on Mappingg in October 2026 and may change. Always confirm with the developer and on MahaRERA before you book.</blockquote>
`,
  };
}

function reraArticle(h) {
  return {
    slug: 'how-to-check-maharera-registration-number',
    title: 'How to Check a MahaRERA Registration Number Before You Buy (2026 Guide)',
    seo_title: 'How to Check MahaRERA Registration Number (2026)',
    seo_description:
      'Step-by-step guide to verifying a MahaRERA project registration number — what the number means, what to check on the MahaRERA website, and red flags to watch for.',
    excerpt:
      'A MahaRERA number is the single most important check before booking a flat in Maharashtra. Here is how to read it, verify it on the MahaRERA website and spot red flags.',
    tags: ['MahaRERA', 'RERA', 'Home Buying Guide', 'Pune', 'Maharashtra'],
    coverPins: [16, 17, 3],
    coverLines: ['How to Check a', 'MahaRERA Number', 'Before You Buy'],
    coverKicker: 'Buyer’s guide',
    content: `
<p>Before you pay a booking amount for any under-construction flat in Maharashtra, you should <strong>check the project’s MahaRERA registration number</strong>. It takes five minutes and tells you whether the project is legally registered, who the promoter is, what was approved and when the developer has committed to finish. This guide explains how to read a MahaRERA number, how to verify it, and what to look for.</p>

<h2>What is MahaRERA?</h2>
<p>MahaRERA is the Maharashtra Real Estate Regulatory Authority, set up under the Real Estate (Regulation and Development) Act, 2016 (RERA). Under the Act, most new projects (generally those on more than 500 sq m of land or with more than eight apartments) must be registered before they are advertised or sold. Developers must also keep 70% of the money collected from buyers in a separate account for that project. Real estate agents have to register too.</p>

<h2>What does a MahaRERA number look like?</h2>
<ul>
  <li><strong>Older project numbers</strong> start with <code>P</code> followed by 11 digits, for example ${h.link(16)} (<code>P52100053239</code>).</li>
  <li><strong>Newer project numbers</strong> on our map are longer and start with two letters. In our data, <code>PR</code> numbers belong to residential projects (for example ${h.link(17)}, <code>PR1260002500852</code>), <code>PC</code> to commercial projects (${h.link(3)}, <code>PC1260002500325</code>) and <code>PM</code> to mixed-use projects (${h.link(4)}, <code>PM1260002501385</code>).</li>
  <li><strong>Agent numbers</strong> start with <code>A</code>. They belong to a broker or advisory firm, not a project, so don’t mistake one for a project registration.</li>
</ul>
<p>Large projects are often registered in phases or by tower, so one project can have several MahaRERA numbers. Make sure the number matches <em>your</em> tower or phase.</p>

<h2>How to check a MahaRERA number: step by step</h2>
<ol>
  <li><strong>Get the number from the developer.</strong> It must be printed on every advertisement and brochure, and newer adverts also carry a MahaRERA QR code you can scan.</li>
  <li><strong>Open the official MahaRERA website</strong> (maharera.maharashtra.gov.in) and go to the search for registered projects.</li>
  <li><strong>Search by registration number</strong> (or by project name and district) and open the project’s details.</li>
  <li><strong>Match the details</strong> against what the sales team told you, using the checklist below.</li>
</ol>

<h2>What to check on the MahaRERA project page</h2>
<div class="table-scroll"><table>
<caption>MahaRERA verification checklist</caption>
<thead><tr><th>Check</th><th>Why it matters</th></tr></thead>
<tbody>
<tr><td>Promoter name</td><td>Should match the company on your booking form and agreement.</td></tr>
<tr><td>Proposed completion date</td><td>This is the legally committed date. It is often later than the brochure date.</td></tr>
<tr><td>Extensions</td><td>Repeated extensions can signal delays.</td></tr>
<tr><td>Approved plans &amp; carpet areas</td><td>Your flat’s carpet area should match the registered unit type.</td></tr>
<tr><td>Project / tower covered</td><td>Confirm your tower or phase is part of this registration.</td></tr>
<tr><td>Progress updates</td><td>Shows how far construction has actually reached.</td></tr>
<tr><td>Complaints &amp; litigation</td><td>Check for open complaints or cases against the project.</td></tr>
</tbody></table></div>

<h2>Red flags</h2>
<ul>
  <li>No MahaRERA number on adverts, or “registration applied for” when you are being asked to pay.</li>
  <li>The number belongs to a different project, tower or promoter.</li>
  <li>The completion date on MahaRERA is much later than the one you were promised.</li>
  <li>Pressure to pay large sums before signing a registered agreement for sale.</li>
</ul>

<h2>See RERA numbers on the map</h2>
<p>Mappingg shows the MahaRERA number on each <a href="/projects">project page</a> wherever the developer has shared it, alongside the project’s location, configuration, price and possession timeline. Browse projects by area, for example <a href="/blog/new-projects-in-mundhwa-pune">Mundhwa</a> or <a href="/blog/new-projects-in-kharadi-pune">Kharadi</a>, or compare <a href="/blog/best-areas-to-buy-property-in-pune">the best areas to buy in Pune</a>.</p>

<h2>FAQs</h2>
<h3>Is it safe to buy a flat without a MahaRERA number?</h3>
<p>For a project that is required to register, no. Without registration you lose the protections RERA gives buyers, such as a committed completion date and a separate project account.</p>
<h3>Can one project have more than one MahaRERA number?</h3>
<p>Yes. Phases or towers are often registered separately, so check the number for your specific tower.</p>
<h3>Do ready-to-move flats need a RERA number?</h3>
<p>Projects that received their completion or occupancy certificate before RERA came into force may not have one. For anything still under construction, ask for the number.</p>

<blockquote>This guide is general information, not legal advice. For a specific purchase, verify every detail on the official MahaRERA website and consult a property lawyer.</blockquote>
`,
  };
}

// ---- main ---------------------------------------------------------------------

async function upsert(post) {
  const now = new Date().toISOString();
  const { rows } = await pool.query(`select id, doc from posts where doc @> $1::jsonb`, [JSON.stringify({ slug: post.slug })]);
  const existing = rows[0]?.doc;
  const id = existing?.id || randomUUID();
  const doc = {
    id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    content: post.content.trim(),
    cover_image: post.cover_image,
    tags: post.tags,
    author: 'Mappingg Team',
    status: 'published',
    seo_title: post.seo_title,
    seo_description: post.seo_description,
    created_at: existing?.created_at || now,
    updated_at: now,
    published_at: existing?.published_at || now,
  };
  await pool.query(
    `insert into posts (id, doc) values ($1, $2::jsonb) on conflict (id) do update set doc = excluded.doc`,
    [id, JSON.stringify(doc)],
  );
  console.log(`${existing ? 'Updated' : 'Created'}: /blog/${post.slug}`);
}

async function main() {
  const pins = await loadPins();
  const h = makeHelpers(pins);
  const articles = [mundhwaArticle(h), puneAreasArticle(h), kharadiArticle(h), reraArticle(h)];

  // Sanity: every slug used by the articles' internal links must be stable.
  for (const a of articles) if (slugify(a.slug) !== a.slug) throw new Error(`bad slug ${a.slug}`);

  await mkdir(COVER_DIR, { recursive: true });
  for (const a of articles) {
    const file = `${a.slug}.jpg`;
    await makeCover(path.join(COVER_DIR, file), {
      kicker: a.coverKicker,
      lines: a.coverLines,
      imageUrls: a.coverPins.map((n) => h.get(n).image_url),
    });
    a.cover_image = `/img/blog/${file}`;
    console.log(`Cover: public/img/blog/${file}`);
  }

  for (const slug of OLD_SLUGS) {
    const res = await pool.query(`delete from posts where doc @> $1::jsonb`, [JSON.stringify({ slug })]);
    if (res.rowCount) console.log(`Removed: /blog/${slug}`);
  }
  for (const a of articles) await upsert(a);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

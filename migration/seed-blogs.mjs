// Seed the public blog with SEO articles built from the live project data.
//
//   node --env-file=.env migration/seed-blogs.mjs [--dry-run] [--only=slug-a,slug-b]
//
// --only seeds just the named posts; every other post is left untouched.
// --dry-run renders the covers and builds every article but writes nothing to
// the database — use it to commit the new covers before the posts go live.
//
// - Removes the old placeholder post ("welcome-to-the-mappingg-blog").
// - Renders a 1200x630 cover per article (migration/blog-covers.mjs) from a real,
//   CC-licensed photo of the area (migration/blog-photos/, credited at the end of
//   each article) into public/img/blog/, also used as the Open Graph / Twitter card.
//   Commit and deploy them before seeding, so production can serve them.
// - Upserts each article by slug, so re-running refreshes the content instead
//   of creating duplicates.
//
// Project names, prices, BHK mixes, possession dates, RERA numbers and photos
// are read from the `pins` table at run time; project links use the same slug
// rules as the /projects/<slug> pages (lib/seo/slug.ts + lib/locality.ts).

import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { projectSlug, slugify } from '../lib/seo/slug.ts';
import { localitiesOf } from '../lib/locality.ts';
import { makeCover } from './blog-covers.mjs';

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
  // MahaRERA (P52100054261, PR1264042501296) or Karnataka RERA (PRM/KA/RERA/…).
  const cleanRera = (r) => (r && /^(P[A-Z0-9]{8,}|PRM\/KA\/RERA\/\d)/.test(r.trim()) ? r.trim() : '');

  /** <a> to a project page. */
  const link = (n, text) => {
    const p = get(n);
    return `<a href="${href(p)}">${esc(text || p.title)}</a>`;
  };

  /** Comparison table of projects. `reraLabel` names the RERA column (K-RERA outside Maharashtra). */
  const table = (numbers, caption, reraLabel = 'MahaRERA no.') => {
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
      `<thead><tr><th>Project</th><th>Configuration</th><th>Starting price</th><th>Possession</th><th>${esc(reraLabel)}</th></tr></thead>` +
      `<tbody>${rows}</tbody></table></div>`;
  };

  /** Image cards for projects that have a photo. `city` goes into the image alt text. */
  const gallery = (numbers, city = 'Pune') => {
    const cards = numbers
      .map(get)
      .filter((p) => p.image_url)
      .map(
        (p) => `<a class="proj-card" href="${href(p)}">` +
          `<img src="${esc(p.image_url)}" alt="${esc(`${p.title} – ${p.type || 'project'} in ${locality(p)}, ${city}`)}" loading="lazy" width="240" height="240">` +
          `<span><strong>${esc(p.title)}</strong><em>${esc(locality(p))} · ${esc(price(p))}</em></span></a>`,
      )
      .join('');
    return cards ? `<div class="proj-grid">${cards}</div>` : '';
  };

  /** <a> to a locality page; throws if no public project is in that locality. */
  const localities = new Set([...pins.values()].map((p) => localitiesOf(p.location)[0]).filter(Boolean));
  const loc = (name, text) => {
    if (!localities.has(name)) throw new Error(`locality ${name} has no public projects`);
    return `<a href="/locations/${slugify(name)}">${esc(text || name)}</a>`;
  };

  return { get, link, loc, table, gallery, href };
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
    cover: {
      theme: 'dusk',
      kicker: 'Locality guide',
      lines: ['New Projects in', 'Mundhwa, Pune', '2026 Buyer’s Guide'],
      stats: [['30+', 'projects tracked'], ['₹98 L', '2 BHK from'], ['2–5 BHK', 'plus villas']],
    },
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
    cover: {
      theme: 'emerald',
      kicker: 'Pune investment guide',
      lines: ['Best Areas to Buy', 'Property in Pune', '2026 Price Guide'],
      stats: [['8', 'localities compared'], ['₹65 L', 'lowest entry'], ['₹3.5 Cr+', 'luxury picks']],
    },
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
<p>Lohegaon (${h.link(233)}, ${h.link(234)}), Hinjewadi (${h.link(204)}), Tathawade (${h.link(202)}), NIBM (${h.link(235)}) and Mundhwa (${h.link(13)}) all have new 2 BHK options starting under or around ₹1 Cr. See the full list in our guide to <a href="/blog/flats-under-1-crore-in-pune">flats under ₹1 crore in Pune</a>.</p>
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
    cover: {
      theme: 'midnight',
      kicker: 'Locality guide',
      lines: ['New Projects in', 'Kharadi, Pune', '2026 Buyer’s Guide'],
      stats: [['20+', 'projects tracked'], ['₹1.12 Cr', '2 BHK from'], ['EON · WTC', 'IT hubs nearby']],
    },
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
    cover: {
      theme: 'forest',
      kicker: 'Buyer’s guide',
      lines: ['How to Check a', 'MahaRERA Number', 'Before You Buy'],
      stats: [['5 min', 'to verify'], ['7', 'checks to run'], ['Free', 'on MahaRERA']],
    },
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

function westPuneArticle(h) {
  return {
    slug: 'new-projects-in-hinjewadi-baner-balewadi-pune',
    title: 'New Projects in Hinjewadi, Baner, Balewadi & Tathawade (2026): West Pune Price Guide',
    seo_title: 'New Projects in Hinjewadi, Baner & Balewadi 2026',
    seo_description:
      'New flats in West Pune’s IT belt — Hinjewadi, Baner, Balewadi, Tathawade, Wakad & Mahalunge. 2, 3 & 4 BHK from ₹74 Lacs, with possession dates and MahaRERA numbers.',
    excerpt:
      'Working in Hinjewadi or Baner? Every new project we track across West Pune’s IT belt — Hinjewadi, Baner, Balewadi, Tathawade, Wakad, Sus and Mahalunge — sorted by budget.',
    tags: ['Hinjewadi', 'Baner', 'Balewadi', 'West Pune', 'New Projects'],
    cover: {
      theme: 'sunrise',
      kicker: 'West Pune guide',
      lines: ['New Projects in', 'Hinjewadi, Baner', '& Balewadi 2026'],
      stats: [['20+', 'projects tracked'], ['₹74 L', 'starting price'], ['2–4.5 BHK', 'configurations']],
    },
    content: `
<p>West Pune’s IT belt runs from <strong>Rajiv Gandhi Infotech Park in Hinjewadi</strong> through Wakad and Tathawade to Baner, Balewadi and Aundh. It’s where many of Pune’s tech professionals work, and the area has some of the city’s biggest new launches. This guide lists every <strong>new project in Hinjewadi, Baner, Balewadi and Tathawade</strong> that we track on the <a href="/map">Mappingg live map</a>, sorted by budget, with BHK options, possession dates and MahaRERA numbers.</p>

<h2>Why buy in West Pune?</h2>
<ul>
  <li><strong>Short commute to IT jobs:</strong> Hinjewadi Phases 1–3, Baner and Balewadi are all office hubs, so homes here rarely struggle to find tenants.</li>
  <li><strong>Large townships:</strong> the 105-acre Krisala Hiranandani township in ${h.loc('Hinjewadi')} and Mahindra’s ${h.link(198)} in ${h.loc('Mahalunge')} come with schools, retail and open spaces built in.</li>
  <li><strong>Metro and highway access:</strong> the Hinjewadi–Shivajinagar metro line and the Mumbai–Bengaluru highway connect the belt to the rest of the city.</li>
  <li><strong>Every budget:</strong> from 2 BHKs under ₹1 Cr in Hinjewadi, Sus and Tathawade to 4.5 BHK residences in Baner and Aundh.</li>
</ul>

${h.gallery([204, 182, 201, 217, 198, 202])}

<h2>West Pune projects under ₹1 Cr</h2>
<p>The best entry points are in the townships. ${h.link(204)} and the upcoming ${h.link(206)} in the Krisala Hiranandani township start at ₹82–85 Lacs, and ${h.link(203)} offers 2, 3 and 3.5 BHK homes in central Hinjewadi. ${h.link(199)} in ${h.loc('Sus')} starts at about ₹74 Lacs, and ${h.link(202)} in ${h.loc('Tathawade')} is IGBC Gold certified.</p>
${h.table([199, 204, 206, 198, 203, 202, 231], 'West Pune projects starting under ₹1 Cr')}

<h2>2 &amp; 3 BHK projects from ₹1 Cr to ₹2 Cr</h2>
<p>This is where most buyers in West Pune land. Lodha’s ${h.link(182)} and ${h.link(166)} in Hinjewadi, ${h.link(201)} in ${h.loc('Baner')}, and ${h.link(200)} and ${h.link(230)} in ${h.loc('Balewadi')} all start between ₹1 Cr and ₹1.45 Cr. In Wakad, ${h.link(246)} has just six flats per floor and a metro station within walking distance.</p>
${h.table([201, 230, 182, 200, 232, 246, 166, 217], 'West Pune projects from ₹1 Cr to ₹2 Cr')}

<h2>Premium 3, 4 &amp; 4.5 BHK homes</h2>
<p>For bigger homes, ${h.link(205)} in the Hiranandani township offers 3 BHK, 4 BHK and duplex options, and Majestique’s ${h.link(216)} in Balewadi starts at about ₹1.88 Cr. At the top end, ${h.link(215)} in Baner, ${h.link(162)} in Balewadi and ${h.link(181)} in ${h.loc('Aundh')} are 4 and 4.5 BHK residences.</p>
${h.table([205, 216, 215, 162, 181], 'Premium projects in West Pune')}

<h2>Which West Pune locality suits you?</h2>
<div class="table-scroll"><table>
<caption>West Pune localities compared</caption>
<thead><tr><th>Locality</th><th>Best for</th><th>Projects to look at</th></tr></thead>
<tbody>
<tr><td>${h.loc('Hinjewadi')}</td><td>Walk-to-work, townships, first homes</td><td>${h.link(204)}, ${h.link(203)}, ${h.link(182)}</td></tr>
<tr><td>${h.loc('Tathawade')} &amp; ${h.loc('Wakad')}</td><td>Value 2/3 BHK between Hinjewadi and the highway</td><td>${h.link(202)}, ${h.link(231)}, ${h.link(246)}</td></tr>
<tr><td>${h.loc('Balewadi')}</td><td>Upgraders, Balewadi High Street, sports complex</td><td>${h.link(200)}, ${h.link(230)}, ${h.link(217)}</td></tr>
<tr><td>${h.loc('Baner')} &amp; ${h.loc('Aundh')}</td><td>Established neighbourhoods, larger homes</td><td>${h.link(201)}, ${h.link(215)}, ${h.link(181)}</td></tr>
<tr><td>${h.loc('Mahalunge')} &amp; ${h.loc('Sus')}</td><td>Newer, greener pockets with lower entry prices</td><td>${h.link(198)}, ${h.link(199)}</td></tr>
</tbody></table></div>

<h2>Before you book in West Pune</h2>
<ol>
  <li><strong>Check which Hinjewadi phase you’ll commute to.</strong> Traffic between Phase 1, Phase 3 and Wakad can add a lot of time at peak hours. Look at the project on the <a href="/map">live map</a> alongside the roads and the metro line.</li>
  <li><strong>Read the township’s phasing.</strong> In large townships, amenities are often delivered in phases. Ask which ones will be ready when you get possession.</li>
  <li><strong>Verify the MahaRERA registration</strong> for your specific tower. Our guide shows <a href="/blog/how-to-check-maharera-registration-number">how to check a MahaRERA number</a>.</li>
  <li><strong>Compare carpet areas,</strong> not super built-up areas, when you compare prices across projects.</li>
</ol>

<h2>FAQs: Buying in Hinjewadi, Baner &amp; Balewadi</h2>
<h3>What is the cheapest new 2 BHK near Hinjewadi?</h3>
<p>Among the projects on our map, ${h.link(199)} in Sus (from about ₹74 Lacs), ${h.link(204)} in Hinjewadi (from ₹82 Lacs) and ${h.link(198)} in Mahalunge (from ₹90 Lacs) are the lowest starting prices in the belt.</p>
<h3>Is Baner or Balewadi better for a family home?</h3>
<p>Both are established, with good schools and retail. Balewadi has newer high-rise supply around Balewadi High Street. Baner has more standalone and boutique buildings, such as ${h.link(201)}. Compare both on the <a href="/map">map</a> by commute and budget.</p>
<h3>Which projects in West Pune are close to possession?</h3>
<p>${h.link(181)} (November 2026) and ${h.link(230)}, ${h.link(231)} and ${h.link(232)} (December 2026) have the nearest possession dates among the projects listed here.</p>

<p>Comparing West Pune with East Pune? Read our guides to <a href="/blog/new-projects-in-kharadi-pune">Kharadi</a>, <a href="/blog/new-projects-in-east-pune-hadapsar-viman-nagar-lohegaon">Hadapsar, Viman Nagar &amp; Lohegaon</a> and the <a href="/blog/best-areas-to-buy-property-in-pune">best areas to buy in Pune</a>.</p>

<blockquote>Prices, configurations and possession dates are as listed on Mappingg in October 2026 and may change. Always confirm with the developer and on MahaRERA before you book.</blockquote>
`,
  };
}

function pcmcArticle(h) {
  return {
    slug: 'new-projects-in-pimpri-chinchwad-pcmc',
    title: 'New Projects in Pimpri-Chinchwad (PCMC) 2026: Ravet, Pimple Saudagar, Chikhali & More',
    seo_title: 'New Projects in Pimpri-Chinchwad (PCMC) 2026',
    seo_description:
      'New flats in Pimpri-Chinchwad — Ravet, Pimple Saudagar, Chikhali, Thergaon, Moshi, Charholi & Dapodi. 1, 2 & 3 BHK from ₹30 Lacs, with MahaRERA numbers and possession dates.',
    excerpt:
      'PCMC has some of the best-value homes in the Pune region. Here are the new projects we track in Ravet, Pimple Saudagar, Chikhali, Thergaon, Moshi, Charholi, Dudulgaon and Dapodi.',
    tags: ['PCMC', 'Pimpri-Chinchwad', 'Ravet', 'Pimple Saudagar', 'Affordable Homes'],
    cover: {
      theme: 'metro',
      kicker: 'PCMC guide',
      lines: ['New Projects in', 'Pimpri-Chinchwad', 'PCMC 2026 Guide'],
      stats: [['15+', 'projects tracked'], ['₹30 L', 'starting price'], ['1–4 BHK', 'configurations']],
    },
    content: `
<p><strong>Pimpri-Chinchwad (PCMC)</strong> is Pune’s twin city and one of the region’s fastest-growing housing markets. It has the auto and manufacturing belt, quick access to Hinjewadi, the Pune metro, and some of the <strong>most affordable new flats</strong> in the Pune region. This guide lists the new projects we track in PCMC’s localities, sorted by budget, with BHK options, possession dates and MahaRERA numbers.</p>

<h2>Why buy in Pimpri-Chinchwad?</h2>
<ul>
  <li><strong>Lower prices than Pune city:</strong> new 1 and 2 BHK homes start from about ₹30 Lacs in Chikhali, well below most of Pune.</li>
  <li><strong>Metro connectivity:</strong> the PCMC–Swargate metro line runs through Pimpri, Chinchwad and Dapodi, and several projects advertise metro stations within a few minutes.</li>
  <li><strong>Close to Hinjewadi:</strong> Ravet, Thergaon and Pimple Saudagar are a short drive from Rajiv Gandhi Infotech Park, which makes them popular with IT professionals.</li>
  <li><strong>Planned growth:</strong> PCMC is a well-planned municipal corporation with wide roads, parks and the Pradhikaran sectors.</li>
</ul>

<h2>Affordable 1 &amp; 2 BHK flats under ₹60 Lacs</h2>
<p>${h.loc('Chikhali')} has the lowest prices on our map. ${h.link(244)} offers 1 and 2 BHK homes from ₹30 Lacs with possession due in December 2026, and ${h.link(240)} is a low-density, road-touch project from ₹35 Lacs.</p>
${h.table([244, 240], 'PCMC projects under ₹60 Lacs')}

<h2>2 &amp; 3 BHK projects from ₹60 Lacs to ₹1.2 Cr</h2>
<p>Most PCMC buyers shop in this band. ${h.link(249)} in Dudulgaon has a dedicated 2,000 sq ft amenity area for women, ${h.link(251)} in ${h.loc('DAPODI', 'Dapodi')} is a few minutes from the railway and metro stations, and ${h.link(241)} in ${h.loc('CHARHOLI', 'Charholi')} offers 2 and 3 BHK homes. ${h.link(242)} sits in the centre of ${h.loc('MOSHI', 'Moshi')}, and ${h.link(238)} in ${h.loc('Ravet')} has amenities on the 17th floor.</p>
${h.table([249, 251, 241, 242, 238, 248], 'PCMC projects from ₹60 Lacs to ₹1.2 Cr')}

<h2>Mid-premium &amp; large homes</h2>
<p>For bigger homes, ${h.link(228)} and ${h.link(255)} in ${h.loc('Thergaon')} are low-density projects with large carpet areas, and ${h.link(247)} in ${h.loc('Pimple Saudgar', 'Pimple Saudagar')} is surrounded by defence greenery. ${h.link(236)} is a rare <strong>ready-to-move</strong> 3 and 4 BHK option in Pimple Saudagar. Near the Akurdi metro station, ${h.link(227)} offers 3, 4 and 4.5 BHK homes from ₹1.63 Cr.</p>
${h.table([228, 247, 255, 236], 'Larger homes in PCMC')}

<h2>Shops &amp; offices in PCMC</h2>
<p>Investors can look at ${h.link(61)}, an office project, or the shops at ${h.link(243)} in ${h.loc('Sanghvi', 'Sangvi')}, which have main-road visibility. Browse all <a href="/property/commercial">commercial projects</a> to compare.</p>

<h2>Things to check before booking in PCMC</h2>
<ol>
  <li><strong>Distance to the metro and the highway.</strong> Check the walk to the nearest station on the <a href="/map">live map</a>, not just the brochure’s “minutes away”.</li>
  <li><strong>Water supply and road access,</strong> especially in fast-growing pockets like Chikhali, Moshi and Charholi.</li>
  <li><strong>The MahaRERA number for your tower.</strong> Several projects here have more than one registration. Here’s <a href="/blog/how-to-check-maharera-registration-number">how to check a MahaRERA number</a>.</li>
  <li><strong>The real possession date.</strong> Match the brochure date with the MahaRERA completion date.</li>
</ol>

<h2>FAQs: Buying property in PCMC</h2>
<h3>Where can I buy a flat in PCMC under ₹50 Lacs?</h3>
<p>Among the projects on our map, ${h.link(244)} (from ₹30 Lacs) and ${h.link(240)} (from ₹35 Lacs) in Chikhali are the options under ₹50 Lacs.</p>
<h3>Is PCMC good for investment?</h3>
<p>PCMC combines lower entry prices with metro connectivity and access to Hinjewadi, so it suits first-time buyers and rental investors. Compare the micro-location and the developer’s track record before you book.</p>
<h3>Are there ready-to-move flats in PCMC?</h3>
<p>Yes. ${h.link(236)} in Pimple Saudagar has completed possession. Read our guide to <a href="/blog/ready-to-move-vs-under-construction-flats-pune">ready-to-move vs under-construction flats</a> to decide which suits you.</p>

<p>Also near PCMC: <a href="/blog/new-projects-in-hinjewadi-baner-balewadi-pune">new projects in Hinjewadi, Baner, Balewadi &amp; Tathawade</a>.</p>

<blockquote>Prices, configurations and possession dates are as listed on Mappingg in October 2026 and may change. Always confirm with the developer and on MahaRERA before you book.</blockquote>
`,
  };
}

function eastPuneArticle(h) {
  return {
    slug: 'new-projects-in-east-pune-hadapsar-viman-nagar-lohegaon',
    title: 'New Projects in East Pune (2026): Hadapsar, Viman Nagar, Lohegaon, Kalyani Nagar & Koregaon Park',
    seo_title: 'New Projects in Hadapsar, Viman Nagar & Lohegaon 2026',
    seo_description:
      'New flats in East Pune beyond Kharadi — Hadapsar, Magarpatta, Viman Nagar, Lohegaon, Kalyani Nagar, Koregaon Park & Undri. From ₹45 Lacs to ultra-luxury, with RERA details.',
    excerpt:
      'From ₹45 Lacs starter homes in Hadapsar to luxury residences in Koregaon Park and Kalyani Nagar — every new project we track in East Pune, beyond Kharadi and Mundhwa.',
    tags: ['Hadapsar', 'Viman Nagar', 'Lohegaon', 'Kalyani Nagar', 'East Pune'],
    cover: {
      theme: 'sky',
      kicker: 'East Pune guide',
      lines: ['New Projects in', 'Hadapsar, Viman', 'Nagar & Lohegaon'],
      stats: [['25+', 'projects tracked'], ['₹45 L', 'starting price'], ['Airport', 'next door']],
    },
    content: `
<p>East Pune is more than Kharadi and Mundhwa. Around them sit <strong>Hadapsar and Magarpatta</strong> in the south, <strong>Viman Nagar and Lohegaon</strong> by the airport, and the established luxury neighbourhoods of <strong>Kalyani Nagar and Koregaon Park</strong>. Further south-east, Undri, NIBM and Mohammadwadi offer some of the city’s most affordable new homes. This guide lists the <strong>new projects in East Pune</strong> that we track on the <a href="/map">live map</a>, locality by locality.</p>

<p>Looking for Kharadi or Mundhwa? They have their own guides: <a href="/blog/new-projects-in-kharadi-pune">new projects in Kharadi</a> and <a href="/blog/new-projects-in-mundhwa-pune">new projects in Mundhwa</a>.</p>

${h.gallery([221, 210, 136, 194, 118, 211])}

<h2>Hadapsar &amp; Magarpatta: from starter homes to ready 3.5 BHKs</h2>
<p>${h.loc('Hadapsar')} has the widest price range in East Pune. ${h.link(221)} offers 1 and 2 BHK homes from ₹44.99 Lacs, and ${h.link(210)} has 2 and 3 BHKs from ₹66 Lacs. ${h.link(114)} is nearing possession, and ${h.link(93)} has 3.5 BHK homes with ready possession. Inside ${h.loc('Magarpatta')}, ${h.link(47)} offers 2 and 3 BHK homes, and ${h.link(113)} by Shapoorji Pallonji is in nearby ${h.loc('Manjri')}.</p>
${h.table([221, 210, 114, 47, 113, 93], 'New projects in Hadapsar, Magarpatta & Manjri')}

<h2>Viman Nagar, Lohegaon &amp; Dhanori: close to the airport</h2>
<p>${h.loc('Lohegaon')} is the most affordable airport-side market. ${h.link(233)} and ${h.link(234)} start at about ₹65 Lacs, and the upcoming ${h.link(256)} offers airport-facing flats with an infinity pool. ${h.link(165)} in ${h.loc('Dhanori')} starts at ₹81 Lacs. In ${h.loc('Viman Nagar')}, ${h.link(136)} (5 minutes from the airport) and the IGBC Platinum-certified ${h.link(101)} are larger 3.5 and 4.5 BHK homes.</p>
${h.table([233, 234, 256, 165, 136, 101], 'New projects near Pune Airport')}

<h2>Kalyani Nagar &amp; Koregaon Park: established luxury</h2>
<p>${h.loc('Koregaon Park')} and ${h.loc('Kalyani Nagar')} are East Pune’s most established addresses. ${h.link(164)} in Koregaon Park starts at ₹1.2 Cr and is nearing possession. For larger homes, look at ${h.link(194)} (a low-density 3 and 4 BHK project), ${h.link(103)} (with duplexes and penthouses), ${h.link(38)} and ${h.link(118)}. ${h.link(197)} by Panchshil is the top of the market.</p>
${h.table([164, 194, 103, 38, 118], 'Luxury projects in Kalyani Nagar & Koregaon Park')}

<h2>Undri, NIBM &amp; Mohammadwadi: value in the south-east</h2>
<p>Families who want quieter, greener surroundings near good schools look south-east. ${h.link(211)} in ${h.loc('Undri')} and ${h.link(212)} in ${h.loc('Mohammadwadi')} start in the ₹62–68 Lacs range, and ${h.link(235)} in ${h.loc('NIBM')} is due for possession in December 2026.</p>
${h.table([211, 212, 235], 'New projects in Undri, NIBM & Mohammadwadi')}

<h2>Choosing the right part of East Pune</h2>
<ol>
  <li><strong>Work in Magarpatta or Hadapsar?</strong> Hadapsar, Manjri, Undri and NIBM keep your commute short.</li>
  <li><strong>Fly often or work near the airport?</strong> Viman Nagar, Lohegaon and Dhanori are the closest.</li>
  <li><strong>Want an established neighbourhood?</strong> Koregaon Park and Kalyani Nagar have the most mature social infrastructure, at a premium.</li>
  <li><strong>Always verify MahaRERA details.</strong> Here’s <a href="/blog/how-to-check-maharera-registration-number">how to check a MahaRERA number</a>.</li>
</ol>

<h2>FAQs: Buying in East Pune</h2>
<h3>What is the cheapest new flat in East Pune?</h3>
<p>Among the projects on our map, ${h.link(221)} in Hadapsar starts at ₹44.99 Lacs, followed by ${h.link(211)} in Undri and ${h.link(233)} in Lohegaon in the ₹62–65 Lacs range.</p>
<h3>Is Lohegaon a good place to buy?</h3>
<p>Lohegaon has low entry prices, airport proximity and the planned Ring Road nearby, which suits first-time buyers. Check flight-path noise and road access for the specific project before you book.</p>
<h3>Which East Pune projects are ready or nearly ready?</h3>
<p>${h.link(93)} in Hadapsar has ready possession, and ${h.link(114)} and ${h.link(164)} are nearing possession.</p>

<blockquote>Prices, configurations and possession dates are as listed on Mappingg in October 2026 and may change. Always confirm with the developer and on MahaRERA before you book.</blockquote>
`,
  };
}

function readyVsUcArticle(h) {
  return {
    slug: 'ready-to-move-vs-under-construction-flats-pune',
    title: 'Ready-to-Move vs Under-Construction Flats in Pune: Which Should You Buy in 2026?',
    seo_title: 'Ready-to-Move vs Under-Construction Flats in Pune',
    seo_description:
      'Ready-to-move or under-construction? Compare price, GST, risk, rent savings and possession timelines for flats in Pune — with real projects in each category.',
    excerpt:
      'Ready-to-move flats cost more but carry less risk; under-construction flats are cheaper but you wait. Here’s how price, GST, rent and risk compare — with real Pune projects in each category.',
    tags: ['Home Buying Guide', 'Ready to Move', 'Under Construction', 'Pune', 'GST'],
    cover: {
      theme: 'ember',
      kicker: 'Buyer’s guide',
      lines: ['Ready-to-Move vs', 'Under-Construction', 'Which to Buy?'],
      stats: [['0%', 'GST on ready'], ['5%', 'GST on UC'], ['2–5 yrs', 'typical wait']],
    },
    content: `
<p>One of the first decisions every home buyer in Pune faces is whether to buy a <strong>ready-to-move flat</strong> or an <strong>under-construction flat</strong>. The choice affects how much you pay, how much tax you pay, how long you wait and how much risk you take. This guide compares the two side by side, with examples from the projects on the <a href="/map">Mappingg live map</a>.</p>

<h2>The quick comparison</h2>
<div class="table-scroll"><table>
<caption>Ready-to-move vs under-construction</caption>
<thead><tr><th>Factor</th><th>Ready-to-move</th><th>Under-construction</th></tr></thead>
<tbody>
<tr><td>Price</td><td>Usually higher</td><td>Usually lower, especially at launch</td></tr>
<tr><td>GST</td><td>None, once the occupancy certificate (OC) is issued</td><td>5% (1% for affordable housing), without input tax credit</td></tr>
<tr><td>What you see</td><td>The actual flat, view and neighbours</td><td>A sample flat and a brochure</td></tr>
<tr><td>Move-in / rent</td><td>Immediately; rent or EMI starts at once</td><td>Wait 2–5 years; you may pay rent and pre-EMI together</td></tr>
<tr><td>Risk</td><td>Low: the building is finished</td><td>Delay and specification risk</td></tr>
<tr><td>Payment</td><td>Large lump sum or full loan up front</td><td>Spread over construction stages</td></tr>
<tr><td>Choice of unit</td><td>Limited to what’s left</td><td>Wider choice of floor, view and layout</td></tr>
</tbody></table></div>
<p><small>GST rates are as in force in October 2026. Stamp duty and registration charges apply in both cases.</small></p>

<h2>When a ready-to-move flat makes sense</h2>
<ul>
  <li><strong>You’re paying rent today.</strong> Moving in immediately saves you from paying rent and an EMI at the same time.</li>
  <li><strong>You want certainty.</strong> You can check the actual flat, the light, the view, the water supply and the neighbours before you pay.</li>
  <li><strong>You want to avoid GST.</strong> A completed flat with an occupancy certificate attracts no GST, which can offset part of the higher price.</li>
</ul>
<p>Examples on our map include ${h.link(236)} in Pimple Saudagar (possession done), ${h.link(93)} in Hadapsar (ready possession), and projects nearing possession such as ${h.link(114)}, ${h.link(164)} and ${h.link(81)}.</p>
${h.table([236, 93, 114, 164, 81], 'Ready and nearly-ready projects in Pune')}

<h2>When an under-construction flat makes sense</h2>
<ul>
  <li><strong>You don’t need to move in soon,</strong> for example if you’re buying to invest or planning ahead.</li>
  <li><strong>You want a lower entry price</strong> and a payment plan spread over construction stages.</li>
  <li><strong>You want first pick</strong> of floor, view and layout.</li>
</ul>
<p>To reduce the wait, look at projects due within a year. Several on our map have December 2026 possession dates, such as ${h.link(244)} in Chikhali, ${h.link(233)} in Lohegaon, ${h.link(235)} in NIBM and ${h.link(231)} in Tathawade.</p>
${h.table([244, 233, 235, 231, 230, 228], 'Under-construction projects due in late 2026')}

<h2>How to reduce the risk of an under-construction flat</h2>
<ol>
  <li><strong>Buy only MahaRERA-registered projects,</strong> and check the RERA completion date, not just the brochure’s. Here’s <a href="/blog/how-to-check-maharera-registration-number">how to check a MahaRERA number</a>.</li>
  <li><strong>Check the developer’s delivery record</strong> on their past projects. See the <a href="/developers">developers page</a>.</li>
  <li><strong>Look at construction progress</strong> in the quarterly updates on MahaRERA, and visit the site.</li>
  <li><strong>Prefer construction-linked payment plans,</strong> and read the cancellation and delay-compensation clauses in the agreement for sale.</li>
  <li><strong>Budget for rent and pre-EMI together</strong> until possession.</li>
</ol>

<h2>Checklist for a ready-to-move flat</h2>
<ul>
  <li>Ask for the <strong>occupancy certificate (OC)</strong>. Without it, the flat is not legally complete and GST may still apply.</li>
  <li>Check the <strong>society formation</strong> status, maintenance charges and any pending dues.</li>
  <li>Inspect for seepage, finishing quality and water pressure.</li>
  <li>For a resale flat, check the chain of title documents with a lawyer.</li>
</ul>

<h2>FAQs</h2>
<h3>Is GST charged on ready-to-move flats?</h3>
<p>No. GST does not apply to a flat sold after the occupancy certificate has been issued. Under-construction flats attract 5% GST (1% for affordable housing).</p>
<h3>Are under-construction flats cheaper?</h3>
<p>Usually, yes, especially at launch. But add GST, the rent you’ll keep paying until possession and the risk of delay before comparing.</p>
<h3>How do I find ready-to-move projects in Pune?</h3>
<p>Filter by status on the map, or browse <a href="/status/ready-to-move">ready-to-move</a>, <a href="/status/under-construction">under-construction</a> and <a href="/status/upcoming">upcoming</a> projects.</p>

<blockquote>This guide is general information, not tax or legal advice. Tax rates and project details can change, so confirm them with a professional, the developer and MahaRERA before you book.</blockquote>
`,
  };
}

function underOneCroreArticle(h) {
  return {
    slug: 'flats-under-1-crore-in-pune',
    title: 'Flats Under ₹1 Crore in Pune (2026): 1, 2 & 3 BHK New Projects by Budget',
    seo_title: 'Flats Under ₹1 Cr in Pune 2026: 2 & 3 BHK Projects',
    seo_description:
      'New flats in Pune under ₹1 crore — 1 & 2 BHK from ₹30 Lacs in Chikhali to 2 & 3 BHK under ₹1 Cr in Hinjewadi, Tathawade, NIBM & Mundhwa, with possession dates and MahaRERA numbers.',
    excerpt:
      'Buying your first home in Pune with a budget under ₹1 crore? Every new project on our map that starts below ₹1 Cr — sorted into under ₹50 Lacs, ₹50–75 Lacs and ₹75 Lacs–1 Cr — with locations, BHK options and possession dates.',
    tags: ['Pune', 'Flats Under 1 Crore', 'Affordable Homes', '2 BHK', 'First Home'],
    cover: {
      theme: 'morning',
      kicker: 'Budget guide',
      lines: ['Flats Under ₹1 Cr', 'in Pune: 2026', 'Budget Guide'],
      stats: [['30+', 'projects under ₹1 Cr'], ['₹30 L', 'lowest entry'], ['1–3 BHK', 'configurations']],
    },
    content: `
<p>A budget under <strong>₹1 crore</strong> still buys a new home in most parts of Pune, if you know where to look. On the <a href="/map">Mappingg live map</a> we track more than 30 new projects whose starting price is below ₹1 Cr, from 1 BHK homes around ₹30 Lacs in Pimpri-Chinchwad to 2 and 3 BHK homes in the Hinjewadi IT belt. This guide sorts them by budget so you can build a shortlist quickly.</p>

<h2>Where ₹1 crore goes furthest in Pune</h2>
<div class="table-scroll"><table>
<caption>What your budget buys, by area</caption>
<thead><tr><th>Budget</th><th>Where to look</th><th>Typical home</th></tr></thead>
<tbody>
<tr><td>Under ₹50 Lacs</td><td>Chikhali, Bopkhel, Hadapsar–Fursungi</td><td>1 BHK and compact 2 BHK</td></tr>
<tr><td>₹50–75 Lacs</td><td>Lohegaon, Undri, Ambegaon, Dapodi, Charholi, Dudulgaon, Sus</td><td>2 BHK, some 3 BHK</td></tr>
<tr><td>₹75 Lacs – ₹1 Cr</td><td>Hinjewadi, Tathawade, Mahalunge, NIBM, Dhanori, Mundhwa</td><td>Larger 2 BHK, entry 3 BHK</td></tr>
</tbody></table></div>
<p><small>Starting prices as listed on Mappingg in October 2026. Most projects have bigger homes above these prices.</small></p>

<h2>New flats under ₹50 Lacs</h2>
<p>The lowest entry prices on our map are in Pimpri-Chinchwad. ${h.link(244)} in ${h.loc('Chikhali')} offers 1 and 2 BHK homes from ₹30 Lacs with possession due in December 2026, and ${h.link(240)}, also in Chikhali, starts at ₹35 Lacs. On the east side, ${h.link(221)} in Hadapsar–Fursungi starts at ₹44.99 Lacs, and ${h.link(163)} near Khadki and Bopkhel starts at about ₹50 Lacs.</p>
${h.table([244, 240, 221, 163], 'New projects starting under ₹50 Lacs')}

<h2>2 BHK flats from ₹50 Lacs to ₹75 Lacs</h2>
<p>This is the sweet spot for first-time buyers. In the south-east, ${h.link(211)} in ${h.loc('Undri')}, ${h.link(212)} in Mohammadwadi and ${h.link(210)} in Handewadi start between ₹62 and ₹68 Lacs. Near the airport, ${h.link(233)} and ${h.link(234)} in ${h.loc('Lohegaon')} start at about ₹65 Lacs, and ${h.link(256)} is an upcoming project from ₹72.89 Lacs. In PCMC, look at ${h.link(249)} in Dudulgaon, ${h.link(251)} in Dapodi and ${h.link(241)} in Charholi. ${h.link(229)} in Ambegaon and ${h.link(111)} by Magarpatta Group in Loni Kalbhor round out the list.</p>
${h.gallery([211, 210, 233, 249, 241, 229])}
${h.table([211, 249, 233, 251, 229, 234, 210, 212, 241, 256, 111], '2 BHK projects from ₹50 Lacs to ₹75 Lacs')}

<h2>2 &amp; 3 BHK flats from ₹75 Lacs to ₹1 Crore</h2>
<p>With a little more budget, the IT belts open up. ${h.link(199)} in Sus starts at ₹74 Lacs, ${h.link(238)} in ${h.loc('Ravet')} at ₹75 Lacs and ${h.link(242)} in Moshi at ₹75 Lacs. In ${h.loc('Hinjewadi')}, the Krisala Hiranandani township has ${h.link(204)} from ₹82 Lacs and the upcoming ${h.link(206)} from ₹85 Lacs, and ${h.link(203)} starts at about ₹94 Lacs. ${h.link(198)} by Mahindra in Mahalunge and ${h.link(235)} in ${h.loc('NIBM')} both start at ₹90 Lacs, while ${h.link(202)} and ${h.link(231)} in ${h.loc('Tathawade')} and ${h.link(13)} in Mundhwa come in just under ₹1 Cr.</p>
${h.table([199, 238, 242, 245, 165, 204, 206, 198, 235, 202, 203, 231, 13], 'Projects from ₹75 Lacs to ₹1 Cr')}

<h2>Under ₹1 Cr and ready soon</h2>
<p>If you’re paying rent, a near-term possession date matters as much as the price. These projects on our map start under ₹1 Cr and are due by December 2026: ${h.link(245)} in Chinchwad (October 2026), ${h.link(244)} in Chikhali, ${h.link(233)} in Lohegaon, ${h.link(249)} in Dudulgaon, ${h.link(235)} in NIBM and ${h.link(231)} in Tathawade. Our guide to <a href="/blog/ready-to-move-vs-under-construction-flats-pune">ready-to-move vs under-construction flats</a> explains the trade-offs.</p>

<h2>How to stretch a ₹1 crore budget</h2>
<ol>
  <li><strong>Budget for the costs on top of the price.</strong> In Pune city, stamp duty, registration and GST can add about 12% to an under-construction flat. Read our guide to <a href="/blog/stamp-duty-registration-charges-pune">stamp duty, registration and hidden costs</a> before you fix your budget.</li>
  <li><strong>Compare carpet area, not super built-up area.</strong> Two “2 BHK” homes at the same price can differ by 100 sq ft or more of usable space.</li>
  <li><strong>Check the commute on a map.</strong> A cheaper flat that adds an hour a day to your commute may not be a saving. Open each project on the <a href="/map">live map</a> to see the roads and metro lines around it.</li>
  <li><strong>Look at the payment plan.</strong> Construction-linked plans spread the cost, but read the cancellation clauses.</li>
  <li><strong>Verify the MahaRERA number</strong> for your specific tower. Here’s <a href="/blog/how-to-check-maharera-registration-number">how to check a MahaRERA number</a>.</li>
</ol>

<h2>FAQs: Flats under ₹1 crore in Pune</h2>
<h3>Can I buy a 2 BHK in Pune under ₹1 crore?</h3>
<p>Yes. Most of the projects in this guide offer 2 BHK homes under ₹1 Cr, from about ₹62 Lacs in Undri and Dudulgaon to about ₹82–94 Lacs in Hinjewadi and Tathawade.</p>
<h3>Which is the cheapest area to buy a new flat in Pune?</h3>
<p>Among the projects on our map, Chikhali in Pimpri-Chinchwad has the lowest starting prices (from ₹30 Lacs), followed by Hadapsar–Fursungi and Bopkhel.</p>
<h3>Can I get a 3 BHK under ₹1 crore in Pune?</h3>
<p>A few projects offer entry-level 3 BHK homes close to ₹1 Cr, mainly in Lohegaon, Undri, Charholi and Moshi. Ask the developer for the exact price of the 3 BHK unit, because the starting price is usually for the smallest home.</p>
<h3>Is it better to buy in East or West Pune on this budget?</h3>
<p>Choose the side closest to where you work. Our guide to the <a href="/blog/best-areas-to-buy-property-in-pune">best areas to buy property in Pune</a> compares the main localities.</p>

<blockquote>Prices, configurations and possession dates are as listed on Mappingg in October 2026 and may change. Always confirm with the developer and on MahaRERA before you book.</blockquote>
`,
  };
}

function stampDutyArticle(h) {
  return {
    slug: 'stamp-duty-registration-charges-pune',
    title: 'Stamp Duty, Registration Charges & Hidden Costs of Buying a Flat in Pune (2026)',
    seo_title: 'Stamp Duty & Registration Charges in Pune 2026',
    seo_description:
      'Stamp duty in Pune is 7% in PMC & PCMC limits (6% for women), plus 1% registration capped at ₹30,000, GST on under-construction flats and other costs. Worked example for an ₹80 L flat.',
    excerpt:
      'The price on the brochure is not what you pay. Here is how stamp duty, metro cess, registration, GST, TDS and the smaller charges add up when you buy a flat in Pune, with a worked example.',
    tags: ['Stamp Duty', 'Registration Charges', 'Pune', 'Home Buying Guide', 'GST'],
    cover: {
      theme: 'slate',
      kicker: 'Buyer’s guide',
      lines: ['Stamp Duty &', 'Hidden Costs of', 'a Flat in Pune'],
      stats: [['7%', 'stamp duty'], ['₹30K', 'max registration'], ['≈12%', 'on top of price']],
    },
    content: `
<p>When you budget for a flat in Pune, the price on the brochure is only the start. On top of it you pay <strong>stamp duty</strong>, a <strong>registration fee</strong>, <strong>GST</strong> if the flat is under construction, and several smaller charges. Together they can add more than 10% to the cost. This guide explains each one, with a worked example, so there are no surprises on the day you register.</p>

<h2>Stamp duty in Pune (2026)</h2>
<p>Stamp duty is a state tax on the property document. Within Pune Municipal Corporation (PMC) and Pimpri-Chinchwad Municipal Corporation (PCMC) limits, it is made up of three parts:</p>
<div class="table-scroll"><table>
<caption>Stamp duty in PMC and PCMC limits</caption>
<thead><tr><th>Component</th><th>Men / joint with a man</th><th>Woman (sole owner)</th></tr></thead>
<tbody>
<tr><td>Stamp duty</td><td>5%</td><td>4%</td></tr>
<tr><td>Metro cess</td><td>1%</td><td>1%</td></tr>
<tr><td>Local body tax (LBT) surcharge</td><td>1%</td><td>1%</td></tr>
<tr><td><strong>Total</strong></td><td><strong>7%</strong></td><td><strong>6%</strong></td></tr>
</tbody></table></div>
<p>Three things to know:</p>
<ul>
  <li><strong>It is charged on the higher value.</strong> Stamp duty is worked out on the agreement value or the government’s ready reckoner value for that flat, whichever is higher.</li>
  <li><strong>The women’s concession</strong> applies to residential property bought in a woman’s name. Check the current conditions before you register, especially for joint ownership.</li>
  <li><strong>Outside city limits it is lower.</strong> In gram panchayat areas around Pune, the metro cess and LBT surcharge generally don’t apply.</li>
</ul>

<h2>Registration fee</h2>
<p>The registration fee is <strong>1% of the property value, capped at ₹30,000</strong>. For almost every new flat in Pune city, you’ll pay the full ₹30,000. You pay it when the agreement for sale is registered at the sub-registrar’s office.</p>

<h2>GST on under-construction flats</h2>
<div class="table-scroll"><table>
<caption>GST on residential flats</caption>
<thead><tr><th>Type of flat</th><th>GST</th></tr></thead>
<tbody>
<tr><td>Ready-to-move, with occupancy certificate (OC)</td><td>None</td></tr>
<tr><td>Under construction, affordable (up to ₹45 Lacs and up to 90 sq m carpet in Pune)</td><td>1%</td></tr>
<tr><td>Under construction, all others</td><td>5%</td></tr>
</tbody></table></div>
<p>GST is charged without input tax credit and is normally collected with each construction-linked instalment. Ask the developer whether the quoted price includes GST. Parking, club membership and other charges billed by the developer may attract GST separately.</p>

<h2>Worked example: an ₹80 Lacs flat in Pune city</h2>
<p>Take a 2 BHK in PMC limits with an agreement value of ₹80 Lacs, bought under construction by a man (or jointly with a man):</p>
<div class="table-scroll"><table>
<caption>What an ₹80 Lacs under-construction flat really costs</caption>
<thead><tr><th>Item</th><th>Amount</th></tr></thead>
<tbody>
<tr><td>Agreement value</td><td>₹80,00,000</td></tr>
<tr><td>Stamp duty, metro cess &amp; LBT (7%)</td><td>₹5,60,000</td></tr>
<tr><td>Registration fee (capped)</td><td>₹30,000</td></tr>
<tr><td>GST (5%)</td><td>₹4,00,000</td></tr>
<tr><td><strong>Total before other charges</strong></td><td><strong>₹89,90,000</strong></td></tr>
</tbody></table></div>
<p>If the flat is registered in a woman’s name alone, stamp duty falls to 6% (₹4,80,000), saving ₹80,000. If the same flat is ready to move with an OC, there is no GST, saving ₹4 Lacs.</p>

<h2>TDS: 1% you deduct, not an extra cost</h2>
<p>If the flat costs ₹50 Lacs or more, you must deduct <strong>1% TDS</strong> from each payment to the developer and deposit it with the Income Tax Department under the developer’s PAN. It isn’t an extra cost, because the developer gets credit for it, but forgetting it can lead to interest and penalties. On an ₹80 Lacs flat, the TDS is ₹80,000.</p>

<h2>The smaller costs buyers forget</h2>
<ul>
  <li><strong>Maintenance deposit:</strong> developers usually collect 12 to 24 months of maintenance in advance at possession.</li>
  <li><strong>Society formation and legal charges:</strong> often a fixed amount, collected at possession.</li>
  <li><strong>Electricity and water connections:</strong> meter and connection deposits.</li>
  <li><strong>Parking, floor rise and preferential location charges (PLC):</strong> check whether they are in the quoted price.</li>
  <li><strong>Home loan costs:</strong> processing fees, legal and valuation charges, and stamp duty on the loan agreement.</li>
  <li><strong>Brokerage</strong>, if you buy through a broker.</li>
  <li><strong>Interiors and furnishing</strong>, which many buyers leave out of the budget entirely.</li>
</ul>

<h2>How to keep the extra costs down</h2>
<ol>
  <li><strong>Ask for an all-inclusive cost sheet</strong> that shows the agreement value, GST, stamp duty, registration and every other charge before you pay the booking amount.</li>
  <li><strong>Consider registering in a woman’s name</strong> where it suits your family, to save 1% stamp duty.</li>
  <li><strong>Compare ready-to-move flats</strong>, which carry no GST. Our guide to <a href="/blog/ready-to-move-vs-under-construction-flats-pune">ready-to-move vs under-construction flats</a> explains when that makes sense.</li>
  <li><strong>Keep a buffer of 12–15% of the price</strong> for an under-construction flat in Pune city, or 7–10% for a ready one.</li>
</ol>
<p>Looking for homes that leave room in the budget? See our list of <a href="/blog/flats-under-1-crore-in-pune">flats under ₹1 crore in Pune</a>, and always <a href="/blog/how-to-check-maharera-registration-number">check the MahaRERA number</a> before you book.</p>

<h2>FAQs</h2>
<h3>What is the stamp duty in Pune in 2026?</h3>
<p>Within PMC and PCMC limits, it is 7% (5% stamp duty, 1% metro cess and 1% LBT surcharge). Women buying in their own name pay 6%.</p>
<h3>What are the registration charges in Pune?</h3>
<p>1% of the property value, capped at ₹30,000.</p>
<h3>Is stamp duty charged on the agreement value or the ready reckoner rate?</h3>
<p>On whichever is higher of the two.</p>
<h3>Can I include stamp duty in my home loan?</h3>
<p>Banks generally lend against the property value and don’t fund stamp duty and registration, so plan to pay them from your own savings.</p>

<blockquote>Rates are as reported for October 2026 and can change. This guide is general information, not legal or tax advice. Confirm the current rates on the IGR Maharashtra website or with a property lawyer before you register.</blockquote>
`,
  };
}

function threeBhkArticle(h) {
  return {
    slug: '3-bhk-flats-in-pune',
    title: '3 BHK Flats in Pune (2026): New Projects & Prices from ₹1 Cr to Luxury',
    seo_title: '3 BHK Flats in Pune 2026: New Projects & Prices',
    seo_description:
      'New 3 BHK flats in Pune from ₹99 Lacs — compare 3 & 4 BHK projects in Hinjewadi, Wakad, Kharadi, Mundhwa, Balewadi & Baner by price, possession date and MahaRERA number.',
    excerpt:
      'Upgrading to a 3 BHK in Pune? Every new 3 BHK project on our map sorted by budget — under ₹1.5 Cr, ₹1.5–2 Cr, ₹2–3 Cr and luxury — with locations, possession dates and MahaRERA numbers.',
    tags: ['3 BHK Flats in Pune', 'Pune', 'New Projects', '4 BHK', 'Luxury Apartments'],
    cover: {
      theme: 'golden',
      kicker: 'Budget guide',
      lines: ['3 BHK Flats', 'in Pune: 2026', 'Prices & Projects'],
      stats: [['40+', '3 BHK projects'], ['₹99 L', 'lowest entry'], ['3–5 BHK', 'configurations']],
    },
    content: `
<p>A <strong>3 BHK flat in Pune</strong> is the most popular choice for growing families and for buyers moving up from a 2 BHK. The extra bedroom works as a kids’ room, a guest room or a home office. On the <a href="/map">Mappingg live map</a> we track more than 40 new projects that offer 3 BHK homes, from about ₹99 Lacs in the Hinjewadi IT belt to ₹4 Cr+ residences in Koregaon Park and Kalyani Nagar. This guide sorts them by budget so you can see what your money buys.</p>

<h2>3 BHK prices in Pune at a glance</h2>
<div class="table-scroll"><table>
<caption>What a new 3 BHK costs, by budget</caption>
<thead><tr><th>Budget</th><th>Where to look</th><th>Typical home</th></tr></thead>
<tbody>
<tr><td>Under ₹1.5 Cr</td><td>Hinjewadi, PCMC Spine Road, Pradhikaran, Wakad, Manjri</td><td>Compact 3 BHK, around 900–1,100 sq ft carpet</td></tr>
<tr><td>₹1.5 – 2 Cr</td><td>Mundhwa, Kharadi, Thergaon, Mahalunge</td><td>Spacious 3 BHK in large gated communities</td></tr>
<tr><td>₹2 – 3 Cr</td><td>Balewadi, Upper Kharadi, Mundhwa, Pimple Saudagar</td><td>Large 3 BHK and entry 4 BHK</td></tr>
<tr><td>₹3.5 Cr+</td><td>Baner, Kalyani Nagar, Koregaon Park, Viman Nagar</td><td>3.5 / 4.5 BHK luxury residences</td></tr>
</tbody></table></div>
<p><small>Starting prices as listed on Mappingg in October 2026. The starting price is often for the smallest unit, so ask for the 3 BHK price specifically.</small></p>

<h2>3 BHK flats under ₹1.5 crore</h2>
<p>West Pune and Pimpri-Chinchwad give you the most space for the money. ${h.link(269)} in ${h.loc('Hinjewadi')} Phase 1 offers 3 and 4 BHK homes from ₹99 Lacs, and ${h.link(253)} on Spine Road is an all-3 BHK project from ₹1.1 Cr. ${h.link(237)} in Pradhikaran offers 3 BHK suites from ₹1.46 Cr, and ${h.link(246)} in Wakad starts at ₹1.3 Cr. On the east side, ${h.link(113)} by Shapoorji Pallonji in Manjri starts at ₹1.42 Cr.</p>
${h.table([269, 253, 246, 113, 237], '3 BHK projects under ₹1.5 Cr')}

<h2>3 BHK flats from ₹1.5 crore to ₹2 crore</h2>
<p>This band covers most of East Pune’s family homes. In Mundhwa, ${h.link(18)} starts at ₹1.55 Cr with a flexi payment plan and ${h.link(12)} at ₹1.71 Cr. In ${h.loc('Kharadi')}, ${h.link(184)} offers river-facing 3 BHK homes from ₹1.74 Cr and ${h.link(92)} starts at ₹1.84 Cr. In West Pune, ${h.link(205)} in the Krisala Hiranandani township, ${h.link(267)} in Mahalunge and ${h.link(255)} in Thergaon are worth a look.</p>
${h.gallery([18, 12, 184, 92, 205, 11])}
${h.table([18, 205, 267, 12, 255, 184, 11, 92], '3 BHK projects from ₹1.5 Cr to ₹2 Cr')}

<h2>Premium 3 &amp; 4 BHK flats from ₹2 crore to ₹3 crore</h2>
<p>With a larger budget you get bigger carpet areas, better views and more amenities. ${h.link(216)} near ${h.loc('Balewadi')} High Street starts at ₹1.88 Cr, ${h.link(226)} in Kharadi at ₹1.90 Cr and ${h.link(87)} in Upper Kharadi at ₹2.25 Cr. If you want to move in now, ${h.link(236)} in Pimple Saudagar is ready, with possession done. Mundhwa options include ${h.link(16)}, ${h.link(10)} and ${h.link(35)}.</p>
${h.table([216, 226, 236, 87, 16, 10, 35], 'Premium 3 & 4 BHK projects, ₹2–3 Cr')}

<h2>Luxury 3.5, 4 &amp; 4.5 BHK residences</h2>
<p>At the top end, Pune’s luxury market is concentrated in Baner, Koregaon Park, Kalyani Nagar and the Mundhwa–KP Annexe stretch. ${h.link(136)} in Viman Nagar starts at ₹3.72 Cr, ${h.link(215)} on Pan Card Club Road, Baner at ₹3.85 Cr, and ${h.link(194)} in Kalyani Nagar at ₹3.58 Cr. ${h.link(15)} by Panchshil and ${h.link(118)} in Koregaon Park start above ₹4.3 Cr.</p>
${h.gallery([15, 194, 215, 118, 136, 103])}
${h.table([194, 136, 215, 103, 15, 118], 'Luxury 3.5 – 4.5 BHK projects in Pune')}

<h2>What to check before you buy a 3 BHK</h2>
<ol>
  <li><strong>Carpet area, not super built-up.</strong> In Pune, a “3 BHK” can range from about 900 sq ft to over 1,500 sq ft of carpet area. Compare price per sq ft on carpet area only.</li>
  <li><strong>Room sizes and layout.</strong> Check that the third bedroom fits a bed and a wardrobe, and whether it has an attached bathroom.</li>
  <li><strong>Schools and commute.</strong> For a family home, the distance to schools matters as much as the distance to work. Open each project on the <a href="/map">live map</a> to see what’s around it.</li>
  <li><strong>Full cost, not just price.</strong> On a ₹1.8 Cr flat in Pune city, stamp duty alone is about ₹12.6 Lacs. Read our guide to <a href="/blog/stamp-duty-registration-charges-pune">stamp duty and hidden costs</a>, and see how a <a href="/blog/home-loan-emi-eligibility-pune">home loan EMI</a> fits your income.</li>
  <li><strong>MahaRERA registration</strong> for your specific tower and its possession date. Here’s <a href="/blog/how-to-check-maharera-registration-number">how to check a MahaRERA number</a>.</li>
</ol>

<h2>FAQs: 3 BHK flats in Pune</h2>
<h3>What is the price of a new 3 BHK flat in Pune?</h3>
<p>Among the projects on our map, new 3 BHK homes start at about ₹99 Lacs to ₹1.3 Cr in Hinjewadi, Wakad and PCMC, ₹1.55–2 Cr in Mundhwa and Kharadi, and ₹3.5 Cr and above in Baner, Kalyani Nagar and Koregaon Park.</p>
<h3>Which is the best area to buy a 3 BHK in Pune?</h3>
<p>For value, Hinjewadi, Wakad and Tathawade. For East Pune IT jobs, Kharadi and Mundhwa. For premium living, Balewadi, Baner and Kalyani Nagar. Our guide to the <a href="/blog/best-areas-to-buy-property-in-pune">best areas to buy property in Pune</a> compares them in detail.</p>
<h3>Can I buy a 3 BHK in Pune under ₹1 crore?</h3>
<p>Only a few. ${h.link(269)} starts at ₹99 Lacs, and some projects in Lohegaon, Undri and Charholi have entry-level 3 BHK units close to ₹1 Cr. See our list of <a href="/blog/flats-under-1-crore-in-pune">flats under ₹1 crore in Pune</a>.</p>
<h3>Is a 3 BHK a good investment in Pune?</h3>
<p>3 BHK homes near IT hubs rent well to families and sharing professionals, and they are easier to resell to upgraders. Rental yield as a percentage is usually a little lower than on a 2 BHK, so buy a 3 BHK mainly if it suits your own family.</p>

<blockquote>Prices, configurations and possession dates are as listed on Mappingg in October 2026 and may change. Always confirm with the developer and on MahaRERA before you book.</blockquote>
`,
  };
}

function homeLoanArticle(h) {
  return {
    slug: 'home-loan-emi-eligibility-pune',
    title: 'Home Loan for a Flat in Pune (2026): EMI, Eligibility, Down Payment & Documents',
    seo_title: 'Home Loan EMI & Eligibility Guide for Pune 2026',
    seo_description:
      'How much home loan can you get? EMI tables for ₹30 L to ₹1.5 Cr loans, down payment rules, eligibility by salary, documents and tax benefits — with real Pune flats as examples.',
    excerpt:
      'How big a home loan you can get, what the EMI will be, how much down payment you need and which documents to keep ready — explained with EMI tables and real Pune projects.',
    tags: ['Home Loan', 'EMI Calculator', 'Home Loan Eligibility', 'Pune', 'Home Buying Guide'],
    cover: {
      theme: 'mint',
      kicker: 'Buyer’s guide',
      lines: ['Home Loan EMI &', 'Eligibility for', 'a Flat in Pune'],
      stats: [['75–90%', 'loan-to-value'], ['₹868', 'EMI per lakh'], ['≈50%', 'of income max']],
    },
    content: `
<p>Most people buy their flat in Pune with a <strong>home loan</strong>. Before you pay a booking amount, you should know three numbers: how much the bank will lend you, how much you must pay yourself as a <strong>down payment</strong>, and what your monthly <strong>EMI</strong> will be. This guide explains each one with simple tables and real examples from the projects on the <a href="/map">Mappingg live map</a>.</p>

<h2>How much down payment do you need?</h2>
<p>Banks and housing finance companies don’t fund the full price of a flat. RBI rules cap the loan-to-value (LTV) ratio, so you pay the rest yourself:</p>
<div class="table-scroll"><table>
<caption>Maximum home loan as a share of the property value</caption>
<thead><tr><th>Loan amount</th><th>Maximum loan (LTV)</th><th>Your minimum down payment</th></tr></thead>
<tbody>
<tr><td>Up to ₹30 Lacs</td><td>90%</td><td>10%</td></tr>
<tr><td>₹30 Lacs – ₹75 Lacs</td><td>80%</td><td>20%</td></tr>
<tr><td>Above ₹75 Lacs</td><td>75%</td><td>25%</td></tr>
</tbody></table></div>
<p>Two things catch buyers out. First, the LTV is worked out on the property’s value, which generally <strong>excludes stamp duty and registration</strong>, so you pay those from savings too. Second, a lender can approve less than the maximum based on your income and credit score.</p>

<h2>Home loan EMI table</h2>
<p>Your EMI depends on the loan amount, the interest rate and the tenure. Here is the EMI at an illustrative rate of <strong>8.5% a year</strong>:</p>
<div class="table-scroll"><table>
<caption>Monthly EMI at 8.5% interest</caption>
<thead><tr><th>Loan amount</th><th>15 years</th><th>20 years</th><th>25 years</th><th>30 years</th></tr></thead>
<tbody>
<tr><td>₹30 Lacs</td><td>₹29,542</td><td>₹26,035</td><td>₹24,157</td><td>₹23,067</td></tr>
<tr><td>₹50 Lacs</td><td>₹49,237</td><td>₹43,391</td><td>₹40,261</td><td>₹38,446</td></tr>
<tr><td>₹60 Lacs</td><td>₹59,084</td><td>₹52,069</td><td>₹48,314</td><td>₹46,135</td></tr>
<tr><td>₹75 Lacs</td><td>₹73,855</td><td>₹65,087</td><td>₹60,392</td><td>₹57,669</td></tr>
<tr><td>₹1 Crore</td><td>₹98,474</td><td>₹86,782</td><td>₹80,523</td><td>₹76,891</td></tr>
<tr><td>₹1.5 Crore</td><td>₹1,47,711</td><td>₹1,30,173</td><td>₹1,20,784</td><td>₹1,15,337</td></tr>
</tbody></table></div>
<p><small>A quick rule of thumb: at 8.5% over 20 years, every ₹1 Lac of loan costs about ₹868 a month. Actual rates depend on the lender, your credit score and the RBI repo rate, so check current offers before you decide.</small></p>

<h3>How the interest rate changes your EMI</h3>
<p>On a ₹50 Lacs loan over 20 years, the EMI is ₹41,822 at 8%, ₹43,391 at 8.5%, ₹44,986 at 9% and ₹46,607 at 9.5%. Even half a percent makes a difference of about ₹1,600 a month, or nearly ₹4 Lacs over the life of the loan, so it pays to compare lenders.</p>

<h3>The true cost of a longer tenure</h3>
<p>A longer tenure lowers your EMI but raises the total interest. On a ₹50 Lacs loan at 8.5% for 20 years, you repay about ₹1.04 Cr in all, of which about ₹54 Lacs is interest. Making part-prepayments whenever you get a bonus is the simplest way to cut that.</p>

<h2>How much home loan can you get on your salary?</h2>
<p>Lenders usually let your total EMIs (including car loans and personal loans) take up to about <strong>50–60% of your net monthly income</strong>. This is called the FOIR (fixed obligations to income ratio). For example, with a take-home salary of ₹1 Lac a month and no other loans, a 50% FOIR allows an EMI of ₹50,000, which supports a loan of about <strong>₹57.6 Lacs</strong> over 20 years at 8.5%.</p>
<p>Ways to increase your eligibility:</p>
<ul>
  <li><strong>Add a co-applicant</strong>, such as an earning spouse or parent, so both incomes are counted.</li>
  <li><strong>Close small loans and card dues</strong> before you apply, to free up FOIR.</li>
  <li><strong>Choose a longer tenure</strong>, if your age allows it.</li>
  <li><strong>Keep your credit score high</strong>. A score above 750 usually gets you the best rates.</li>
</ul>

<h2>Example: the loan for real Pune flats</h2>
<p>Here is what it would take to buy some of the projects on our map at their starting price, with the maximum loan, a 20-year tenure and 8.5% interest:</p>
<div class="table-scroll"><table>
<caption>Down payment and EMI at the starting price</caption>
<thead><tr><th>Project</th><th>Starting price</th><th>Down payment</th><th>Loan</th><th>EMI (20 yrs)</th></tr></thead>
<tbody>
<tr><td>${h.link(204)}, Hinjewadi</td><td>₹82 Lacs</td><td>₹16.4 Lacs</td><td>₹65.6 Lacs</td><td>₹56,929</td></tr>
<tr><td>${h.link(235)}, NIBM</td><td>₹90 Lacs</td><td>₹18 Lacs</td><td>₹72 Lacs</td><td>₹62,483</td></tr>
<tr><td>${h.link(13)}, Mundhwa</td><td>₹98 Lacs</td><td>₹24.5 Lacs</td><td>₹73.5 Lacs</td><td>₹63,785</td></tr>
<tr><td>${h.link(18)}, Mundhwa</td><td>₹1.55 Cr</td><td>₹38.75 Lacs</td><td>₹1.16 Cr</td><td>₹1,00,884</td></tr>
</tbody></table></div>
<p><small>Down payments exclude stamp duty, registration and GST. At a 50% FOIR, these EMIs need a take-home income of roughly ₹1.14 Lacs, ₹1.25 Lacs, ₹1.28 Lacs and ₹2 Lacs a month respectively.</small></p>
<p>Notice that ${h.link(13, 'Ravima Newtown')} needs a much larger down payment than ${h.link(235, 'KP Supernova')} even though the price is only ₹8 Lacs higher: at 80% the loan would cross ₹75 Lacs, so the 75% limit applies. Looking for homes in a lower band? See our guide to <a href="/blog/flats-under-1-crore-in-pune">flats under ₹1 crore in Pune</a>.</p>

<h2>Home loans for under-construction flats</h2>
<ul>
  <li><strong>Staged disbursement:</strong> the bank pays the developer in instalments as construction progresses, not all at once.</li>
  <li><strong>Pre-EMI:</strong> until the full loan is disbursed, you can pay interest only on the amount released so far (pre-EMI), or start the full EMI straight away. Pre-EMI feels lighter, but it doesn’t reduce your principal.</li>
  <li><strong>Approved projects:</strong> banks often pre-approve large MahaRERA-registered projects, which makes the loan faster. Always <a href="/blog/how-to-check-maharera-registration-number">check the MahaRERA number</a> yourself as well.</li>
  <li><strong>Rent plus EMI:</strong> if you are renting, budget for both until possession. Our guide to <a href="/blog/ready-to-move-vs-under-construction-flats-pune">ready-to-move vs under-construction flats</a> explains the trade-off.</li>
</ul>

<h2>Documents you will need</h2>
<ul>
  <li><strong>KYC:</strong> PAN card and Aadhaar or passport for every applicant.</li>
  <li><strong>Income proof (salaried):</strong> the last 3–6 months’ salary slips, Form 16 and 6–12 months’ bank statements.</li>
  <li><strong>Income proof (self-employed):</strong> 2–3 years of income tax returns with computation, audited financials and business bank statements.</li>
  <li><strong>Property papers:</strong> the allotment letter or agreement for sale, the developer’s MahaRERA certificate, approved plans and the payment receipts.</li>
  <li><strong>For a resale flat:</strong> the chain of title documents, the society NOC and the occupancy certificate.</li>
</ul>

<h2>Tax benefits on a home loan</h2>
<p>Under the old tax regime, you can usually claim up to ₹2 Lacs a year of interest on a self-occupied home, and up to ₹1.5 Lacs of principal repayment within the overall 80C-style limit. Co-owners who are also co-borrowers can each claim their share. The new tax regime doesn’t allow these deductions for a self-occupied home. Tax law and section numbers have changed recently, so confirm what applies to you with a tax adviser.</p>

<h2>Tips to get the best home loan deal</h2>
<ol>
  <li><strong>Get a sanction letter before you book</strong>, so you know your exact budget.</li>
  <li><strong>Compare at least three lenders</strong> on the interest rate, processing fee and prepayment terms. Floating-rate loans to individuals carry no prepayment penalty.</li>
  <li><strong>Plan the extra costs.</strong> Stamp duty, registration and GST are paid from your own pocket. See our guide to <a href="/blog/stamp-duty-registration-charges-pune">stamp duty and hidden costs</a>.</li>
  <li><strong>Remember the 1% TDS</strong> on flats worth ₹50 Lacs or more, deducted from every payment to the developer, including bank disbursements.</li>
  <li><strong>Keep an emergency fund</strong> of at least six months of EMIs.</li>
</ol>

<h2>FAQs: Home loans in Pune</h2>
<h3>How much home loan can I get on a ₹1 lakh salary?</h3>
<p>With no other loans, roughly ₹55–60 Lacs over 20 years at about 8.5%, depending on the lender’s FOIR limit and your credit score. Adding an earning co-applicant can increase this.</p>
<h3>What is the EMI on a ₹50 lakh home loan?</h3>
<p>About ₹43,391 a month over 20 years at 8.5%, or ₹38,446 over 30 years.</p>
<h3>Can a bank fund 100% of the flat’s price?</h3>
<p>No. You must pay at least 10–25% as a down payment, depending on the loan size, plus stamp duty and registration.</p>
<h3>Is it better to choose a shorter or longer tenure?</h3>
<p>A shorter tenure saves interest but raises your EMI. Many buyers choose a longer tenure for a comfortable EMI and then prepay whenever they can.</p>

<blockquote>EMIs in this guide are illustrative, at 8.5% a year, and are not an offer of credit. Interest rates, lending rules and tax provisions change, so confirm the details with your lender and a tax adviser. Project prices are as listed on Mappingg in October 2026.</blockquote>
`,
  };
}

function twoBhkArticle(h) {
  return {
    slug: '2-bhk-flats-in-pune',
    title: '2 BHK Flats in Pune (2026): New Projects & Prices from ₹30 Lacs to ₹1.5 Cr',
    seo_title: '2 BHK Flats in Pune 2026: New Projects & Prices',
    seo_description:
      'New 2 BHK flats in Pune by budget — from ₹30 Lacs in Chikhali to premium 2 BHKs in Kharadi, Mundhwa & Hinjewadi, with possession dates and MahaRERA numbers.',
    excerpt:
      'The 2 BHK is Pune’s most popular home. Here is every new 2 BHK project on our map, sorted by budget from ₹30 Lacs to ₹1.5 Cr, with locations, possession dates and MahaRERA numbers.',
    tags: ['2 BHK Flats', 'Pune', 'New Projects', 'First Home', 'MahaRERA'],
    cover: {
      theme: 'sky',
      kicker: 'Budget guide',
      lines: ['2 BHK Flats in', 'Pune: 2026', 'Prices & Projects'],
      stats: [['50+', '2 BHK projects'], ['₹30 L', 'lowest entry'], ['₹1.5 Cr', 'premium band']],
    },
    content: `
<p>The <strong>2 BHK flat</strong> is the most popular home in Pune. It suits young couples, small families and investors, and it is the easiest size to rent out and resell. On the <a href="/map">Mappingg live map</a> more than 50 new projects in Pune offer 2 BHK homes, from about ₹30 Lacs in Pimpri-Chinchwad to premium 2 BHKs above ₹1.2 Cr near the IT hubs. This guide sorts them by budget so you can build your shortlist quickly.</p>

<h2>How much does a 2 BHK cost in Pune?</h2>
<div class="table-scroll"><table>
<caption>2 BHK starting prices by area</caption>
<thead><tr><th>Budget</th><th>Where to look</th><th>What you get</th></tr></thead>
<tbody>
<tr><td>Under ₹60 Lacs</td><td>Chikhali, Hadapsar–Fursungi, Bopkhel</td><td>Compact 2 BHK, often alongside 1 BHK</td></tr>
<tr><td>₹60–80 Lacs</td><td>Undri, Lohegaon, Ambegaon, Mohammadwadi, Dudulgaon, Dapodi, Sus</td><td>Standard 2 BHK in gated projects</td></tr>
<tr><td>₹80 Lacs – ₹1 Cr</td><td>Hinjewadi, Dhanori, Mahalunge, Charholi, Moshi, Hadapsar</td><td>Larger 2 BHK near IT and township hubs</td></tr>
<tr><td>₹1 Cr – ₹1.5 Cr</td><td>Kharadi, Mundhwa, Baner, Balewadi, Magarpatta, NIBM</td><td>Premium 2 BHK in prime East and West Pune</td></tr>
</tbody></table></div>
<p><small>Starting prices as listed on Mappingg in October 2026. The same projects usually have bigger homes at higher prices.</small></p>

${h.gallery([211, 199, 204, 25, 182, 200])}

<h2>2 BHK flats under ₹60 Lacs</h2>
<p>The lowest prices on our map are in Pimpri-Chinchwad. ${h.link(244)} in ${h.loc('Chikhali')} offers 1 and 2 BHK homes from ₹30 Lacs, and ${h.link(240)} nearby starts at ₹35 Lacs. On the east side, ${h.link(221)} in Hadapsar has 2 BHK homes up to about ₹77 Lacs with 1 BHKs from ₹44.99 Lacs, and ${h.link(163)} near Khadki starts at about ₹50 Lacs.</p>
${h.table([244, 240, 221, 163], '2 BHK projects starting under ₹60 Lacs')}

<h2>2 BHK flats from ₹60 Lacs to ₹80 Lacs</h2>
<p>This is the sweet spot for first-time buyers. In South-East Pune, ${h.link(211)} in ${h.loc('Undri')}, ${h.link(212)} in Mohammadwadi and ${h.link(229)} in Ambegaon start between ₹62 and ₹68 Lacs. Near the airport, ${h.link(233)} and ${h.link(234)} in ${h.loc('Lohegaon')} start at about ₹65 Lacs. In PCMC, look at ${h.link(249)} in Dudulgaon and ${h.link(251)} in Dapodi, while ${h.link(199)} in Sus and ${h.link(111)} by Magarpatta Group in Loni Kalbhor round out the list.</p>
${h.table([211, 212, 229, 233, 234, 249, 251, 199, 111], '2 BHK projects from ₹60 Lacs to ₹80 Lacs')}

<h2>2 BHK flats from ₹80 Lacs to ₹1 Crore</h2>
<p>A little more budget gets you closer to the big job hubs. In ${h.loc('Hinjewadi')}, the Krisala Hiranandani township has ${h.link(204)} from ₹82 Lacs. ${h.link(165)} in ${h.loc('Dhanori')} starts at ₹81 Lacs, ${h.link(198)} by Mahindra in Mahalunge at ₹90 Lacs, and ${h.link(260)} in Dhanori at ₹87 Lacs. ${h.link(210)} in Hadapsar, ${h.link(241)} in Charholi, ${h.link(256)} in Lohegaon and ${h.link(242)} in Moshi all have 2 BHK homes in this band.</p>
${h.table([204, 165, 260, 198, 210, 241, 256, 242, 213], '2 BHK projects from ₹80 Lacs to ₹1 Cr')}

<h2>Premium 2 BHK flats from ₹1 Cr to ₹1.5 Cr</h2>
<p>If you want a 2 BHK in a prime micro-market, expect to pay ₹1 Cr or more. In ${h.loc('Mundhwa')}, ${h.link(13)} starts at ₹98 Lacs and ${h.link(25)} by Magarpatta Group at ₹1.08 Cr. In ${h.loc('Kharadi')}, ${h.link(135)}, ${h.link(21)} and ${h.link(265)} start between ₹92 Lacs and ₹1.25 Cr. West Pune options include ${h.link(201)} in ${h.loc('Baner')}, ${h.link(200)} in ${h.loc('Balewadi')} and ${h.link(182)} by Lodha in Hinjewadi. ${h.link(47)} in Magarpatta and ${h.link(235)} in ${h.loc('NIBM')} complete the list.</p>
${h.table([13, 25, 135, 21, 265, 201, 200, 182, 47, 235], 'Premium 2 BHK projects from ₹1 Cr to ₹1.5 Cr')}

<h2>2 BHK flats ready by the end of 2026</h2>
<p>If you’re paying rent, an early possession date matters as much as the price. These projects with 2 BHK homes are due by December 2026: ${h.link(244)} in Chikhali, ${h.link(233)} in Lohegaon, ${h.link(249)} in Dudulgaon, ${h.link(235)} in NIBM, ${h.link(228)} in Thergaon and ${h.link(232)} in ${h.loc('Tathawade')}. Our guide to <a href="/blog/ready-to-move-vs-under-construction-flats-pune">ready-to-move vs under-construction flats</a> explains the trade-offs.</p>
${h.table([244, 233, 249, 235, 228, 232], '2 BHK projects due by December 2026')}

<h2>How to choose the right 2 BHK</h2>
<ol>
  <li><strong>Compare carpet area, not the “2 BHK” label.</strong> 2 BHK homes in Pune range from about 650 to over 900 sq ft of carpet area. Work out the price per sq ft on carpet area.</li>
  <li><strong>Consider a 2.5 BHK.</strong> Many projects, such as ${h.link(25)} and ${h.link(111)}, offer a 2.5 BHK with a small study for a modest premium. It’s useful if you work from home.</li>
  <li><strong>Check the commute on a map.</strong> Open each project on the <a href="/map">live map</a> to see the roads and metro lines around it.</li>
  <li><strong>Budget for the extra costs.</strong> Stamp duty, registration and GST can add about 12% to the price. Read our guide to <a href="/blog/stamp-duty-registration-charges-pune">stamp duty and hidden costs</a>.</li>
  <li><strong>Plan your loan early.</strong> See our <a href="/blog/home-loan-emi-eligibility-pune">home loan EMI and eligibility guide</a> to know your budget before you book.</li>
  <li><strong>Verify the MahaRERA number</strong> for your tower. Here’s <a href="/blog/how-to-check-maharera-registration-number">how to check a MahaRERA number</a>.</li>
</ol>

<h2>FAQs: 2 BHK flats in Pune</h2>
<h3>What is the price of a new 2 BHK flat in Pune?</h3>
<p>Among the projects on our map, new 2 BHK homes start at about ₹30 Lacs in Chikhali, ₹62–68 Lacs in Undri and South-East Pune, ₹82–90 Lacs near Hinjewadi and Mahalunge, and ₹1–1.25 Cr in Kharadi, Mundhwa and Baner.</p>
<h3>Which is the best area to buy a 2 BHK in Pune?</h3>
<p>Choose the side of the city where you work. For Hinjewadi IT jobs, look at Hinjewadi, Tathawade, Sus and Mahalunge. For Kharadi and Magarpatta, look at Kharadi, Mundhwa, Hadapsar and Lohegaon. Our guide to the <a href="/blog/best-areas-to-buy-property-in-pune">best areas to buy property in Pune</a> compares them.</p>
<h3>Is a 2 BHK a good investment in Pune?</h3>
<p>2 BHK homes near IT hubs have the widest pool of tenants and resale buyers, so they are usually easier to rent and sell than larger homes. Rental yields depend on the exact location and price, so compare a few projects before you decide.</p>
<h3>Should I buy a 2 BHK or a 3 BHK?</h3>
<p>If your family may grow within a few years, compare the cost of a 3 BHK now with moving later. See our guide to <a href="/blog/3-bhk-flats-in-pune">3 BHK flats in Pune</a> and <a href="/blog/flats-under-1-crore-in-pune">flats under ₹1 crore</a>.</p>

<blockquote>Prices, configurations and possession dates are as listed on Mappingg in October 2026 and may change. Always confirm with the developer and on MahaRERA before you book.</blockquote>
`,
  };
}

function luxuryArticle(h) {
  return {
    slug: 'luxury-flats-villas-in-pune',
    title: 'Luxury Flats & Villas in Pune (2026): 4 & 5 BHK Projects from ₹2.5 Cr to ₹12 Cr',
    seo_title: 'Luxury Flats & Villas in Pune 2026: 4 & 5 BHK Prices',
    seo_description:
      'Luxury apartments and villas in Pune — Koregaon Park, Mundhwa, Kharadi, Baner, Kothrud & Aundh. 3.5 to 5 BHK homes from ₹2.5 Cr to ₹12 Cr, with possession dates and MahaRERA numbers.',
    excerpt:
      'Where Pune’s luxury homes are: Koregaon Park, Mundhwa, Kharadi, Baner, Kothrud and Aundh. Every 3.5–5 BHK apartment and villa project on our map from ₹2.5 Cr up, with prices and possession dates.',
    tags: ['Luxury Homes', 'Villas', 'Pune', 'Koregaon Park', '4 BHK'],
    cover: {
      theme: 'golden',
      kicker: 'Luxury guide',
      lines: ['Luxury Flats &', 'Villas in Pune', '2026 Price Guide'],
      stats: [['25+', 'luxury projects'], ['₹2.5 Cr+', 'entry price'], ['4–5 BHK', 'and villas']],
    },
    content: `
<p>Pune’s luxury market has grown quickly. Large 3.5, 4.5 and 5 BHK apartments and gated villa communities are now on offer from Koregaon Park and Mundhwa in the east to Baner, Aundh and Kothrud in the west. On the <a href="/map">Mappingg live map</a> we track more than 25 projects that start at ₹2.5 Cr or more, or that offer villas and 4–5 BHK homes. This guide brings them together by budget.</p>

<h2>Where Pune’s luxury homes are</h2>
<ul>
  <li><strong>${h.loc('Koregaon Park')} and Bund Garden Road:</strong> Pune’s most established premium address, with large apartments close to the city centre.</li>
  <li><strong>${h.loc('Mundhwa')}:</strong> the KP Annexe side has the widest choice of luxury towers and villa communities, at prices below Koregaon Park.</li>
  <li><strong>${h.loc('Kharadi')} and ${h.loc('Viman Nagar')}:</strong> high-rise 3.5 and 4.5 BHK homes near the EON IT Park and the airport.</li>
  <li><strong>${h.loc('Baner')}, ${h.loc('Balewadi')} and ${h.loc('Aundh')}:</strong> West Pune’s premium belt, close to Hinjewadi and the Mumbai–Bengaluru highway.</li>
  <li><strong>${h.loc('Kothrud')} and the city core:</strong> redevelopment-led luxury projects in established neighbourhoods.</li>
</ul>

${h.gallery([31, 15, 118, 6, 37, 181])}

<h2>Ultra-luxury homes and villas from ₹5 Cr</h2>
<p>At the top end, ${h.link(31)} in Mundhwa offers 4 BHK villas from ₹11.50 Cr, and ${h.link(52)} plans 4 and 5 BHK homes from ₹8 Cr to ₹12 Cr. ${h.link(187)} in Bhosale Nagar starts at ₹9.35 Cr. On Satara Road and Shankar Seth Road, ${h.link(218)} and ${h.link(219)} offer 3 and 4 BHK homes up to about ₹6.35 Cr.</p>
${h.table([31, 52, 187, 218, 219], 'Ultra-luxury projects in Pune')}

<h2>Luxury apartments from ₹3.5 Cr to ₹5 Cr</h2>
<p>This is the core of Pune’s luxury market. In Mundhwa, ${h.link(22)} offers villas from ₹4.95 Cr, ${h.link(15)} by Panchshil has 3.5 and 4.5 BHK homes from ₹4.32 Cr, and ${h.link(6)} by Magarpatta Group has 4.5 BHK homes from ₹4.30 Cr. In Koregaon Park, look at ${h.link(118)} and ${h.link(38)}. ${h.link(181)} in Aundh, ${h.link(215)} in Baner, ${h.link(104)} in Lulla Nagar, ${h.link(81)} in Kharadi and ${h.link(136)} in Viman Nagar complete the list.</p>
${h.table([22, 15, 6, 118, 38, 181, 119, 215, 104, 81, 136], 'Luxury projects from ₹3.5 Cr to ₹5 Cr')}

<h2>Premium homes from ₹2.5 Cr to ₹3.5 Cr</h2>
<p>For a large 3.5 or 4 BHK without paying ultra-luxury prices, consider ${h.link(37)} by Godrej Properties from ₹3.33 Cr, the upcoming ${h.link(9)} from ₹3 Cr, and ${h.link(2)} from ₹2.65 Cr, all in Mundhwa. In West Pune, ${h.link(159)} in Kothrud starts at ₹2.70 Cr, and the larger 4 BHK homes at ${h.link(216)} in Balewadi go up to ₹2.65 Cr.</p>
${h.table([37, 9, 2, 159, 216], 'Premium projects from ₹2.5 Cr to ₹3.5 Cr')}

<h2>Ready luxury homes</h2>
<p>Most luxury projects are still under construction. If you want to move in sooner, ${h.link(236)} in Pimple Saudagar (possession done) and ${h.link(93)} in Hadapsar (ready possession) are on our map, and ${h.link(81)} in Kharadi is nearing possession. Remember that a completed flat with an occupancy certificate attracts no GST.</p>
${h.table([236, 93, 81], 'Ready and nearly-ready premium projects')}

<h2>Price on request</h2>
<p>Some of Pune’s most exclusive projects don’t publish prices. These include ${h.link(167)} on Bund Garden Road, ${h.link(68)} in Mundhwa, ${h.link(84)} villas in Kharadi, ${h.link(162)} in Balewadi and ${h.link(101)} in Viman Nagar. Ask the developer for a price sheet and compare it with the projects above.</p>

<h2>Checklist before you buy a luxury home</h2>
<ol>
  <li><strong>Compare carpet area and the price per sq ft</strong> on carpet area. Large balconies, decks and private gardens are often priced differently.</li>
  <li><strong>Check the density.</strong> Ask how many homes share each floor and lift, and how much of the land is open space.</li>
  <li><strong>Look at the specifications in the agreement,</strong> not just the brochure: flooring, kitchen fittings, home automation and the number of parking spaces.</li>
  <li><strong>Check the developer’s delivery record</strong> on past luxury projects. See the <a href="/developers">developers page</a>.</li>
  <li><strong>Budget for the extra costs.</strong> On a ₹5 Cr home, stamp duty alone in PMC limits is about ₹35 Lacs. Read our guide to <a href="/blog/stamp-duty-registration-charges-pune">stamp duty and hidden costs</a>.</li>
  <li><strong>Remember the 1% TDS</strong> on every payment to the developer for homes worth ₹50 Lacs or more.</li>
  <li><strong>Verify the MahaRERA number</strong> for your tower. Here’s <a href="/blog/how-to-check-maharera-registration-number">how to check a MahaRERA number</a>.</li>
</ol>

<h2>FAQs: Luxury homes in Pune</h2>
<h3>Which is the most premium area in Pune?</h3>
<p>Koregaon Park and Bund Garden Road are Pune’s most established premium addresses. Mundhwa (KP Annexe), Kalyani Nagar, Baner and Aundh now offer many new luxury projects too.</p>
<h3>How much does a 4 BHK cost in Pune?</h3>
<p>Among the projects on our map, new 4 and 4.5 BHK homes start at about ₹3.3–4.5 Cr in Mundhwa, Kharadi and Baner, and go above ₹5 Cr in Koregaon Park and the city core. Villas in Mundhwa start at about ₹5 Cr and go above ₹11 Cr.</p>
<h3>Are there villa projects in Pune?</h3>
<p>Yes. ${h.link(31)} and ${h.link(22)} in Mundhwa and ${h.link(84)} in Kharadi offer villas inside gated communities.</p>
<h3>Where can I compare all luxury projects on a map?</h3>
<p>Open the <a href="/map">interactive map</a> to see each project with nearby roads and infrastructure, or compare localities in our guide to the <a href="/blog/best-areas-to-buy-property-in-pune">best areas to buy property in Pune</a>.</p>

<blockquote>Prices, configurations and possession dates are as listed on Mappingg in October 2026 and may change. Always confirm with the developer and on MahaRERA before you book.</blockquote>
`,
  };
}

function naviMumbaiArticle(h) {
  return {
    slug: 'new-projects-in-navi-mumbai',
    title: 'New Projects in Navi Mumbai (2026): Kharghar, Panvel, Airoli, Juinagar, Vashi & Nerul',
    seo_title: 'New Projects in Navi Mumbai 2026: Prices & BHK',
    seo_description:
      'New residential projects in Navi Mumbai — Kharghar, Panvel, Airoli, Juinagar, Vashi, Nerul & Taloja. 1 BHK from ₹48 Lacs to 2, 3 & 4 BHK homes from ₹1.57 Cr, with possession dates.',
    excerpt:
      'Every Navi Mumbai project on our map, node by node: budget 1 and 2 BHK homes in Upper Kharghar and Panvel, 2–4 BHK family homes from ₹1.57 Cr in Airoli, Juinagar and Kharghar, and the big launches in Vashi and Nerul.',
    tags: ['Navi Mumbai', 'Kharghar', 'Panvel', 'New Projects', 'MMR'],
    cover: {
      theme: 'emerald',
      kicker: 'Locality guide',
      lines: ['New Projects in', 'Navi Mumbai', '2026 Buyer’s Guide'],
      stats: [['19', 'projects tracked'], ['₹48 L', '1 BHK from'], ['1–4 BHK', 'homes']],
      pins: ['Kharghar', 'Vashi', 'Airoli', 'Panvel'],
      tagline: 'Pune & Mumbai’s live real-estate map',
    },
    content: `
<p>Looking for <strong>new projects in Navi Mumbai</strong>? Navi Mumbai was planned from the start as a city of nodes. Each node, such as Vashi, Nerul, Kharghar or Panvel, has its own stations, markets and schools. That makes it one of the most popular places in the Mumbai Metropolitan Region (MMR) for families who want more space than Mumbai offers at the same budget. On the <a href="/cities/mumbai">Mappingg map of Mumbai &amp; MMR</a> we track 19 projects across Navi Mumbai. This guide sorts them by node and budget.</p>

<h2>Why buy in Navi Mumbai?</h2>
<ul>
  <li><strong>Planned layout:</strong> wide roads, sector-wise planning and plenty of open space, compared with older parts of Mumbai.</li>
  <li><strong>Connectivity:</strong> the Harbour and Trans-Harbour suburban lines, the Sion–Panvel Highway, the Atal Setu (Mumbai Trans Harbour Link) to South Mumbai and Navi Mumbai Metro Line 1 around Belapur and Kharghar.</li>
  <li><strong>The new airport:</strong> Navi Mumbai International Airport near Panvel is driving demand in Kharghar, Panvel, Taloja and Ulwe.</li>
  <li><strong>Jobs nearby:</strong> the Thane–Belapur industrial belt and the IT parks in Airoli, Ghansoli and Mahape.</li>
</ul>

${h.gallery([177, 131, 132, 183, 224, 225], 'Navi Mumbai')}

<h2>Budget 1 &amp; 2 BHK homes under ₹1 Cr</h2>
<p>The most affordable new homes on our map are in the outer nodes. ${h.link(224)} in Upper ${h.loc('Kharghar')} offers 1 and 2 BHK homes from ₹48 Lacs to ₹71 Lacs, and ${h.link(225)} in ${h.loc('Panvel')} from about ₹64 Lacs to ₹90 Lacs. Both are by Today Group and due in December 2029.</p>
${h.table([224, 225], 'Navi Mumbai projects under ₹1 Cr')}

<h2>2, 3 &amp; 4 BHK family homes from ₹1.5 Cr to ₹2 Cr</h2>
<p>This band covers most of the larger homes on our map. ${h.link(183)} in Panvel starts at ₹1.57 Cr for 2 and 3 BHK homes, with some towers ready. In ${h.loc('Airoli')}, ${h.link(177)} starts at ₹1.72 Cr. ${h.link(131)} in ${h.loc('Juinagar')} and ${h.link(132)} in Kharghar both start at ₹1.90 Cr, with 2, 3 and 4 BHK homes.</p>
${h.table([183, 177, 131, 132], '2–4 BHK projects in Navi Mumbai from ₹1.5 Cr')}

<h2>More residential projects in Navi Mumbai</h2>
<p>Prices for these projects aren’t listed on our map yet. Open each project page or ask the developer for a price sheet:</p>
<ul>
  <li><strong>${h.loc('Vashi')}:</strong> ${h.link(173)} by Godrej Properties and ${h.link(171)} by Arihant Superstructures.</li>
  <li><strong>${h.loc('Nerul')}:</strong> ${h.link(169)}, plus the mixed-use ${h.link(126)} by Paradise Group.</li>
  <li><strong>Juinagar:</strong> ${h.link(129)} by Raheja Universal, ${h.link(130)} by K Raheja Corp and ${h.link(133)}.</li>
  <li><strong>Kharghar &amp; ${h.loc('Taloja')}:</strong> ${h.link(178)}, ${h.link(179)} and ${h.link(180)}, all by Paradise Group.</li>
  <li><strong>Airoli:</strong> ${h.link(175)} by Delta Bhagvati.</li>
</ul>

<h2>Commercial projects</h2>
<p>For office or retail space, look at ${h.link(127)} in Juinagar (ready) and ${h.link(128)} in Nerul. Browse every <a href="/property/commercial">commercial project</a> on the map to compare.</p>

<h2>Which Navi Mumbai node suits you?</h2>
<div class="table-scroll"><table>
<caption>Navi Mumbai nodes at a glance</caption>
<thead><tr><th>Node</th><th>Best for</th><th>On our map</th></tr></thead>
<tbody>
<tr><td>Vashi, Nerul, Juinagar</td><td>Established nodes closest to Mumbai, good schools and markets</td><td>Launches by large developers; prices not yet listed on our map</td></tr>
<tr><td>Airoli</td><td>Working near the Airoli–Ghansoli IT parks or Thane</td><td>2–4 BHK from ₹1.72 Cr</td></tr>
<tr><td>Kharghar</td><td>Families wanting space, green areas and the metro</td><td>1–2 BHK from ₹48 Lacs in Upper Kharghar; 2–4 BHK from ₹1.90 Cr</td></tr>
<tr><td>Panvel &amp; Taloja</td><td>Lowest entry prices; closest to the new airport</td><td>1–2 BHK from about ₹64 Lacs; 2–3 BHK from ₹1.57 Cr</td></tr>
</tbody></table></div>

<h2>Checklist before you book in Navi Mumbai</h2>
<ol>
  <li><strong>Verify the MahaRERA number</strong> for your tower or phase. Here’s <a href="/blog/how-to-check-maharera-registration-number">how to check a MahaRERA number</a>. Several projects above don’t show a number on our map yet, so ask the developer for it.</li>
  <li><strong>Check whether the land is freehold or CIDCO leasehold.</strong> Much of Navi Mumbai is on CIDCO lease land, which affects transfer charges and paperwork.</li>
  <li><strong>Compare carpet area</strong> and work out the price per sq ft on carpet area, not on the “2 BHK” label.</li>
  <li><strong>Check the commute on a map.</strong> Open each project on the <a href="/map">live map</a> to see the stations, highways and metro around it.</li>
  <li><strong>Budget for the extra costs.</strong> Stamp duty, registration and GST add several percent to the price. Confirm the stamp duty rate for the exact municipal area with your lawyer.</li>
</ol>

<h2>FAQs: New projects in Navi Mumbai</h2>
<h3>What is the cheapest new project in Navi Mumbai?</h3>
<p>Among the projects on our map, ${h.link(224)} in Upper Kharghar has the lowest starting price, with 1 BHK homes from about ₹48 Lacs, followed by ${h.link(225)} in Panvel from about ₹64 Lacs.</p>
<h3>How much does a 3 BHK cost in Navi Mumbai?</h3>
<p>New 2–4 BHK projects on our map start at ₹1.57 Cr in Panvel, ₹1.72 Cr in Airoli and ₹1.90 Cr in Juinagar and Kharghar. 3 BHK homes are usually priced above these starting figures.</p>
<h3>Is Navi Mumbai good for investment?</h3>
<p>The new airport, the Atal Setu and the metro are all improving access, especially to Panvel, Kharghar and Taloja. As with any purchase, compare possession dates and the developer’s delivery record before you decide.</p>
<h3>Where can I see all Navi Mumbai projects on a map?</h3>
<p>Open the <a href="/cities/mumbai">Mumbai &amp; MMR page</a> for the full list, or the <a href="/map">interactive map</a>. Also comparing Kalyan, Dombivli and Thane? Read our guide to <a href="/blog/new-projects-in-kalyan-dombivli-palava-thane">new projects in Kalyan, Dombivli, Palava &amp; Thane</a>.</p>

<blockquote>Prices, configurations and possession dates are as listed on Mappingg in October 2026 and may change. Always confirm with the developer and on MahaRERA before you book.</blockquote>
`,
  };
}

function kalyanDombivliArticle(h) {
  return {
    slug: 'new-projects-in-kalyan-dombivli-palava-thane',
    title: 'New Projects in Kalyan, Dombivli, Palava & Thane (2026): Flats from ₹29 Lacs to Luxury Villas',
    seo_title: 'New Projects in Kalyan, Dombivli, Palava & Thane 2026',
    seo_description:
      'New projects on Kalyan Shil Road, Dombivli, Manpada, Palava and Thane — 1 & 2 BHK flats from ₹29 Lacs, 3 BHK homes from ₹1.51 Cr and Lodha villas, with possession dates.',
    excerpt:
      'Kalyan–Dombivli is MMR’s biggest affordable-housing belt, and Palava adds luxury homes and villas. Here is every project on our map along Kalyan Shil Road, in Dombivli, Manpada, Palava and Thane, sorted by budget.',
    tags: ['Kalyan', 'Dombivli', 'Palava', 'Thane', 'MMR'],
    cover: {
      theme: 'sunrise',
      kicker: 'Locality guide',
      lines: ['New Projects in', 'Kalyan, Dombivli', 'Palava & Thane'],
      stats: [['21', 'projects tracked'], ['₹29 L', 'entry price'], ['1 BHK–villas', 'on offer']],
      tagline: 'Pune & Mumbai’s live real-estate map',
    },
    content: `
<p>The Kalyan–Dombivli belt, and the Palava township along Kalyan Shil Road, is where much of the Mumbai Metropolitan Region’s new housing is being built. Prices here are a fraction of Mumbai’s, and big developers such as Lodha, Runwal and Rustomjee are active. On the <a href="/cities/mumbai">Mappingg map of Mumbai &amp; MMR</a> we track 21 projects in ${h.loc('Kalyan')}, ${h.loc('Dombivli')}, ${h.loc('Manpada')}, ${h.loc('Palava')} and ${h.loc('Thane')}. This guide sorts them by budget.</p>

<h2>Why buy along Kalyan Shil Road?</h2>
<ul>
  <li><strong>Affordable entry:</strong> new 1 and 2 BHK homes start below ₹50 Lacs, far below Mumbai and Thane city prices.</li>
  <li><strong>Large townships:</strong> Palava and Runwal Garden City are planned as townships, with homes, shops and amenities in one place.</li>
  <li><strong>Connectivity:</strong> Kalyan and Dombivli stations on the Central line, Kalyan Shil Road towards Navi Mumbai and Thane, and new metro lines planned for the region.</li>
  <li><strong>Choice at every budget:</strong> from ₹29 Lacs starter homes to 4 and 5 BHK homes and villas in Palava.</li>
</ul>

${h.gallery([121, 147, 120, 152, 222, 192], 'Mumbai Metropolitan Region')}

<h2>Flats under ₹50 Lacs</h2>
<p>For first-time buyers, ${h.link(151)} in Manpada starts at ₹29 Lacs for 1 and 2 BHK homes, with some towers ready. ${h.link(153)} at Vicco Naka in Dombivli starts at ₹35 Lacs, and ${h.link(123)} by Lodha on Kalyan Shil Road at ₹38 Lacs. ${h.link(150)} in Manpada, ${h.link(154)} in Dombivli East, ${h.link(120)} by Runwal, ${h.link(223)} at Shilphata and ${h.link(192)} (ready possession) all start between ₹42 Lacs and ₹48 Lacs.</p>
${h.table([151, 153, 123, 150, 154, 120, 223, 192], 'Projects starting under ₹50 Lacs')}

<h2>Flats from ₹50 Lacs to ₹1 Cr</h2>
<p>A little more budget gets you a bigger home in a well-known township. ${h.link(124)} by Paradise Group starts at ₹51 Lacs with 1 to 3 BHK homes. ${h.link(152)} by Rustomjee and ${h.link(122)} by Lodha offer 1, 2 and 3 BHK homes from about ₹52–55 Lacs. ${h.link(155)} in Dombivli East starts at ₹55 Lacs, and ${h.link(222)} at Shilphata at ₹60 Lacs.</p>
${h.table([124, 152, 122, 155, 222], 'Projects from ₹50 Lacs to ₹1 Cr')}

<h2>3 &amp; 4 BHK homes from ₹1.5 Cr</h2>
<p>For a larger family home, ${h.link(121)} by Lodha on Kalyan Shil Road offers 3 and 4 BHK homes and duplexes from ₹1.51 Cr. In Palava, ${h.link(147)} starts at ₹2.50 Cr for 3 and 4 BHK homes and duplexes, due in December 2027.</p>
${h.table([121, 147], '3 & 4 BHK projects from ₹1.5 Cr')}

<h2>Luxury homes and villas in Palava and Thane</h2>
<p>At the top end, ${h.link(149)} in Palava Phase 1 offers 4 and 5 BHK homes from ₹7 Cr, due in June 2027. ${h.link(148)} in Palava Phase 2 offers bare-shell villas from ₹4.2 Cr. In Thane, the upcoming ${h.link(156)} plans 3 and 4 BHK homes from ₹4 Cr.</p>
${h.table([149, 148, 156], 'Luxury projects in Palava and Thane')}

<h2>More projects in Thane</h2>
<p>Our map also has ${h.link(386)} and ${h.link(385)} by Raheja Universal in Thane. Both are MahaRERA-registered, but their prices aren’t listed on our map yet, so ask the developer for a price sheet.</p>

<h2>Commercial space</h2>
<p>${h.link(125)} by Lodha on Kalyan Shil Road offers office space from ₹1 Cr, with some buildings ready. ${h.link(120)} by Runwal also has shops and offices alongside its homes.</p>

<h2>Homes you can move into sooner</h2>
<p>If you’re paying rent, look at projects with ready towers: ${h.link(192)} (ready possession), and the ready phases of ${h.link(120)}, ${h.link(122)}, ${h.link(124)} and ${h.link(151)}. Later phases of the same projects are due between 2027 and 2028. Our guide to <a href="/blog/ready-to-move-vs-under-construction-flats-pune">ready-to-move vs under-construction flats</a> explains the trade-offs, and they apply across Maharashtra.</p>

<h2>Checklist before you book</h2>
<ol>
  <li><strong>Verify the MahaRERA number</strong> for your exact tower or phase. Most projects above don’t show a number on our map yet, so ask the developer and check it yourself. Here’s <a href="/blog/how-to-check-maharera-registration-number">how to check a MahaRERA number</a>.</li>
  <li><strong>Check the possession date for your tower.</strong> Large townships deliver in phases, so “Ready &amp; Dec 2028” means some towers are ready and others are not.</li>
  <li><strong>Test the commute at peak hours.</strong> Kalyan Shil Road traffic can be heavy, so check your route to work on the <a href="/map">live map</a> and in person.</li>
  <li><strong>Compare carpet area</strong> and work out the price per sq ft on carpet area.</li>
  <li><strong>Budget for the extra costs.</strong> Stamp duty, registration and GST add several percent to the price. Confirm the stamp duty rate for your municipal area with your lawyer.</li>
</ol>

<h2>FAQs: Kalyan, Dombivli, Palava &amp; Thane</h2>
<h3>What is the cheapest new project in Kalyan–Dombivli?</h3>
<p>Among the projects on our map, ${h.link(151)} in Manpada starts at ₹29 Lacs, followed by ${h.link(153)} in Dombivli at ₹35 Lacs and ${h.link(123)} on Kalyan Shil Road at ₹38 Lacs.</p>
<h3>Is Palava a good place to buy?</h3>
<p>Palava is a large Lodha township with homes from mid-range 3 BHKs to villas and 5 BHK residences. It suits buyers who want a self-contained township. Compare commute times and possession dates before you decide.</p>
<h3>Which mid-range projects in Kalyan–Dombivli offer 3 BHK homes?</h3>
<p>${h.link(154)}, ${h.link(124)}, ${h.link(152)} and ${h.link(122)} all list 3 BHK homes. Their starting prices (about ₹44–55 Lacs) are for the smallest homes, so ask each developer for the 3 BHK price sheet.</p>
<h3>Where can I see these projects on a map?</h3>
<p>Open the <a href="/cities/mumbai">Mumbai &amp; MMR page</a> or the <a href="/map">interactive map</a>. Also considering Navi Mumbai? Read our guide to <a href="/blog/new-projects-in-navi-mumbai">new projects in Navi Mumbai</a>.</p>

<blockquote>Prices, configurations and possession dates are as listed on Mappingg in October 2026 and may change. Always confirm with the developer and on MahaRERA before you book.</blockquote>
`,
  };
}

function commercialArticle(h) {
  return {
    slug: 'commercial-property-office-space-in-pune',
    title: 'Commercial Property in Pune (2026): Office Space, Shops & Studio Investments',
    seo_title: 'Commercial Property in Pune 2026: Offices & Shops',
    seo_description:
      'Office space, shops, showrooms and studio units in Pune — Mundhwa, Kharadi, Kothrud, Camp & PCMC compared by price, possession and MahaRERA number. Studios from ₹46 Lacs.',
    excerpt:
      'Buying an office, shop or studio unit in Pune? Real commercial projects in Mundhwa, Kharadi, Kothrud, Camp, Sadashiv Peth and PCMC, with prices, possession dates, MahaRERA numbers and the costs to plan for.',
    tags: ['Commercial Property', 'Office Space in Pune', 'Pune', 'Investment', 'Shops'],
    cover: {
      theme: 'midnight',
      kicker: 'Investor guide',
      lines: ['Commercial Property', 'in Pune: Offices,', 'Shops & Studios'],
      stats: [['₹46 L', 'studios from'], ['₹84 L', 'shops & offices from'], ['EON · WTC', 'leasing hubs']],
    },
    content: `
<p>Looking for <strong>commercial property in Pune</strong>? Pune’s office market is built around its IT and business districts: Kharadi’s EON IT Park and World Trade Center, Magarpatta, Hinjewadi and, increasingly, Mundhwa. Alongside large leased-out office parks, developers are also selling smaller offices, shops, showrooms and studio units to individual investors. This guide lists the commercial projects on <a href="/property/commercial">Mappingg’s commercial map</a>, with prices, possession dates and MahaRERA numbers where the developer has shared them.</p>

<h2>Types of commercial property you can buy in Pune</h2>
<ul>
  <li><strong>Office space:</strong> from small office units of a few hundred sq ft to full floors. Buyers either use them or lease them to companies.</li>
  <li><strong>Shops and showrooms:</strong> ground- and first-floor retail on busy roads or in high-street developments. Footfall and frontage matter more than size.</li>
  <li><strong>Studio / serviced units:</strong> compact, low-ticket units in mixed-use towers, usually bought to rent out to working professionals.</li>
  <li><strong>Leased Grade-A space:</strong> large IT parks such as EON and WTC are mostly leased to companies rather than sold unit by unit.</li>
</ul>

<h2>Office space in Mundhwa and Magarpatta</h2>
<p>Mundhwa is the most active commercial micro-market on our map. ${h.link(3)} by Ram India Group offers office space from ₹2.2 Cr, with possession in June 2029, and is registered as a commercial project on MahaRERA (<code>PC1260002500325</code>). At the top end, ${h.link(24)} near the old passport office junction offers offices of 3,000 to 18,000 sq ft from ₹8.10 Cr, due in December 2030. ${h.link(48)}, ${h.link(59)} and the upcoming ${h.link(53)} add more supply, and ${h.link(8)} by Magarpatta Group is under construction next door in Magarpatta.</p>
${h.table([3, 24, 48, 59, 8], 'Office projects in Mundhwa & Magarpatta')}

<h2>Shops, showrooms and offices in central Pune</h2>
<p>In the old city, high-street retail is the main draw. ${h.link(254)} in Sadashiv Peth has showrooms and offices from ₹84 Lacs, due in December 2027. ${h.link(158)} on Laxmi Road offers premium retail shops and anchor showrooms from ₹1.50 Cr. Near the Collector’s Office in Camp, ${h.link(115)} by Kundan Spaces is a 37-floor tower with offices, shops and showrooms from ₹1.50 Cr, due in December 2028. In West Pune, ${h.link(220)} in Vanaz, Kothrud has shops and offices from ₹1.8 Cr, due in June 2027.</p>
${h.table([254, 158, 115, 220], 'Shops & offices in central and West Pune')}

<h2>Studio units for rental income</h2>
<p>If your budget is under ₹60 Lacs, studio units are the lowest-ticket way into Pune’s commercial and mixed-use market. Jhamtani Group has two projects in Mundhwa: ${h.link(34)} from ₹46 Lacs (December 2028) and ${h.link(30)} from ₹52 Lacs (December 2027, MahaRERA <code>P52100054261</code>). Tenants are typically professionals working in Kharadi, Magarpatta and Koregaon Park, so check commute times on the <a href="/map">live map</a> before you buy.</p>
${h.table([34, 30], 'Studio units in Mundhwa')}

<h2>Retail and offices in PCMC, NIBM and Sanghvi</h2>
<p>${h.link(61)} on Tata Motors Road in Pimpri-Chinchwad offers office space (price on request, due December 2030). ${h.link(243)} in Sanghvi has shops from ₹1.34 Cr and is listed as available, with MahaRERA number <code>P52100077792</code>. In South-East Pune, ${h.link(109)} by VTP Group has shops, showrooms and a rooftop restaurant space.</p>
${h.table([61, 243, 109], 'Commercial projects in PCMC, Sanghvi & NIBM')}

<h2>Grade-A office parks: EON, WTC and Kharadi</h2>
<p>Kharadi is Pune’s biggest office cluster. Panchshil Realty’s ${h.link(78)}, ${h.link(91)} and ${h.link(79)} are large, completed office parks. Space here is mostly leased to companies rather than sold to individuals, but these parks drive rental demand for every home and studio around them. That’s one reason <a href="/blog/new-projects-in-kharadi-pune">new projects in Kharadi</a> and nearby Mundhwa stay in demand. ${h.link(88)} is a newer office project under construction in Kharadi.</p>
${h.gallery([78, 79, 91])}
<p>For ready space, ${h.link(95)} in Mundhwa is listed for rental and resale, and ${h.link(96)} on Nagar Road in Wagholi is offered for leasing only.</p>

<h2>Costs to plan for when buying commercial property</h2>
<div class="table-scroll"><table>
<caption>Typical extra costs on a commercial purchase in Pune</caption>
<thead><tr><th>Cost</th><th>What to expect</th></tr></thead>
<tbody>
<tr><td>GST</td><td>12% on under-construction commercial units (the developer can claim input tax credit). No GST once the occupancy certificate is issued.</td></tr>
<tr><td>Stamp duty</td><td>Same rate as residential property in PMC/PCMC limits. The concession for women buyers applies to residential property only.</td></tr>
<tr><td>Registration</td><td>1% of the value, capped at ₹30,000.</td></tr>
<tr><td>TDS</td><td>1% deducted by the buyer when the price is ₹50 Lacs or more (Section 194-IA).</td></tr>
<tr><td>Maintenance &amp; property tax</td><td>Usually higher per sq ft than for homes. Ask for the expected monthly charges in writing.</td></tr>
</tbody></table></div>
<p><small>Tax rates as in force in October 2026. See our full guide to <a href="/blog/stamp-duty-registration-charges-pune">stamp duty and registration charges in Pune</a>, and confirm the figures for your purchase with a chartered accountant.</small></p>

<h2>Checklist before you buy an office or shop</h2>
<ol>
  <li><strong>Verify the MahaRERA number.</strong> RERA covers commercial projects too. Newer commercial registrations start with <code>PC</code>. Here’s <a href="/blog/how-to-check-maharera-registration-number">how to check a MahaRERA number</a>.</li>
  <li><strong>Compare carpet area and loading.</strong> Commercial projects often quote “super” or chargeable area, which can be far larger than the usable carpet area.</li>
  <li><strong>Check frontage, floor and footfall</strong> for shops. A ground-floor shop on the main road can be worth much more than one on an upper floor.</li>
  <li><strong>Ask about parking and power backup.</strong> Office tenants expect both, and they affect the rent you can charge.</li>
  <li><strong>Work out the real rental yield.</strong> Divide the expected yearly rent, after maintenance and tax, by your all-in cost, not just the base price.</li>
  <li><strong>Check what’s around the project</strong> on the <a href="/map">live map</a>: offices, metro stations and new roads drive both rent and resale.</li>
</ol>

<h2>FAQs: Commercial property in Pune</h2>
<h3>What is the cheapest way to invest in commercial property in Pune?</h3>
<p>Among the projects on our map, studio units are the lowest-ticket option: ${h.link(34)} from ₹46 Lacs and ${h.link(30)} from ₹52 Lacs, both in Mundhwa. For shops and offices, ${h.link(254)} in Sadashiv Peth starts at ₹84 Lacs.</p>
<h3>Where is the best place to buy office space in Pune?</h3>
<p>It depends on your tenants. Kharadi and Mundhwa sit next to EON IT Park, WTC and Magarpatta, so they suit IT and services companies. Camp, Laxmi Road and Sadashiv Peth suit retail, showrooms and professional offices such as CAs and doctors.</p>
<h3>Is GST charged on commercial property?</h3>
<p>Yes, on under-construction units: 12% with input tax credit available to the developer. Completed units sold after the occupancy certificate do not attract GST.</p>
<h3>Can I get a loan for commercial property?</h3>
<p>Yes. Banks offer loans against commercial property, but usually at a higher interest rate and a lower loan-to-value ratio than home loans. Compare offers before you book. Our <a href="/blog/home-loan-emi-eligibility-pune">home loan guide</a> explains EMI and eligibility.</p>

<blockquote>Prices, configurations and possession dates are as listed on Mappingg in October 2026 and may change. This guide is general information, not tax or investment advice. Always confirm details with the developer, on MahaRERA and with your own advisers before you book.</blockquote>
`,
  };
}

function upcomingArticle(h) {
  return {
    slug: 'upcoming-new-launch-projects-in-pune',
    title: 'Upcoming & New Launch Projects in Pune (2026): Pre-Launch, EOI & RERA Guide',
    seo_title: 'Upcoming & New Launch Projects in Pune 2026',
    seo_description:
      'Upcoming and newly launched projects in Pune — Mundhwa, Hinjewadi, Lohegaon, Kharadi, Wakad & more — with prices, possession dates, MahaRERA numbers and how to book safely at EOI stage.',
    excerpt:
      'New launches and pre-launch (EOI) projects in Pune, from ₹72.89 Lacs 2 BHKs in Lohegaon to luxury 4/5 BHKs in Mundhwa — with possession dates, MahaRERA numbers and the rules that protect you before you pay.',
    tags: ['New Launch Projects', 'Upcoming Projects in Pune', 'Pune', 'Pre-Launch', 'MahaRERA'],
    cover: {
      theme: 'sunrise',
      kicker: 'New launches',
      lines: ['Upcoming & New', 'Launch Projects', 'in Pune, 2026'],
      stats: [['₹72.9 L', '2 BHK from'], ['2029–31', 'possession'], ['RERA', 'check before EOI']],
    },
    content: `
<p>Buying at launch is one of the most common ways to get a better price on a new flat in Pune. Developers often offer launch pricing, flexible payment plans and the widest choice of floors and views. This guide lists the <strong>upcoming and new launch projects in Pune</strong> on Mappingg’s map: projects taking expressions of interest (EOI) now, and projects launched recently with possession in 2029–2031. It also covers the rules that protect you before you pay anything.</p>

<h2>What “upcoming”, “pre-launch” and “new launch” mean</h2>
<ul>
  <li><strong>Upcoming / pre-launch:</strong> the developer is collecting interest but the project may not yet be registered with MahaRERA. You may be asked for a refundable EOI cheque to reserve a place in the queue.</li>
  <li><strong>New launch:</strong> the project is registered with MahaRERA and formally open for booking. Prices are usually at their lowest at this stage.</li>
  <li><strong>Under construction:</strong> booking is open and building work has started. Possession dates are firmer, and so are prices.</li>
</ul>
<p>Under RERA, a developer cannot advertise, market, book or sell flats in a project that must be registered until it has a MahaRERA registration. A developer also cannot take more than 10% of the price as an advance before signing a registered agreement for sale.</p>

<h2>Upcoming projects in Pune taking EOIs</h2>
<p>In Mundhwa, ${h.link(207)} by Kumar Corp is taking EOIs for 2 and 3 BHK homes from ₹1.20 Cr, with possession planned for December 2031. It already shows a MahaRERA number on our map (<code>PR1264042501296</code>). ${h.link(7)} plans 3 and 4 BHK homes, and Pristine Properties has two upcoming projects: ${h.link(5)}, with 3 BHK homes and shops from ₹1.89 Cr, and ${h.link(9)}, with 3, 4 and 5 BHK homes from ₹3 Cr. At the luxury end, ${h.link(52)} plans 4 and 5 BHK residences priced at ₹8–12 Cr.</p>
<p>In North Hinjewadi, the 105-acre Krisala Hiranandani township has announced ${h.link(206)}, with 2 and 3 BHK homes from ₹85 Lacs to ₹1.35 Cr. Near Pune Airport, ${h.link(256)} in Lohegaon offers airport-facing 2 and 3 BHK homes from ₹72.89 Lacs, due in August 2029 (MahaRERA <code>PM1260002602036</code>). In Kharadi, ${h.link(134)} is listed from ₹1.25 Cr.</p>
${h.table([207, 206, 256, 134, 5, 9, 52, 7], 'Upcoming projects in Pune')}

<h2>New launches with possession in 2030–2031</h2>
<p>These projects are already registered and under construction, but are at an early stage, with possession four to five years away. That’s usually where launch-phase pricing is still available.</p>
<h3>East Pune: Mundhwa, Kharadi and Manjri</h3>
<p>${h.link(10)} offers 3 and 4 BHK homes from ₹2.20 Cr (December 2031). ${h.link(23)} has 3 and 4 BHK homes plus showrooms from ₹2.31 Cr, and ${h.link(17)} has 3, 4 and 4.5 BHK homes from ₹1.95 Cr (March 2030). In Kharadi, ${h.link(135)} offers 2, 3 and 4 BHK homes from ₹1.12 Cr (December 2030). On the Solapur Highway, ${h.link(113)} by Shapoorji Pallonji in Manjri starts at ₹1.42 Cr.</p>
${h.table([10, 23, 17, 135, 113], 'New launches in East Pune')}

<h3>West Pune: Hinjewadi, Wakad, Tathawade, Mahalunge and Sus</h3>
<p>West Pune has the most new launches under ₹1 Cr. ${h.link(199)} in Sus starts at ₹74 Lacs, ${h.link(204)} in North Hinjewadi at ₹82 Lacs and ${h.link(198)} in Mahalunge at ₹90 Lacs. ${h.link(202)} in Tathawade starts at ₹93 Lacs. In Wakad, Kohinoor’s ${h.link(270)} (₹92 Lacs to ₹1.9 Cr) and ${h.link(246)} by Binary Infrastructures (₹1.3–2.25 Cr) are both due in 2030–31, and ${h.link(269)} in Hinjewadi Phase 1 offers 3 and 4 BHK homes from ₹99 Lacs.</p>
${h.table([199, 204, 198, 202, 270, 246, 269, 205], 'New launches in West Pune')}

<h3>Central and luxury launches</h3>
<p>${h.link(168)} by Birla Estate in Mangalwar Peth offers 2, 3 and 4 BHK homes from ₹1.73 Cr (September 2031). For luxury buyers, ${h.link(103)} in Kalyani Nagar starts at ₹4.25 Cr and ${h.link(119)} on Shankar Sheth Road at ₹4.71 Cr. Our guide to <a href="/blog/luxury-flats-villas-in-pune">luxury flats and villas in Pune</a> covers more options.</p>
${h.table([168, 103, 119], 'Central and luxury launches')}

<h2>How to book safely at the pre-launch or EOI stage</h2>
<ol>
  <li><strong>Check for a MahaRERA number before you pay a booking amount.</strong> If the project isn’t registered yet, keep any EOI small and get it in writing as fully refundable. Here’s <a href="/blog/how-to-check-maharera-registration-number">how to check a MahaRERA number</a>.</li>
  <li><strong>Get the EOI terms in writing:</strong> the amount, whether it is refundable, the refund timeline and what happens if the launch price is higher than expected.</li>
  <li><strong>Pay by cheque or bank transfer to the developer’s account</strong>, never in cash and never to an individual.</li>
  <li><strong>Compare the launch price with nearby projects.</strong> Use the <a href="/map">live map</a> to see what similar under-construction and <a href="/status/ready-to-move">ready-to-move</a> projects nearby are asking.</li>
  <li><strong>Plan for a long wait.</strong> Possession in 2030–31 means paying rent or EMI for years. Our guide to <a href="/blog/ready-to-move-vs-under-construction-flats-pune">ready-to-move vs under-construction flats</a> explains the trade-offs.</li>
  <li><strong>Check the developer’s track record</strong> on past projects. Compare their earlier RERA completion dates with when buyers actually got possession.</li>
</ol>

<h2>FAQs: Upcoming projects in Pune</h2>
<h3>Which upcoming projects in Pune have a MahaRERA number?</h3>
<p>Among the upcoming projects on our map, ${h.link(207)} in Mundhwa (<code>PR1264042501296</code>) and ${h.link(256)} in Lohegaon (<code>PM1260002602036</code>) show MahaRERA numbers. For the others, ask the developer and check the official MahaRERA website before you pay a booking amount.</p>
<h3>What is the cheapest new launch in Pune?</h3>
<p>Among the projects in this guide, ${h.link(256)} in Lohegaon starts at ₹72.89 Lacs and ${h.link(199)} in Sus at ₹74 Lacs. See more options in our guide to <a href="/blog/flats-under-1-crore-in-pune">flats under ₹1 crore in Pune</a>.</p>
<h3>Is an EOI refundable?</h3>
<p>Most developers describe EOIs as refundable, but terms vary. Get the refund conditions and timeline in writing before you pay.</p>
<h3>Is it better to buy at launch?</h3>
<p>Launch prices are usually the lowest, and you get the most choice. In return you wait longer for possession and take on more delivery risk. Check the developer’s track record and the RERA completion date, and make sure you can afford rent and EMI at the same time if needed.</p>

<blockquote>Prices, configurations and possession dates are as listed on Mappingg in October 2026. Upcoming projects in particular can change price, layout and timing before launch. Always confirm with the developer and on MahaRERA before you pay.</blockquote>
`,
  };
}

function bengaluruArticle(h) {
  const KRERA = 'K-RERA no.';
  return {
    slug: 'new-projects-in-bengaluru',
    title: 'New Projects in Bengaluru (2026): Whitefield, Sarjapur–Anekal, North & South Bengaluru',
    seo_title: 'New Projects in Bengaluru 2026: Prices & K-RERA',
    seo_description:
      '90+ new residential projects in Bengaluru — East (Whitefield), Anekal (Sarjapur), South, North & Yelahanka — with prices from ₹90 Lacs, possession dates and Karnataka RERA numbers.',
    excerpt:
      'Every Bengaluru project on our map, area by area: 2 BHK homes from ₹90 Lacs, premium 3 and 4 BHK homes by Sobha, Godrej, Lodha and Puravankara, plotted layouts, and the projects due first — with K-RERA numbers.',
    tags: ['Bengaluru', 'Bangalore', 'New Projects', 'Whitefield', 'Sarjapur'],
    cover: {
      theme: 'forest',
      kicker: 'City guide',
      lines: ['New Projects in', 'Bengaluru', '2026 Buyer’s Guide'],
      stats: [['90+', 'projects tracked'], ['₹90 L', 'homes from'], ['K-RERA', 'numbers listed']],
      tagline: 'Bengaluru’s live real-estate map',
    },
    content: `
<p>Looking for <strong>new projects in Bengaluru</strong>? India’s technology capital has one of the deepest housing markets in the country, from compact 2 BHK homes near the IT corridors to large townships on the city’s edges. On the <a href="/cities/bengaluru">Mappingg map of Bengaluru</a> we now track more than 90 projects, and most of them show a Karnataka RERA (K-RERA) registration number. This guide sorts them by budget and area so you can shortlist faster.</p>

<h2>How Bengaluru projects are grouped</h2>
<p>K-RERA registers projects by taluk, so that is how the areas are named on our map:</p>
<ul>
  <li><strong>${h.loc('Bengaluru East')}:</strong> Whitefield, Varthur, KR Puram and the eastern IT belt.</li>
  <li><strong>${h.loc('Anekal')}:</strong> the south-east edge of the city, including Sarjapur, Attibele and Chandapura, where several large townships are coming up.</li>
  <li><strong>${h.loc('Bengaluru South')}:</strong> the southern suburbs, including Begur, Uttarahalli, Kengeri and the roads leading out of the city to the south.</li>
  <li><strong>${h.loc('Bengaluru North')}</strong> and <strong>${h.loc('Yelahanka')}:</strong> north Bengaluru, on the side of the city facing the international airport.</li>
</ul>

${h.gallery([191, 188, 189, 190], 'Bengaluru')}

<h2>Homes under ₹1.5 Cr</h2>
<p>The lowest starting prices on our map are ${h.link(191)} by Century Real Estate at ₹90 Lacs for 2, 2.5 and 3 BHK homes, and ${h.link(304)} by Brigade Group in Bengaluru East at ₹97 Lacs, which also offers 1 BHK homes. ${h.link(188)} in Yelahanka New Town starts at ₹1.12 Cr and ${h.link(305)} in Bengaluru South at ₹1.22 Cr. In the north, ${h.link(306)} starts at ₹1.45 Cr, and ${h.link(335)} in the south at ₹1.49 Cr.</p>
${h.table([191, 304, 188, 305, 306, 335], 'Bengaluru projects from under ₹1.5 Cr', KRERA)}

<h2>Premium 3 &amp; 4 BHK homes from ₹2 Cr</h2>
<p>Most of the larger homes on our map are 3 and 4 BHK apartments by the city’s big developers. ${h.link(299)} in Bengaluru East and ${h.link(337)} both start at ₹2.20 Cr. ${h.link(315)} by Lodha in Anekal starts at ₹2.45 Cr and ${h.link(317)} by Puravankara at ₹2.55 Cr. From around ₹3 Cr, look at ${h.link(338)} in Bengaluru North, ${h.link(341)}, ${h.link(322)} and ${h.link(312)} by Sobha, and ${h.link(189)} by Century Real Estate from ₹4.25 Cr.</p>
${h.table([299, 337, 315, 317, 338, 341, 322, 312, 189], 'Premium projects in Bengaluru from ₹2 Cr', KRERA)}

<h2>Projects due first: possession in 2028</h2>
<p>Most new launches in Bengaluru are due between 2029 and 2032. If you want to move in sooner, these projects on our map have the earliest possession dates:</p>
${h.table([355, 313, 372, 370, 371, 378], 'Bengaluru projects due in 2028', KRERA)}
<p>Weighing up an early possession date against a better launch price? Our guide to <a href="/blog/ready-to-move-vs-under-construction-flats-pune">ready-to-move vs under-construction flats</a> explains the trade-offs. It is written for Pune, but the logic is the same in Bengaluru.</p>

<h2>Area by area</h2>
<h3>Bengaluru East: Whitefield and the eastern IT belt</h3>
<p>Sumadhura Group has the most projects here: ${h.link(318)}, ${h.link(320)}, ${h.link(319)}, ${h.link(334)} and ${h.link(337)}, most due in December 2029. Also on the map are ${h.link(316)} by Prestige Group, ${h.link(340)} by Sattva Group, ${h.link(408)}, ${h.link(413)} and ${h.link(360)}. For commercial space, ${h.link(295)} by Godrej Properties and ${h.link(411)} are both under construction.</p>
<h3>Anekal: Sarjapur and the south-east townships</h3>
<p>Prestige Group’s township has three phases on our map: ${h.link(294)}, ${h.link(307)} and ${h.link(308)}. Lodha has ${h.link(344)} and ${h.link(315)}, and ${h.link(298)} by Godrej Properties offers 2 and 3 BHK homes. Other projects include ${h.link(336)}, ${h.link(349)}, ${h.link(380)}, ${h.link(310)}, ${h.link(314)} and ${h.link(321)}.</p>
<h3>Bengaluru South</h3>
<p>Provident Housing’s ${h.link(311)} and ${h.link(291)}, ${h.link(296)} by Brigade Group (due July 2029) and ${h.link(300)} by Casagrand (December 2029) are among the larger projects. ${h.link(374)} offers 3 BHK homes, and Sattva Group has ${h.link(343)} and ${h.link(345)}. ${h.link(339)} and ${h.link(342)} are also on the map.</p>
<h3>Bengaluru North and Yelahanka</h3>
<p>Bhartiya City has four phases of its Nikoo Homes projects: ${h.link(301)}, ${h.link(302)}, ${h.link(292)} and ${h.link(293)}. Around Yelahanka, ${h.link(348)} offers 3 and 3.5 BHK homes due in March 2029, while ${h.link(346)} by Godrej Properties, ${h.link(309)} by Sattva Group and ${h.link(297)} by Lodha are larger, later projects due in 2030–2032.</p>

<h2>Plotted developments</h2>
<p>If you’d rather build your own home, these plotted layouts are registered with K-RERA: ${h.link(347)} in Anekal (due August 2028), ${h.link(333)} in Bengaluru North, ${h.link(363)} in Bengaluru South and ${h.link(409)} in Anekal. Check whether a plot is approved for residential use and has clear title before you pay a token amount.</p>

<h2>How to check a K-RERA number</h2>
<ol>
  <li>Find the registration number on the developer’s brochure, website or ads. In Karnataka it looks like <code>PRM/KA/RERA/1251/446/PR/…</code>.</li>
  <li>Search for it on the official Karnataka RERA website, <strong>rera.karnataka.gov.in</strong>, under registered projects.</li>
  <li>Check that the promoter’s name, project name, address and phase match what you are being sold. Large projects often register each phase separately.</li>
  <li>Note the completion date the developer declared. That is the date you can hold them to, not the one in the sales pitch.</li>
</ol>
<p>The process is similar to Maharashtra’s. Our guide on <a href="/blog/how-to-check-maharera-registration-number">how to check a MahaRERA number</a> explains in more detail what to look for in a RERA registration.</p>

<h2>Checklist before you book in Bengaluru</h2>
<ol>
  <li><strong>Check the khata.</strong> Ask whether the property will have an A-khata or a B-khata. It affects loans, building approvals and resale, so get your lawyer to confirm it.</li>
  <li><strong>Ask about water supply.</strong> In parts of the city, new projects rely on borewells or tankers. Ask how the project will get water and what it costs.</li>
  <li><strong>Check the commute at peak hours.</strong> Traffic on the Outer Ring Road and around Whitefield and Sarjapur can be slow. Open each project on the <a href="/map">live map</a> to see the roads and metro lines around it.</li>
  <li><strong>Compare carpet area</strong> and work out the price per sq ft on carpet area, not on the “3 BHK” label.</li>
  <li><strong>Budget for the extra costs:</strong> stamp duty, registration and GST on under-construction homes. Confirm the current Karnataka rates with your lawyer before you book.</li>
</ol>

<h2>FAQs: New projects in Bengaluru</h2>
<h3>What is the cheapest new project in Bengaluru?</h3>
<p>Among the projects on our map, ${h.link(191)} starts at ₹90 Lacs and ${h.link(304)} in Bengaluru East at ₹97 Lacs. Prices for many other projects aren’t listed yet, so ask the developer for a price sheet.</p>
<h3>Which area of Bengaluru has the most new projects?</h3>
<p>On our map, Bengaluru East (Whitefield and around), Anekal (Sarjapur and the south-east) and Bengaluru South have the most new launches, with more than 20 projects each.</p>
<h3>Which Bengaluru projects can I move into soonest?</h3>
<p>${h.link(355)} (January 2028), ${h.link(313)} and ${h.link(372)} (March 2028) have the earliest possession dates among the projects in this guide.</p>
<h3>Where can I see all Bengaluru projects on a map?</h3>
<p>Open the <a href="/cities/bengaluru">Bengaluru page</a> for the full list, or the <a href="/map">interactive map</a>. Also looking at Mumbai? Read our guide to <a href="/blog/new-projects-in-mumbai-andheri-borivali-south-mumbai">new projects in Mumbai</a>.</p>

<blockquote>Prices, configurations and possession dates are as listed on Mappingg in October 2026 and may change. Always confirm with the developer and on the Karnataka RERA website before you book.</blockquote>
`,
  };
}

function mumbaiArticle(h) {
  return {
    slug: 'new-projects-in-mumbai-andheri-borivali-south-mumbai',
    title: 'New Projects in Mumbai (2026): South Mumbai, Bandra, Khar, Andheri, Borivali & Kurla',
    seo_title: 'New Projects in Mumbai 2026: Prices & MahaRERA',
    seo_description:
      'New residential projects in Mumbai — Worli, Sewri, Sion, Bandra, Khar, Andheri, Borivali & Kurla — with prices, configurations, possession dates and MahaRERA numbers. Studios from ₹70 Lacs.',
    excerpt:
      'Every Mumbai project on our map, from studio homes in Andheri East and family 2–4 BHKs in Sion to sea-facing residences in Worli, Khar and Bandra — sorted by area, with MahaRERA numbers.',
    tags: ['Mumbai', 'Andheri', 'Borivali', 'South Mumbai', 'New Projects'],
    cover: {
      theme: 'dusk',
      kicker: 'City guide',
      lines: ['New Projects in', 'Mumbai', '2026 Buyer’s Guide'],
      stats: [['35+', 'projects tracked'], ['₹70 L', 'studios from'], ['MahaRERA', 'numbers listed']],
      tagline: 'Pune & Mumbai’s live real-estate map',
    },
    content: `
<p>Looking for <strong>new projects in Mumbai</strong>? Land is scarce in Mumbai, so most new homes come from redevelopment of old buildings and mill lands, or from tall towers on small plots. That makes it more important than in most cities to check exactly what you are buying. On the <a href="/cities/mumbai">Mappingg map of Mumbai &amp; MMR</a> we track more than 35 projects inside the city, and most of them show a MahaRERA number. This guide sorts them by area.</p>

<h2>How Mumbai is divided</h2>
<p>MahaRERA lists Mumbai projects by district and taluka, which is how the areas are named on our map:</p>
<ul>
  <li><strong>${h.loc('Mumbai City')}:</strong> the island city, from Colaba and Worli up to Sewri, Dadar and Sion.</li>
  <li><strong>${h.loc('Andheri')}:</strong> the western suburbs from Bandra and Khar to Andheri.</li>
  <li><strong>${h.loc('Borivali')}:</strong> the northern western suburbs, from Goregaon and Malad to Borivali and Dahisar.</li>
  <li><strong>${h.loc('Kurla')}:</strong> the eastern suburbs, including Kurla, Ghatkopar, Chembur and beyond.</li>
</ul>

${h.gallery([137, 139, 140, 141, 142, 145], 'Mumbai')}

<h2>South and Central Mumbai</h2>
<p>The island city has some of the biggest launches on our map. Raymond Realty’s The Address by GS in Sion has five towers registered separately (${h.link(288, 'A')}, ${h.link(280, 'B')}, ${h.link(287, 'C')}, ${h.link(286, 'D')} and ${h.link(279, 'E')}), all with 2, 3 and 4 BHK homes. Lodha has ${h.link(276)} with 3 and 4 BHK homes and ${h.link(277)}. ${h.link(289)} by Rustomjee offers 2 and 3 BHK homes, and ${h.link(278)} by K Raheja Corp and ${h.link(399)} are also under construction.</p>
<p>Bombay Realty’s Three ICC is registered as three separate wings: ${h.link(290)}, ${h.link(285)} and ${h.link(284)}. That’s a good example of why you should check the MahaRERA number for your own wing, not just the project.</p>
${h.table([288, 280, 287, 286, 279, 276, 277, 289, 278, 290, 285, 284, 399], 'New projects in South & Central Mumbai')}

<h2>Bandra, Khar and Andheri</h2>
<p>At the top of the market, ${h.link(195)} by Panchshil Realty in Bandra West offers 4.5 BHK residences at ₹23 Cr, due in December 2028. In Khar West, Platinum Corp’s ${h.link(137)} starts at ₹6 Cr for 2 and 3 BHK homes, and ${h.link(143)} is also under construction. Godrej Properties has two phases of Godrej Bandra Bay (${h.link(275, 'Phase 2')} and ${h.link(274, 'Phase 3')}).</p>
<p>Andheri West has four Platinum Corp projects: ${h.link(139)}, ${h.link(140)}, ${h.link(141)} and ${h.link(142)}. Several offer “Jodi” options, where two adjoining flats are combined into one larger home. For a lower budget, ${h.link(145)} in Andheri East offers studio apartments for about ₹70–80 Lacs, due in December 2028.</p>
${h.table([195, 137, 143, 145, 139, 140, 141, 142], 'Projects in Bandra, Khar & Andheri')}
<p>Other projects in the Andheri taluka include ${h.link(387)} (3 BHK), ${h.link(282)}, ${h.link(400)}, ${h.link(402)} and ${h.link(404)}. ${h.link(281)} and ${h.link(283)} by Lotus Developers are commercial projects.</p>

<h2>Borivali, Malad and Goregaon</h2>
<p>The northern suburbs offer more space for the money. Projects on our map include ${h.link(273)} by Raheja Universal, ${h.link(383)} by Arkade Developers, ${h.link(403)} by Pranav Constructions, ${h.link(405)}, and two HUM Developers projects, ${h.link(406)} and ${h.link(407)}. ${h.link(397)} is a commercial tower.</p>
${h.table([273, 383, 403, 405, 406, 407, 398], 'New projects in the Borivali taluka')}

<h2>Kurla and the eastern suburbs</h2>
<p>${h.link(396)} by Matrix Constructions and ${h.link(401)} are under construction in the Kurla taluka.</p>
${h.table([396, 401], 'New projects in the Kurla taluka')}

<h2>Looking beyond city limits?</h2>
<p>If Mumbai prices are beyond your budget, the wider MMR offers far more space for the money. ${h.link(250)} in Vasai West is an upcoming project with 2, 3 and 4 BHK homes from ₹1.25 Cr to ₹2.25 Cr. Also see our guides to <a href="/blog/new-projects-in-navi-mumbai">new projects in Navi Mumbai</a> and <a href="/blog/new-projects-in-kalyan-dombivli-palava-thane">Kalyan, Dombivli, Palava &amp; Thane</a>.</p>

<h2>Checklist before you book in Mumbai</h2>
<ol>
  <li><strong>Verify the MahaRERA number for your wing or tower.</strong> Large projects register each wing or phase separately. Here’s <a href="/blog/how-to-check-maharera-registration-number">how to check a MahaRERA number</a>.</li>
  <li><strong>For redevelopment projects, read the details.</strong> Ask how many flats go to existing residents and how many are for sale, and check that the society has signed the development agreement.</li>
  <li><strong>Compare carpet area.</strong> Mumbai flats are small and expensive, so the price per sq ft of carpet area matters more than the BHK label.</li>
  <li><strong>Check parking.</strong> Many towers have limited or puzzle parking, which may cost extra.</li>
  <li><strong>Budget for stamp duty.</strong> In Mumbai it is 6% (5% stamp duty plus 1% metro cess), with a 1% concession for women buyers, plus registration and GST on under-construction homes. Our guide to <a href="/blog/stamp-duty-registration-charges-pune">stamp duty and registration charges</a> explains how these costs add up.</li>
</ol>

<h2>FAQs: New projects in Mumbai</h2>
<h3>What is the cheapest new project in Mumbai on Mappingg?</h3>
<p>Among the projects with a listed price, ${h.link(145)} in Andheri East has studio apartments for about ₹70–80 Lacs. Many Mumbai projects don’t list prices on our map yet, so ask the developer for a price sheet.</p>
<h3>What is a Jodi flat?</h3>
<p>A Jodi flat is two adjoining flats sold together so they can be combined into one larger home. Make sure the agreement and the MahaRERA-approved plans allow the combination.</p>
<h3>What do Mumbai MahaRERA numbers starting with PR, PC and PM mean?</h3>
<p>Newer MahaRERA numbers start with PR for residential, PC for commercial and PM for mixed-use projects. For example, ${h.link(281)} (<code>PC1180002602099</code>) is a commercial project.</p>
<h3>Where can I see all Mumbai projects on a map?</h3>
<p>Open the <a href="/cities/mumbai">Mumbai &amp; MMR page</a> for the full list, or the <a href="/map">interactive map</a>.</p>

<blockquote>Prices, configurations and possession dates are as listed on Mappingg in October 2026 and may change. Always confirm with the developer and on MahaRERA before you book.</blockquote>
`,
  };
}

function centralPuneArticle(h) {
  return {
    slug: 'new-projects-in-kothrud-koregaon-park-central-pune',
    title: 'New Projects in Kothrud, Koregaon Park, Kalyani Nagar & Central Pune (2026)',
    seo_title: 'New Projects in Kothrud & Koregaon Park Pune 2026',
    seo_description:
      'New flats in Kothrud, Warje, Koregaon Park, Kalyani Nagar, the old city peths, NIBM & Undri — prices from ₹62 Lacs, BHK options, possession dates and MahaRERA numbers.',
    excerpt:
      'Established Pune neighbourhoods rarely get new projects, so each launch matters. Here are the new homes in Kothrud, Warje, Koregaon Park, Kalyani Nagar, the peths, NIBM and Undri, with prices, possession dates and MahaRERA numbers.',
    tags: ['Kothrud', 'Koregaon Park', 'Kalyani Nagar', 'Pune', 'New Projects'],
    cover: {
      theme: 'ember',
      kicker: 'Locality guide',
      lines: ['New Projects in', 'Kothrud, KP &', 'Central Pune'],
      stats: [['₹62 L', '2 BHK from'], ['2–5 BHK', 'plus shops'], ['2026–31', 'possession']],
    },
    content: `
<p>Most new homes in Pune are coming up on the city’s edges: Hinjewadi, Wagholi, Kharadi and beyond. Buyers who want to stay in <strong>Kothrud, Koregaon Park, Kalyani Nagar or the old city</strong> have far fewer choices, because land in these established areas is scarce and most new supply comes from redevelopment. This guide lists the new projects in these neighbourhoods on <a href="/map">Mappingg’s live map</a>, plus the closest options in South Pune, with prices, possession dates and MahaRERA numbers where the developer has shared them.</p>

<h2>Why buy in an established Pune neighbourhood?</h2>
<ul>
  <li><strong>Everything is already built:</strong> schools, hospitals, markets and roads are in place, so you are not waiting years for the area to develop.</li>
  <li><strong>Metro access:</strong> Kothrud and Kalyani Nagar are both on the Pune Metro’s Aqua Line, which runs from Vanaz to Ramwadi.</li>
  <li><strong>Steady resale demand:</strong> people who grew up in these areas tend to want to stay, which supports resale value.</li>
  <li><strong>The trade-off:</strong> prices per sq ft are higher, plots are smaller and many projects are redevelopments, so you get fewer amenities than in a large suburban township.</li>
</ul>

${h.gallery([209, 161, 164, 38, 194, 146])}

<h2>New projects in Kothrud, Warje and Bhugaon</h2>
<p>Kothrud is West Pune’s best-known family neighbourhood, and most new launches here are by Kundan Spaces and Majestique Landmark. Near ${h.loc('Kothrud', 'Vanaz')}, ${h.link(209)} offers 2, 3 and 4 BHK homes from ₹1.75 Cr to ₹4.15 Cr, due in December 2028, and ${h.link(161)} by Kundan Spaces has 2, 2.5 and 3 BHK homes next to Vanaz Metro Station (price on request). In Dahanukar Colony, ${h.link(159)} lists 3 BHK homes of 1,115 sq ft at ₹2.7 Cr, 3.5 BHK homes at ₹3.7 Cr and 4 BHK homes at ₹4.9 Cr, with retail shops from ₹1.2 Cr. ${h.link(160)}, also in Dahanukar Colony, combines high-street shops with 3, 3.5 and 4 BHK homes from ₹2.70 Cr.</p>
<p>For a lower budget, look just beyond Kothrud. ${h.link(266)} in Bhugaon, off Paud Road, offers 2, 3 and 4 bedroom homes from ₹82 Lacs to ₹1.6 Cr, due in 2028 (MahaRERA <code>P52100078709</code>). Near Chandani Chowk in ${h.loc('Warje')}, ${h.link(214)} offers 2 BHK homes from ₹1.10 Cr to ₹1.64 Cr, due in December 2028.</p>
${h.table([209, 161, 159, 160, 266, 214], 'New projects in Kothrud, Warje & Bhugaon')}
<p>For shops and offices, ${h.link(220)} in Vanaz has units from ₹1.8 Cr, due in June 2027. In ${h.loc('Aundh')}, ${h.link(181)} by ASAP Spaces offers 4.5 BHK residences from ₹4.80 Cr, due in November 2026.</p>

<h2>New projects in Koregaon Park and Kalyani Nagar</h2>
<p>Koregaon Park and Kalyani Nagar are East Pune’s premium addresses, close to the airport, Kharadi’s offices and the city’s best-known restaurants. Most new homes here are large 3, 4 and 5 BHK apartments. The exception is ${h.link(164)} by Kundan Spaces in Koregaon Park NX, near Ghorpadi, which offers 2, 3 and Jodi 4 BHK homes from ₹1.20 Cr and is nearing possession.</p>
<p>In ${h.loc('Koregaon Park')}, ${h.link(118)} on Lane 5 offers 3, 3.5 and 4.5 BHK homes from ₹4.59 Cr (December 2028), and ${h.link(38)} on North Main Road in the KP Annexe offers 3, 4 and 5 BHK homes from ₹3.86 Cr (June 2029). In ${h.loc('Kalyani Nagar')}, ${h.link(194)} has 3 and 4 BHK homes from ₹3.58 Cr to ₹4.33 Cr (September 2028), and ${h.link(103)} has 3, 4 and 5 BHK homes from ₹4.25 Cr (December 2030). Next door in ${h.loc('Viman Nagar')}, ${h.link(136)} offers 3.5 and 4.5 BHK homes from ₹3.72 Cr.</p>
${h.table([164, 118, 38, 194, 103, 136], 'New projects in Koregaon Park, Kalyani Nagar & Viman Nagar')}
<p>At the very top of the market, ${h.link(197)} in Kalyani Nagar is ready to move, from ₹15.58 Cr. Our guide to <a href="/blog/luxury-flats-villas-in-pune">luxury flats and villas in Pune</a> covers more homes above ₹3 Cr.</p>

<h2>New projects in the old city: Sadashiv Peth and Mangalwar Peth</h2>
<p>In the peths, new homes almost always come from redeveloping old wadas and buildings. ${h.link(146)} by Naiknavare Developers in ${h.loc('Sadashiv Peth')} is a mixed-use project with shops, offices and 2, 3 and 4 BHK homes from ₹1.09 Cr, due in December 2029. In ${h.loc('Mangalwar Peth')}, ${h.link(168)} by Birla Estate offers 2, 3 and 4 BHK homes from ₹1.73 Cr, due in September 2031 (MahaRERA <code>PR1262022501044</code>).</p>
${h.table([146, 168], 'New projects in the old city')}
<p>For retail, ${h.link(254)} in Sadashiv Peth has showrooms and offices from ₹84 Lacs and ${h.link(158)} on Laxmi Road has premium shops and showrooms. Our guide to <a href="/blog/commercial-property-office-space-in-pune">commercial property in Pune</a> covers them in more detail.</p>

<h2>South Pune: NIBM and Undri</h2>
<p>If central Pune is beyond your budget, NIBM and Undri offer the lowest prices in this guide while staying close to Camp and Kondhwa. ${h.link(211)} at Undri Chowk has 2 and 3 BHK homes from ₹62 Lacs to ₹82 Lacs, due in December 2027. In ${h.loc('NIBM')}, ${h.link(235)} offers 2 and 3 BHK homes from ₹90 Lacs to ₹1.4 Cr, due in December 2026 (MahaRERA <code>PM1260002501030</code>), and ${h.link(109)} by VTP Group has shops and showrooms.</p>
${h.table([211, 235], 'New projects in NIBM & Undri')}
<p>Our guide to <a href="/blog/flats-under-1-crore-in-pune">flats under ₹1 crore in Pune</a> lists more options at this budget across the city.</p>

<h2>Checklist for buying in an established neighbourhood</h2>
<ol>
  <li><strong>For redevelopment projects, check the society’s consent.</strong> Ask whether the existing residents have signed the development agreement and how many flats go to them versus how many are for sale.</li>
  <li><strong>Verify the MahaRERA number for your wing.</strong> Here’s <a href="/blog/how-to-check-maharera-registration-number">how to check a MahaRERA number</a>.</li>
  <li><strong>Check parking.</strong> Small plots often mean stack or puzzle parking, which may cost extra.</li>
  <li><strong>Compare carpet area.</strong> Prices per sq ft are high here, so a 100 sq ft difference can mean ₹15–25 Lacs.</li>
  <li><strong>Check the documents.</strong> Our guide to the <a href="/blog/documents-to-check-before-buying-flat-pune">documents to check before buying a flat in Pune</a> covers the approvals, title and RERA papers to ask for.</li>
</ol>

<h2>FAQs: New projects in central Pune</h2>
<h3>What is the cheapest new project in Kothrud?</h3>
<p>Among the projects on our map, ${h.link(266)} in Bhugaon, off Paud Road, starts at ₹82 Lacs. Inside Kothrud itself, ${h.link(209)} near Vanaz starts at ₹1.75 Cr.</p>
<h3>Are there 2 BHK flats in Koregaon Park?</h3>
<p>Yes, but few. ${h.link(164)} in Koregaon Park NX offers 2 BHK homes from ₹1.20 Cr. Most other new projects in Koregaon Park and Kalyani Nagar are 3 BHK and larger, starting above ₹3.5 Cr.</p>
<h3>Which projects in this guide are closest to possession?</h3>
<p>${h.link(164)} is nearing possession, ${h.link(181)} in Aundh is due in November 2026 and ${h.link(235)} in NIBM in December 2026. Looking for a home you can move into now? Browse <a href="/status/ready-to-move">ready-to-move projects</a>.</p>
<h3>Where can I see all these projects on a map?</h3>
<p>Open the <a href="/map">interactive map</a>, or browse by area: ${h.loc('Kothrud')}, ${h.loc('Koregaon Park')}, ${h.loc('Kalyani Nagar')}, ${h.loc('NIBM')} and ${h.loc('Undri')}. Comparing more localities? Read our guide to the <a href="/blog/best-areas-to-buy-property-in-pune">best areas to buy property in Pune</a>.</p>

<blockquote>Prices, configurations and possession dates are as listed on Mappingg in October 2026. Developers may change them at any time, so always confirm with the developer and on MahaRERA before you book.</blockquote>
`,
  };
}

function documentsArticle(h) {
  return {
    slug: 'documents-to-check-before-buying-flat-pune',
    title: 'Documents to Check Before Buying a Flat in Pune (2026 Checklist)',
    seo_title: 'Documents to Check Before Buying a Flat in Pune',
    seo_description:
      'The complete document checklist for buying a flat in Pune — MahaRERA registration, title search, 7/12 extract, commencement & occupancy certificates, agreement for sale and resale papers.',
    excerpt:
      'Before you pay for a flat in Pune, ask for these documents: the MahaRERA registration, title search, land records, building approvals, occupancy certificate and, for resale flats, the society papers. Here is what each one proves.',
    tags: ['Home Buying Guide', 'Property Documents', 'Pune', 'MahaRERA', 'Maharashtra'],
    cover: {
      theme: 'slate',
      kicker: 'Buyer’s guide',
      lines: ['Documents to Check', 'Before Buying a', 'Flat in Pune'],
      stats: [['12', 'key documents'], ['30 yrs', 'title search'], ['OC', 'before you move in']],
    },
    content: `
<p>A flat is usually the most expensive thing you will ever buy, and most problems that buyers in Pune face later (delays, title disputes, no water connection, trouble getting a loan or reselling) can be spotted early in the paperwork. This checklist explains <strong>which documents to check before buying a flat in Pune</strong>, what each one proves and where to get it. Most of it applies across Maharashtra.</p>

<h2>Quick checklist</h2>
<div class="table-scroll"><table>
<caption>Documents to ask for when buying a flat in Pune</caption>
<thead><tr><th>Document</th><th>What it proves</th><th>New flat</th><th>Resale flat</th></tr></thead>
<tbody>
<tr><td>MahaRERA registration</td><td>The project is registered and has a committed completion date</td><td>Yes</td><td>If still under construction</td></tr>
<tr><td>Title search report</td><td>The seller has clear ownership of the land and flat</td><td>Yes</td><td>Yes</td></tr>
<tr><td>7/12 extract or property card</td><td>Who owns the land, as per government land records</td><td>Yes</td><td>Yes</td></tr>
<tr><td>Development agreement &amp; power of attorney</td><td>The developer has the landowner’s permission to build and sell</td><td>Yes</td><td>—</td></tr>
<tr><td>Approved building plan</td><td>The building and your flat were sanctioned by the planning authority</td><td>Yes</td><td>Yes</td></tr>
<tr><td>Commencement certificate (CC)</td><td>Construction was allowed to start, and up to which floor</td><td>Yes</td><td>—</td></tr>
<tr><td>Occupancy certificate (OC)</td><td>The building is complete as approved and fit to live in</td><td>At possession</td><td>Yes</td></tr>
<tr><td>Bank NOC / mortgage details</td><td>Any loan on the project or flat won’t affect your unit</td><td>If mortgaged</td><td>If on loan</td></tr>
<tr><td>Allotment letter &amp; agreement for sale</td><td>Your flat, price, payment plan and possession date</td><td>Yes</td><td>Yes</td></tr>
<tr><td>Index II</td><td>The sale agreement was registered with the sub-registrar</td><td>After registration</td><td>For every past sale</td></tr>
<tr><td>Society share certificate &amp; NOC</td><td>The seller is a society member and the society has no objection</td><td>—</td><td>Yes</td></tr>
<tr><td>Tax, electricity &amp; maintenance receipts</td><td>No unpaid dues pass to you</td><td>—</td><td>Yes</td></tr>
</tbody></table></div>

<h2>1. MahaRERA registration</h2>
<p>For any under-construction project, start here. Under RERA, a project that must be registered cannot be advertised, booked or sold until it has a MahaRERA number. The MahaRERA website also shows the promoter, the approved plans, the registered carpet areas and the completion date the developer has committed to. Here’s <a href="/blog/how-to-check-maharera-registration-number">how to check a MahaRERA number</a> step by step. Mappingg shows the number on each <a href="/projects">project page</a> wherever the developer has shared it.</p>

<h2>2. Title search report</h2>
<p>A lawyer searches the records at the sub-registrar’s office, usually going back 30 years, to trace who has owned the land and whether it has been mortgaged, sold twice or is under dispute. The result is a title search report and title certificate. Many developers share one from their own lawyer. For a large purchase it is worth paying your own lawyer to check it independently. Banks also run their own legal check before approving a home loan on a project.</p>

<h2>3. Land records: 7/12 extract or property card</h2>
<p>The <strong>7/12 extract</strong> (saat-baara utara) records who owns a piece of land and what it is used for. It is the main land record for land outside city survey limits, which covers much of the land on Pune’s edges. Inside older city areas, the equivalent is the <strong>property card</strong>. Both can be checked online on the Maharashtra government’s land records portal. Check that the owner’s name matches the landowner in the development agreement, and look for any loans or court cases noted on it.</p>
<p>If the land was once agricultural, ask for the <strong>non-agricultural (NA) order</strong> or proof that the land is treated as non-agricultural under the current rules, so that it can legally be used for housing.</p>

<h2>4. Development agreement and power of attorney</h2>
<p>In many Pune projects, the developer does not own the land. Instead, the landowner signs a development agreement and a power of attorney that let the developer build and sell flats. Check that these are registered, that they cover your building and that the developer is allowed to sell your flat (some flats may be reserved for the landowner).</p>

<h2>5. Approved building plan and commencement certificate</h2>
<p>The planning authority approves the building plan and issues a <strong>commencement certificate (CC)</strong> before work can start. In Pune that is the PMC or PCMC inside city limits, and PMRDA for most of the surrounding region. A CC may cover only some floors at first, so check that it covers the floor you are buying. Compare your flat’s layout and carpet area with the approved plan, not just the brochure.</p>

<h2>6. Occupancy certificate (OC)</h2>
<p>The <strong>occupancy certificate</strong> confirms the building was completed as approved and is fit to live in. Without it, you may struggle to get permanent water and electricity connections, a home loan or a buyer when you sell. For a ready-to-move flat, ask to see the OC before you pay. For an under-construction flat, the OC should be in place when you take possession. Our guide to <a href="/blog/ready-to-move-vs-under-construction-flats-pune">ready-to-move vs under-construction flats</a> explains why it matters when you compare the two.</p>

<h2>7. Bank NOC and mortgage details</h2>
<p>Developers often take construction loans against the land or the project. That is normal, but you should know about it. Ask whether the project is mortgaged and, if so, for an NOC from the lender confirming it has no objection to your flat being sold. For a resale flat with a home loan, the seller’s bank must release the original documents and give a letter confirming the loan is closed.</p>

<h2>8. Allotment letter and agreement for sale</h2>
<p>The allotment letter confirms your flat number, price and payment plan. Under RERA, a developer cannot take more than 10% of the price before signing a <strong>registered agreement for sale</strong>. The agreement should list the carpet area, the price, the payment schedule, the possession date, the amenities and the penalty if the developer is late. Read it before you sign, and make sure stamp duty is paid on it. Our guide to <a href="/blog/stamp-duty-registration-charges-pune">stamp duty and registration charges in Pune</a> explains the costs.</p>

<h2>9. Index II</h2>
<p>Once a sale agreement is registered, the sub-registrar records it, and the extract of that record is called <strong>Index II</strong>. Keep yours safe. For a resale flat, ask for the Index II of every earlier sale, so you can confirm the chain of ownership is complete and registered.</p>

<h2>Extra documents for a resale flat</h2>
<ul>
  <li><strong>The full chain of agreements</strong>, from the original sale by the developer to the current owner.</li>
  <li><strong>Society share certificate</strong> in the seller’s name, and an <strong>NOC from the society</strong> for the sale.</li>
  <li><strong>Conveyance deed:</strong> check whether the developer has transferred the land and building to the society. If not, the society may need to apply for deemed conveyance.</li>
  <li><strong>Property tax, electricity and maintenance receipts</strong> up to date, plus a letter from the society confirming no dues.</li>
  <li><strong>OC and approved plan</strong>, to confirm the flat hasn’t been altered or extended illegally.</li>
</ul>

<h2>Red flags</h2>
<ul>
  <li>The developer won’t share the title report, approvals or MahaRERA number, or says they are “in process” when asking you to pay.</li>
  <li>The name on the 7/12 extract or property card doesn’t match the landowner or developer.</li>
  <li>The CC doesn’t cover your floor, or the flat on offer isn’t in the approved plan.</li>
  <li>A ready-to-move flat with no OC.</li>
  <li>Requests to pay in cash, or to an individual instead of the developer’s project account.</li>
</ul>

<h2>Shortlisting projects?</h2>
<p>Use the <a href="/map">live map</a> to compare projects by location, price and possession date, and see the MahaRERA number on each project page. If you need a home soon, browse <a href="/status/ready-to-move">ready-to-move projects</a>, where you can ask to see the OC straight away. Projects nearing possession, such as ${h.link(164)} in Koregaon Park NX, should be close to getting theirs. Planning the money side too? Read our guide to <a href="/blog/home-loan-emi-eligibility-pune">home loan EMI and eligibility</a>.</p>

<h2>FAQs: Property documents in Pune</h2>
<h3>Can I buy a flat without an occupancy certificate?</h3>
<p>You can sign the agreement while a project is under construction, but don’t take possession of or pay the final amount for a completed flat until the OC is issued. Without it you may face problems with utilities, loans and resale.</p>
<h3>How many years should a title search cover?</h3>
<p>Lawyers and banks usually check at least 30 years of records.</p>
<h3>Where can I check the 7/12 extract and property card?</h3>
<p>On the Maharashtra government’s land records portal (Mahabhumi). You can view them online and download digitally signed copies for a small fee.</p>
<h3>Does a home loan approval mean the documents are fine?</h3>
<p>It is a good sign, because the bank runs its own legal and technical check. But the bank is protecting its loan, not you, so still have the key documents checked by your own lawyer.</p>

<blockquote>This guide is general information, not legal advice. Rules and procedures change, so for a specific purchase have the documents checked by a property lawyer and verify project details on the official MahaRERA website.</blockquote>
`,
  };
}

function carpetAreaArticle() {
  return {
    slug: 'carpet-area-vs-built-up-vs-super-built-up-area',
    title: 'Carpet Area vs Built-up vs Super Built-up Area: What You Actually Pay For (RERA Guide)',
    seo_title: 'Carpet Area vs Built-up vs Super Built-up Area (RERA)',
    seo_description:
      'What carpet, built-up and super built-up area mean under RERA, how loading works, and how to compare flats by price per sq ft of carpet area.',
    excerpt:
      'A flat sold as 1,050 sq ft may have only 700 sq ft of usable floor. Here is what carpet, built-up and super built-up area mean under RERA, and how to compare two flats fairly.',
    tags: ['Carpet Area', 'RERA', 'Home Buying Guide', 'Pune', 'Price per sq ft'],
    cover: {
      theme: 'metro',
      kicker: 'Buyer’s guide',
      lines: ['Carpet vs', 'Built-up vs', 'Super Built-up'],
      stats: [['Sec 2(k)', 'RERA definition'], ['10.764', 'sq ft per sq m'], ['±3%', 'allowed variation']],
    },
    content: `
<p>Two flats can be advertised at the same size and still have very different amounts of floor you can actually use. The difference is in which “area” the number refers to: <strong>carpet</strong>, <strong>built-up</strong> or <strong>super built-up</strong>. Since RERA, the carpet area is the figure that counts. This guide explains each term, how “loading” inflates the advertised size, and how to compare flats fairly.</p>

<h2>Carpet area: the floor you can use</h2>
<p>The Real Estate (Regulation and Development) Act, 2016 defines carpet area in <strong>Section 2(k)</strong> as the <em>net usable floor area of an apartment</em>. It:</p>
<ul>
  <li><strong>includes</strong> the area under the internal partition walls of the flat;</li>
  <li><strong>excludes</strong> the external walls, the area under service shafts, and your exclusive balcony, verandah and open terrace.</li>
</ul>
<p>Under RERA, flats are sold on the basis of carpet area, and the carpet area must be stated in the agreement for sale. That is why MahaRERA project pages and agreements show it, usually in square metres.</p>

<h2>Built-up area</h2>
<p>Built-up area is the carpet area <strong>plus</strong> the thickness of the external walls and, as most developers use the term, the balconies and dry areas that belong to your flat. It is not defined in the RERA Act, so different developers count it differently. As a rough guide, it is often 10–20% more than the carpet area.</p>

<h2>Super built-up area (saleable area)</h2>
<p>Super built-up area adds your share of the <strong>common areas</strong> to the built-up area: lobbies, staircases, lift wells, corridors, and sometimes the clubhouse, gym or other amenities. The share of common area added is called <strong>loading</strong>. Before RERA, many flats were priced on super built-up area, which made a flat look larger and the rate per sq ft look lower.</p>

<div class="table-scroll"><table>
<caption>The three areas at a glance</caption>
<thead><tr><th></th><th>Carpet area</th><th>Built-up area</th><th>Super built-up area</th></tr></thead>
<tbody>
<tr><td>What it covers</td><td>Usable floor inside the flat, including internal walls</td><td>Carpet + external walls + your balconies and dry areas</td><td>Built-up + your share of common areas</td></tr>
<tr><td>Defined in the RERA Act?</td><td>Yes, Section 2(k)</td><td>No</td><td>No</td></tr>
<tr><td>Typical size vs carpet</td><td>—</td><td>Often 10–20% more</td><td>Often 30–50% more</td></tr>
</tbody></table></div>
<p>The percentages are typical ranges, not rules. Always ask for the exact carpet area of the flat you are buying.</p>

<h2>Worked example: the same flat, three prices per sq ft</h2>
<p>Take a 2 BHK priced at ₹1 crore, with a RERA carpet area of 700 sq ft. The brochure calls it a 1,050 sq ft flat (super built-up).</p>
<div class="table-scroll"><table>
<caption>One ₹1 crore flat, measured two ways</caption>
<thead><tr><th>Area used</th><th>Size</th><th>Price per sq ft</th></tr></thead>
<tbody>
<tr><td>Super built-up</td><td>1,050 sq ft</td><td>₹9,524</td></tr>
<tr><td>RERA carpet</td><td>700 sq ft</td><td>₹14,286</td></tr>
</tbody></table></div>
<p>The loading here is 50% (1,050 ÷ 700 = 1.5). The flat is no cheaper because its advertised rate is lower; it is the same flat. Only the price per sq ft of <strong>carpet</strong> area tells you what you pay for usable space.</p>

<h2>How to compare two flats fairly</h2>
<p>Divide the all-inclusive price by the RERA carpet area. For example:</p>
<div class="table-scroll"><table>
<caption>Comparing two flats by carpet area</caption>
<thead><tr><th>Flat</th><th>Price</th><th>RERA carpet area</th><th>Price per sq ft of carpet</th></tr></thead>
<tbody>
<tr><td>Flat A</td><td>₹95 Lacs</td><td>650 sq ft</td><td>₹14,615</td></tr>
<tr><td>Flat B</td><td>₹1.02 crore</td><td>720 sq ft</td><td>₹14,167</td></tr>
</tbody></table></div>
<p>Flat B costs more in total but less for every square foot you can use. Check that both prices include the same things (parking, floor rise, club membership, GST), or the comparison won’t be fair. Our guide to <a href="/blog/stamp-duty-registration-charges-pune">stamp duty and hidden costs</a> lists what to ask for.</p>

<h2>Balconies, terraces and “usable carpet”</h2>
<p>Some brochures quote a “usable carpet” or “carpet + balcony” figure. Balconies and terraces are useful space, but under RERA they are not part of the carpet area. If a developer shows them, make sure they are listed separately, and compare flats on the RERA carpet area alone.</p>

<h2>Square metres and square feet</h2>
<p>MahaRERA documents usually give areas in square metres. <strong>1 sq m = 10.764 sq ft</strong>, so a carpet area of 65 sq m is about 700 sq ft.</p>

<h2>What if the flat turns out smaller?</h2>
<p>MahaRERA’s model agreement for sale allows the final carpet area to vary by up to 3% from the agreed figure. If it is smaller by more than that, the developer has to refund the excess amount paid for the missing area; if it is larger, the developer can ask for payment only within the limit set in the agreement. Read this clause in your agreement before you sign it, and measure the flat at possession.</p>

<h2>Checklist before you book</h2>
<ol>
  <li>Ask for the <strong>RERA carpet area</strong> of the specific flat, in writing.</li>
  <li>Check it against the project’s MahaRERA page. Our guide shows <a href="/blog/how-to-check-maharera-registration-number">how to find it</a>.</li>
  <li>Get balconies, terraces and parking listed separately from the carpet area.</li>
  <li>Compare projects by <strong>all-inclusive price ÷ carpet area</strong>.</li>
  <li>Read the area-variation clause in the agreement.</li>
</ol>
<p>Shortlisting? Compare projects by location, price and possession date on the <a href="/map">live map</a>, or start with <a href="/blog/2-bhk-flats-in-pune">2 BHK</a> and <a href="/blog/3-bhk-flats-in-pune">3 BHK flats in Pune</a>.</p>

<h2>FAQs</h2>
<h3>Is the price of a flat based on carpet area under RERA?</h3>
<p>Yes. Under RERA, flats are sold on the basis of carpet area, and the agreement for sale must state it.</p>
<h3>Is a balcony included in carpet area?</h3>
<p>No. Section 2(k) of the RERA Act excludes exclusive balconies, verandahs and open terraces from the carpet area.</p>
<h3>What is a normal loading percentage?</h3>
<p>It varies by project. Super built-up area is often 30–50% more than the carpet area; projects with large amenities tend to have higher loading.</p>
<h3>How do I convert square metres to square feet?</h3>
<p>Multiply by 10.764. For example, 60 sq m × 10.764 = about 646 sq ft.</p>

<blockquote>This guide is general information, not legal advice. Check the carpet area and the terms of your agreement with the developer and a property lawyer before you book.</blockquote>
`,
  };
}

function possessionDelayArticle() {
  return {
    slug: 'possession-delay-rera-buyer-rights-maharera-complaint',
    title: 'Possession Delayed? Your Rights Under RERA and How to File a MahaRERA Complaint',
    seo_title: 'Flat Possession Delayed? RERA Rights & MahaRERA Complaint',
    seo_description:
      'Possession delayed? RERA Section 18 lets you take a refund with interest or claim interest for each month of delay. How it works and how to file on MahaRERA.',
    excerpt:
      'When the possession date in your agreement passes, RERA gives you a choice: leave the project with a refund and interest, or stay and get interest for every month of delay. Here is how it works in Maharashtra.',
    tags: ['RERA', 'MahaRERA', 'Possession Delay', 'Home Buyer Rights', 'Maharashtra'],
    cover: {
      theme: 'mint',
      kicker: 'Buyer’s rights',
      lines: ['Possession', 'Delayed? Your', 'RERA Rights'],
      stats: [['Sec 18', 'refund or interest'], ['MCLR+2%', 'interest rate'], ['5 yrs', 'defect liability']],
    },
    content: `
<p>An under-construction flat comes with a promised possession date. When that date passes, many buyers don’t know what they can do. The Real Estate (Regulation and Development) Act, 2016 (RERA) gives you clear rights, and in Maharashtra you can enforce them through MahaRERA. This guide explains them in plain language.</p>

<h2>Which date counts?</h2>
<p>Your rights are counted from the <strong>possession date in your registered agreement for sale</strong>. The developer may show a later “revised completion date” on the MahaRERA project page; that does not, by itself, change the date you agreed to. Keep a copy of the agreement and every payment receipt.</p>

<h2>Your two options under Section 18</h2>
<p>If the developer fails to complete the project or hand over possession by the agreed date, <strong>Section 18</strong> of the RERA Act lets you choose:</p>
<div class="table-scroll"><table>
<caption>What Section 18 gives you</caption>
<thead><tr><th>If you…</th><th>You are entitled to</th></tr></thead>
<tbody>
<tr><td>Withdraw from the project</td><td>A refund of the amount you paid, with interest at the prescribed rate, plus compensation</td></tr>
<tr><td>Stay in the project</td><td>Interest for every month of delay, until you are given possession</td></tr>
</tbody></table></div>
<p>Compensation is decided separately by MahaRERA’s adjudicating officer, based on the loss you can show.</p>

<h2>How much interest?</h2>
<p>In Maharashtra, the MahaRERA rules set the interest rate at the <strong>State Bank of India’s highest marginal cost of lending rate (MCLR) plus 2%</strong>. The same rate applies whether the developer pays you or you pay the developer late, so check the current SBI MCLR when you work out a claim.</p>

<h2>Other protections worth knowing</h2>
<ul>
  <li><strong>10% advance limit (Section 13):</strong> a developer cannot take more than 10% of the flat’s cost as an advance or application fee before a registered agreement for sale is signed.</li>
  <li><strong>Separate project account (Section 4):</strong> 70% of the money collected from buyers must be kept in a separate bank account and used only for that project’s land and construction.</li>
  <li><strong>Quarterly updates (Section 11):</strong> the developer must update the project’s progress on its MahaRERA page every quarter. Checking it regularly gives you early warning of a delay.</li>
  <li><strong>Five years of defect liability (Section 14):</strong> if you find a structural defect, or a defect in workmanship, quality or services, within five years of possession, the developer must fix it within 30 days at no charge. If they don’t, you can claim compensation.</li>
</ul>

<h2>Step by step: what to do when possession is late</h2>
<ol>
  <li><strong>Check the project’s MahaRERA page.</strong> Look at the quarterly progress, the revised completion date and any extension. Our guide shows <a href="/blog/how-to-check-maharera-registration-number">how to find a project on MahaRERA</a>.</li>
  <li><strong>Write to the developer.</strong> Ask, by email or letter, for the expected possession date and the delay interest due under Section 18. Keep copies of everything.</li>
  <li><strong>Decide: stay or exit.</strong> Staying means interest until possession; exiting means a refund with interest. Think about how far along the project is and how much you have paid.</li>
  <li><strong>Try conciliation.</strong> MahaRERA runs a conciliation and dispute resolution forum where buyers and developers can settle without a full hearing.</li>
  <li><strong>File a complaint.</strong> If that fails, file a complaint online on the MahaRERA website under Section 31, with your agreement, payment receipts and correspondence. Claims for compensation go to the adjudicating officer.</li>
  <li><strong>Appeal if needed.</strong> An order of MahaRERA can be appealed to the Maharashtra Real Estate Appellate Tribunal, generally within 60 days.</li>
</ol>

<h2>Before you book: how to lower the risk of delay</h2>
<ul>
  <li>Check the developer’s record on their earlier projects: were they delivered on time, and do any show long extensions?</li>
  <li>Compare the possession date in the agreement with the completion date on MahaRERA.</li>
  <li>Prefer a construction-linked payment plan, so your payments follow actual progress.</li>
  <li>Look at a <a href="/status/ready-to-move">ready-to-move flat</a> if you need a home by a fixed date. Our guide to <a href="/blog/ready-to-move-vs-under-construction-flats-pune">ready-to-move vs under-construction flats</a> weighs up the choice.</li>
  <li>Have the documents checked before you pay. See our list of <a href="/blog/documents-to-check-before-buying-flat-pune">documents to check before buying a flat</a>.</li>
</ul>

<h2>FAQs</h2>
<h3>Can I get a full refund if possession is delayed?</h3>
<p>Under Section 18, if you choose to withdraw, you are entitled to a refund of the amount paid with interest at the prescribed rate, plus compensation as decided by the adjudicating officer.</p>
<h3>Do I lose my rights if I stay in the project?</h3>
<p>No. If you stay, you are entitled to interest for every month of delay until possession.</p>
<h3>What interest rate applies in Maharashtra?</h3>
<p>SBI’s highest marginal cost of lending rate (MCLR) plus 2%, under the MahaRERA rules.</p>
<h3>Do I need a lawyer to file a MahaRERA complaint?</h3>
<p>You can file the complaint online yourself, but a lawyer can help with large claims, compensation and hearings.</p>

<blockquote>This guide is general information, not legal advice. Rules, rates and procedures change, and every case depends on its agreement and facts. For a claim, speak to a property lawyer and check the current procedure on the official MahaRERA website.</blockquote>
`,
  };
}

function siteVisitArticle() {
  return {
    slug: 'site-visit-checklist-before-buying-flat-pune',
    title: 'Site Visit Checklist: 25 Things to Check Before You Book a Flat in Pune',
    seo_title: 'Site Visit Checklist Before Buying a Flat in Pune',
    seo_description:
      'What to check on a site visit before booking a flat: the approach road, construction progress, the sample flat, water, parking, sunlight and the cost sheet.',
    excerpt:
      'A sample flat is built to impress. Here is what to check on the site itself, from the road you will drive every day to the water supply, so the flat you book matches the one you were shown.',
    tags: ['Site Visit', 'Home Buying Guide', 'Pune', 'Checklist', 'Under Construction'],
    cover: {
      theme: 'morning',
      kicker: 'Buyer’s checklist',
      lines: ['Site Visit', 'Checklist Before', 'You Book'],
      stats: [['25', 'things to check'], ['2 visits', 'peak + off-peak'], ['In writing', 'cost sheet']],
    },
    content: `
<p>Most buyers decide on a flat after one or two site visits. On those visits you are usually shown the sales office and a furnished sample flat, both designed to look their best. This checklist covers what to look at beyond them, so you can judge the project, the location and the deal before you pay a booking amount.</p>

<h2>Before you go</h2>
<ol>
  <li><strong>Check the RERA registration.</strong> Find the project on MahaRERA and note its registration number, promised completion date and the latest quarterly progress update. Our guide shows <a href="/blog/how-to-check-maharera-registration-number">how to check a MahaRERA number</a>.</li>
  <li><strong>Shortlist on the map.</strong> Look at the project’s location, nearby schools, hospitals and metro stations, and other projects around it on the <a href="/map">live map</a>.</li>
  <li><strong>Ask for the carpet area and price in advance.</strong> Get the RERA carpet area of the flats you are interested in and the all-inclusive price, so the visit is about checking, not just listening. See <a href="/blog/carpet-area-vs-built-up-vs-super-built-up-area">carpet vs built-up vs super built-up area</a>.</li>
  <li><strong>Plan two visits.</strong> One on a weekday at peak hours, one on a weekend. Traffic, noise and the feel of the area change a lot between the two.</li>
</ol>

<h2>On the way: the location</h2>
<ol start="5">
  <li><strong>Drive your daily route.</strong> Time the trip from the site to your office, your children’s school and the nearest main road at the hour you would actually travel.</li>
  <li><strong>Look at the last kilometre.</strong> Is the approach road paved, wide enough for two cars and lit at night? A narrow internal road can matter more than distance from the highway.</li>
  <li><strong>Notice what is next door.</strong> Open land nearby may be built on later. Check for nallahs, low-lying ground (ask how it fared in the last monsoon), highways, railway lines, industrial units and the airport flight path, particularly around Lohegaon.</li>
  <li><strong>Check daily needs.</strong> Groceries, a pharmacy, a hospital and public transport within a short distance make a big difference to life after possession.</li>
</ol>

<h2>At the site: construction and quality</h2>
<ol start="9">
  <li><strong>Compare progress with the paperwork.</strong> If MahaRERA says the slabs are complete up to the 12th floor, you should see that on site. A large gap is an early warning of delay.</li>
  <li><strong>Look at the work, not just the finished lobby.</strong> Ask to see an under-construction floor. Check the quality of plaster, wall lines and how the site is kept. A tidy, safe site usually reflects a well-run project.</li>
  <li><strong>See the tower and floor you would buy.</strong> Your flat’s view, light and noise depend on the exact tower, floor and direction it faces. Ask to stand on that floor, or the closest one that is built.</li>
  <li><strong>Check sunlight and ventilation.</strong> Note which direction the living room and bedrooms face, and whether the windows open onto another tower a few metres away.</li>
  <li><strong>Ask about the building materials and fittings.</strong> Get the brands and specifications for flooring, windows, doors, plumbing and electrical fittings in writing, as part of the agreement.</li>
</ol>

<h2>The sample flat</h2>
<ol start="14">
  <li><strong>Ask what is not included.</strong> Sample flats often show false ceilings, wardrobes, modular kitchens, premium flooring and lighting that come at extra cost or not at all.</li>
  <li><strong>Measure it.</strong> Carry a measuring tape, or use your phone. Compare the room sizes with the floor plan of the flat you would buy. Sample flats sometimes use smaller furniture or remove internal walls to feel larger.</li>
  <li><strong>Check the actual layout.</strong> Your flat may be a mirror image, or a different unit type, from the sample. Confirm the exact unit number and its plan.</li>
</ol>

<h2>Water, power and parking</h2>
<ol start="17">
  <li><strong>Ask where the water will come from.</strong> Municipal supply, borewell or tankers? Many newer areas around Pune depend on tankers for years after possession, which adds to maintenance.</li>
  <li><strong>Ask about power backup.</strong> Is backup for lifts, common areas and your flat included, and up to what load?</li>
  <li><strong>Get parking in writing.</strong> Is the parking covered or open, and is a specific slot allotted? Check that the ramps and turning space suit the car you drive.</li>
  <li><strong>Check the amenities’ status.</strong> Find out which amenities, like the clubhouse or pool, are built and which are planned for a later phase, and when.</li>
</ol>

<h2>Questions for the sales team</h2>
<ol start="21">
  <li>What is the possession date in the agreement, and what is the completion date on MahaRERA?</li>
  <li>Which approvals are in place, and which are pending? (See our list of <a href="/blog/documents-to-check-before-buying-flat-pune">documents to check before buying a flat</a>.)</li>
  <li>What is the payment plan, and is it linked to construction stages?</li>
  <li>What will the monthly maintenance be, and how much is collected in advance?</li>
  <li>Can I have the full <strong>cost sheet</strong> in writing, including GST, parking, floor rise, club membership, maintenance deposit, stamp duty and registration? Our guide to <a href="/blog/stamp-duty-registration-charges-pune">stamp duty and hidden costs</a> lists what to look for.</li>
</ol>

<h2>After the visit</h2>
<p>Put your notes into a simple table so you can compare projects side by side:</p>
<div class="table-scroll"><table>
<caption>A simple comparison sheet</caption>
<thead><tr><th>Check</th><th>Project A</th><th>Project B</th></tr></thead>
<tbody>
<tr><td>All-inclusive price ÷ RERA carpet area</td><td></td><td></td></tr>
<tr><td>Peak-hour travel time to work</td><td></td><td></td></tr>
<tr><td>Construction progress vs MahaRERA update</td><td></td><td></td></tr>
<tr><td>Possession date in agreement</td><td></td><td></td></tr>
<tr><td>Water source</td><td></td><td></td></tr>
<tr><td>Parking (covered / open, allotted?)</td><td></td><td></td></tr>
<tr><td>Monthly maintenance</td><td></td><td></td></tr>
</tbody></table></div>
<p>Don’t pay a booking amount on the day of the first visit, however good the “today only” offer sounds. Under RERA, a developer cannot take more than 10% of the price as an advance before a registered agreement for sale. If you are weighing an under-construction flat against a finished one, read <a href="/blog/ready-to-move-vs-under-construction-flats-pune">ready-to-move vs under-construction flats</a>.</p>

<h2>FAQs</h2>
<h3>How many site visits should I make before booking?</h3>
<p>At least two: one on a weekday at peak hours and one on a weekend. Visit again before signing the agreement if anything has changed.</p>
<h3>Is the sample flat the same as the flat I will get?</h3>
<p>Not always. The layout, sizes, fittings and furnishings can differ. Confirm the exact unit, its floor plan and the specifications in writing.</p>
<h3>Should I visit during the monsoon?</h3>
<p>If you can, yes. It shows how the approach road and the area handle heavy rain, and whether there is waterlogging nearby.</p>
<h3>What should I carry on a site visit?</h3>
<p>The project’s RERA number, a list of questions, a measuring tape (or a phone app), and your phone to take photos and note travel times.</p>

<blockquote>This checklist is general information, not legal or financial advice. Verify project details on the official MahaRERA website and have the documents checked by a property lawyer before you pay.</blockquote>
`,
  };
}

function occupancyCertificateArticle() {
  return {
    slug: 'occupancy-certificate-oc-completion-certificate-pune',
    title: 'Occupancy Certificate (OC) vs Completion Certificate: Why Pune Buyers Must Check Before Possession',
    seo_title: 'Occupancy Certificate (OC) vs Completion Certificate',
    seo_description:
      'What an occupancy certificate (OC) and completion certificate are, why you should not take possession without an OC, and what RERA says about them.',
    excerpt:
      'The occupancy certificate is the document that says a building is fit to live in. Here is what it is, how it differs from a completion certificate, and why you should ask for it before you take the keys.',
    tags: ['Occupancy Certificate', 'RERA', 'Possession', 'Home Buyer Rights', 'Pune'],
    cover: {
      theme: 'golden',
      kicker: 'Buyer’s guide',
      lines: ['Occupancy', 'Certificate (OC)', 'Explained'],
      stats: [['Sec 11(4)(b)', 'developer gets OC'], ['2 months', 'to take possession'], ['Sec 17', 'conveyance deed']],
    },
    content: `
<p>When an under-construction project is finished, the keys are only half the handover. The other half is the paperwork, and the most important document in it is the <strong>occupancy certificate</strong>, or OC. This guide explains what an OC is, how it differs from a completion certificate, and what to check before you take possession.</p>

<h2>What is an occupancy certificate (OC)?</h2>
<p>An OC is issued by the local planning authority (in the Pune region, usually the Pune Municipal Corporation, the Pimpri Chinchwad Municipal Corporation or PMRDA) after it inspects a finished building. It certifies that the building was built according to the sanctioned plans and is fit to be occupied, with provision for water, sanitation and electricity.</p>
<p>The RERA Act defines it in <strong>Section 2(zf)</strong> as the certificate, by whatever name called, issued by the competent authority permitting occupation of a building.</p>

<h2>What is a completion certificate?</h2>
<p>A completion certificate (defined in <strong>Section 2(q)</strong> of the RERA Act) certifies that the project has been developed according to the sanctioned plan, layout plan and specifications. Different authorities use different names and steps for it, and in many cities the completion and occupancy certificates are issued together or as one document.</p>
<p>Don’t confuse it with the <strong>commencement certificate</strong>, which is often also called a “CC” in Maharashtra. A commencement certificate is the permission to <em>start</em> construction, issued before work begins.</p>

<div class="table-scroll"><table>
<caption>Three certificates buyers hear about</caption>
<thead><tr><th>Certificate</th><th>When it is issued</th><th>What it says</th></tr></thead>
<tbody>
<tr><td>Commencement certificate</td><td>Before construction starts</td><td>The building plans are approved and work can begin</td></tr>
<tr><td>Completion certificate</td><td>When construction is finished</td><td>The project was built as per the sanctioned plans</td></tr>
<tr><td>Occupancy certificate (OC)</td><td>After inspection of the finished building</td><td>The building is fit to be lived in</td></tr>
</tbody></table></div>

<h2>What RERA says</h2>
<ul>
  <li><strong>The developer must get it (Section 11(4)(b)).</strong> The promoter is responsible for obtaining the completion certificate or the occupancy certificate, or both, and making it available to buyers individually or to their association.</li>
  <li><strong>Conveyance follows the OC (Section 17).</strong> The developer must execute a registered conveyance deed in your favour and transfer the common areas to the association. Where no local law sets a period, the RERA Act sets a deadline of three months from the date of the OC. In Maharashtra, if a developer does not convey the land and building to the society, the society can apply for deemed conveyance.</li>
  <li><strong>Buyers take possession after the OC (Section 19(10)).</strong> Every buyer must take physical possession of the flat within two months of the occupancy certificate being issued.</li>
</ul>

<h2>Why you should not move in without an OC</h2>
<ul>
  <li><strong>The building has not been cleared as fit to live in.</strong> It may not match the approved plans, and the authority could act against unauthorised occupation.</li>
  <li><strong>Utilities can be a problem.</strong> Permanent water and electricity connections are usually tied to the OC.</li>
  <li><strong>Loans and resale get harder.</strong> Many banks ask for the OC before they lend on a resale flat, so a flat without one can be harder to sell later.</li>
  <li><strong>Conveyance is held up.</strong> Without the OC, the society cannot get the land and building transferred to it.</li>
</ul>
<p>If the possession date has passed and the developer is offering “fit-out possession” without an OC, read <a href="/blog/possession-delay-rera-buyer-rights-maharera-complaint">your rights when possession is delayed</a>.</p>

<h2>Part OC</h2>
<p>Large projects in Pune are often built in phases, and the authority may issue a <strong>part occupancy certificate</strong> for some towers, wings or floors. If you are buying in such a project, check that the part OC covers your specific building and floor.</p>

<h2>How to check the OC</h2>
<ol>
  <li><strong>Ask the developer for a copy</strong> before you take possession, and keep it with your agreement and payment receipts.</li>
  <li><strong>Check the details:</strong> the issuing authority, the date, the survey number, and the building, wing and floors it covers.</li>
  <li><strong>Look at the project’s MahaRERA page,</strong> where developers upload their approvals and completion documents. Our guide shows <a href="/blog/how-to-check-maharera-registration-number">how to find a project on MahaRERA</a>.</li>
  <li><strong>For a resale flat,</strong> ask the seller or the housing society for the OC before you pay a token amount.</li>
</ol>
<p>The OC is one of several papers to check. See the full list of <a href="/blog/documents-to-check-before-buying-flat-pune">documents to check before buying a flat</a>, or skip the wait by looking at <a href="/status/ready-to-move">ready-to-move projects</a>.</p>

<h2>FAQs</h2>
<h3>Can I take possession of a flat without an OC?</h3>
<p>You shouldn’t. Under the RERA Act, possession follows the OC, and living in a building without one can cause problems with utilities, loans, resale and conveyance.</p>
<h3>Who is responsible for getting the OC?</h3>
<p>The developer. Section 11(4)(b) of the RERA Act makes the promoter responsible for obtaining it and making it available to buyers.</p>
<h3>Is a completion certificate the same as an OC?</h3>
<p>Not exactly. A completion certificate says the project was built as per the sanctioned plans; an OC says the building is fit to occupy. Some authorities issue them together.</p>
<h3>What is a part OC?</h3>
<p>An occupancy certificate for only some towers, wings or floors of a project. Check that it covers your flat.</p>

<blockquote>This guide is general information, not legal advice. Rules and procedures differ between authorities and change over time. Have the documents checked by a property lawyer and verify project details on the official MahaRERA website.</blockquote>
`,
  };
}

function agreementForSaleArticle() {
  return {
    slug: 'agreement-for-sale-clauses-to-check-maharera',
    title: 'Agreement for Sale: 12 Clauses to Check Before You Sign for a Flat in Maharashtra',
    seo_title: 'Agreement for Sale: Clauses to Check Before Signing',
    seo_description:
      'The clauses to read in a builder’s agreement for sale: carpet area, possession date, delay interest, parking, defects, cancellation and payment schedule, with what RERA says.',
    excerpt:
      'The agreement for sale decides what you get, when you get it and what happens if things go wrong. Here are the clauses to read line by line before you sign, and what the RERA Act says about each.',
    tags: ['Agreement for Sale', 'RERA', 'MahaRERA', 'Home Buyer Rights', 'Home Buying Guide'],
    cover: {
      theme: 'slate',
      kicker: 'Buyer’s guide',
      lines: ['Agreement for', 'Sale: Clauses', 'to Check'],
      stats: [['10%', 'max before agreement'], ['5 years', 'defect liability'], ['Sec 13', 'registered agreement']],
    },
    content: `
<p>After the booking form, the <strong>agreement for sale</strong> is the most important document you will sign when you buy an under-construction flat. It is registered, it fixes the price, the flat and the possession date, and it is what you will rely on if the project runs late. This guide lists the clauses to read carefully, and what the RERA Act says about them.</p>

<h2>Why the agreement matters</h2>
<p>Under <strong>Section 13 of the RERA Act</strong>, a developer cannot take more than <strong>10% of the cost</strong> of a flat as an advance or application fee before entering into a written agreement for sale and registering it. The agreement must state the specifications of the flat, the dates and manner of payment, the date of possession and the interest payable on default.</p>
<p>In Maharashtra, MahaRERA has prescribed a model form of agreement for sale. Developers can add clauses, but they should not dilute the buyer’s rights in the model agreement or the Act. Ask for the draft agreement well before the registration date so you have time to read it, ideally with a property lawyer.</p>

<h2>The clauses to check</h2>
<ol>
  <li><strong>The flat itself.</strong> The unit number, floor, wing, building and the project’s MahaRERA registration number should all be written in. Check them against your booking form and the floor plan attached to the agreement.</li>
  <li><strong>Carpet area.</strong> The price must be based on RERA carpet area: the net usable floor area, excluding external walls, service shafts, and exclusive balconies or terraces. Balconies and terraces should be listed separately. See <a href="/blog/carpet-area-vs-built-up-vs-super-built-up-area">carpet vs built-up vs super built-up area</a>.</li>
  <li><strong>Total price and what it includes.</strong> Look for a breakup of the agreement value, and a list of other charges: GST, parking, maintenance deposit, society formation, legal charges and so on. Anything not written in can be added later.</li>
  <li><strong>Payment schedule.</strong> Payments should be linked to construction stages, not to dates. Our guide to <a href="/blog/payment-plans-construction-linked-subvention-flats-pune">payment plans for new flats</a> explains the options.</li>
  <li><strong>Possession date.</strong> The agreement should state a clear date. Compare it with the completion date on the project’s MahaRERA page. Our guide shows <a href="/blog/how-to-check-maharera-registration-number">how to find a project on MahaRERA</a>.</li>
  <li><strong>Delay compensation.</strong> Under <strong>Section 18</strong>, if the developer fails to give possession as per the agreement, you can withdraw and get a refund with interest, or stay and get interest for every month of delay. In Maharashtra, the rules set this interest at the State Bank of India’s highest marginal cost of lending rate (MCLR) plus 2%. Read more on <a href="/blog/possession-delay-rera-buyer-rights-maharera-complaint">your rights when possession is delayed</a>.</li>
  <li><strong>Interest on your late payments.</strong> If you pay late, you pay interest too. Under RERA the rate should be the same both ways, so check that the agreement doesn’t charge you a higher rate than the developer pays you.</li>
  <li><strong>Force majeure.</strong> RERA lists force majeure as war, flood, drought, fire, cyclone, earthquake or other natural calamities. Be careful of a clause that adds wide extra reasons, like “delay in approvals” or “labour shortage”, to extend the possession date.</li>
  <li><strong>Parking.</strong> Under RERA, a garage (a covered space with a roof and walls on three sides) can be sold, but open parking is a common area. The type of parking and the slot number should be written in.</li>
  <li><strong>Specifications and amenities.</strong> The brands and quality of flooring, windows, doors, fittings, lifts and the list of amenities should be attached. Under <strong>Section 14</strong>, the developer cannot change the sanctioned plans and specifications of your flat without your consent.</li>
  <li><strong>Defect liability.</strong> Under <strong>Section 14(3)</strong>, if you find a structural defect or a defect in workmanship, quality or services within <strong>five years of possession</strong>, the developer must fix it free of charge within 30 days. The agreement should not shorten this period.</li>
  <li><strong>Cancellation and refund.</strong> Read what happens if you cancel: how much is forfeited and how quickly the rest is refunded. Also check what happens if the developer cancels, which should only be for clear reasons, with notice.</li>
</ol>

<h2>Other points to look for</h2>
<ul>
  <li><strong>Society and conveyance.</strong> The agreement should say when the developer will form the housing society and transfer the land and building to it. This follows the occupancy certificate; see our guide to the <a href="/blog/occupancy-certificate-oc-completion-certificate-pune">occupancy certificate (OC)</a>.</li>
  <li><strong>Maintenance.</strong> Check how much is collected in advance, for how many months, and from when you start paying it.</li>
  <li><strong>Transfer of the project.</strong> Under <strong>Section 15</strong>, the developer cannot hand the project over to another developer without the written consent of two-thirds of the buyers and the approval of the authority.</li>
  <li><strong>Annexures.</strong> The title certificate, the approved plans, the floor plan of your flat and the specifications are usually attached. Make sure they are actually there, and match what you were shown. Our list of <a href="/blog/documents-to-check-before-buying-flat-pune">documents to check before buying a flat</a> covers them.</li>
</ul>

<h2>Registration and stamp duty</h2>
<p>The agreement for sale is registered at the sub-registrar’s office, and in Maharashtra stamp duty is paid on it at the time of registration. Get the stamp duty and registration amounts from the developer in advance; our guide to <a href="/blog/stamp-duty-registration-charges-pune">stamp duty and registration charges in Pune</a> shows how they are worked out. Keep the registered agreement, the receipts and the index II safely: you will need them for your home loan, for resale and for any complaint.</p>

<h2>FAQs</h2>
<h3>Can a developer take more than 10% before the agreement?</h3>
<p>No. Section 13 of the RERA Act says a developer cannot take more than 10% of the cost as an advance before a registered agreement for sale.</p>
<h3>Is the agreement for sale the same as the sale deed?</h3>
<p>No. The agreement for sale is a promise to sell, signed while the flat is being built. Ownership passes later, through the conveyance to the society, or a sale deed for the flat.</p>
<h3>Can I ask the developer to change a clause?</h3>
<p>Yes, you can ask, especially for clauses that go beyond the MahaRERA model agreement. Get any change in writing in the agreement itself, not in a side letter.</p>
<h3>Should I get a lawyer to read the agreement?</h3>
<p>It is worth it. A property lawyer can check the agreement against the model form and the project’s title documents for a small fee compared with the price of the flat.</p>

<blockquote>This guide is general information, not legal advice. Rules and the MahaRERA model agreement change over time. Have the agreement checked by a property lawyer and verify project details on the official MahaRERA website.</blockquote>
`,
  };
}

function paymentPlansArticle() {
  return {
    slug: 'payment-plans-construction-linked-subvention-flats-pune',
    title: 'Payment Plans for New Flats: Construction-Linked, Down Payment and Subvention Explained',
    seo_title: 'Construction-Linked vs Down Payment vs Subvention Plans',
    seo_description:
      'How construction-linked, down payment, flexi and subvention (20:80) payment plans work for under-construction flats in Pune, their risks, and how to check a demand letter.',
    excerpt:
      'The payment plan decides how much of your money is with the developer before your flat is built. Here is how the common plans work, the discount and risk in each, and what to check before you pay a demand letter.',
    tags: ['Payment Plan', 'Home Loan', 'Under Construction', 'RERA', 'Pune'],
    cover: {
      theme: 'ember',
      kicker: 'Buyer’s guide',
      lines: ['Payment Plans', 'for New Flats', 'Explained'],
      stats: [['10%', 'max before agreement'], ['70%', 'in separate account'], ['Stage-wise', 'demand letters']],
    },
    content: `
<p>When you buy an under-construction flat, you don’t pay the full price on day one. You pay in parts, according to a <strong>payment plan</strong>. The plan you choose decides how much of your money the developer holds before the flat is ready, how soon your home loan EMIs start, and how much risk you carry if the project is delayed. This guide explains the common plans and what to check before each payment.</p>

<h2>What RERA says about payments</h2>
<ul>
  <li><strong>No more than 10% before the agreement.</strong> Under Section 13 of the RERA Act, a developer cannot take more than 10% of the cost as an advance before a registered agreement for sale. See <a href="/blog/agreement-for-sale-clauses-to-check-maharera">clauses to check in the agreement for sale</a>.</li>
  <li><strong>The schedule goes in the agreement.</strong> The dates and manner of payment must be written in the agreement.</li>
  <li><strong>70% goes into a separate account.</strong> Under Section 4(2)(l)(D), developers must deposit 70% of the money collected from buyers in a separate bank account, to be used only for the cost of land and construction of that project. Withdrawals have to be in proportion to the work completed, certified by an engineer, an architect and a chartered accountant.</li>
  <li><strong>Interest works both ways.</strong> If you pay late, the developer can charge interest; if the developer delivers late, it pays you interest at the same rate.</li>
</ul>

<h2>The common payment plans</h2>
<div class="table-scroll"><table>
<caption>Payment plans at a glance</caption>
<thead><tr><th>Plan</th><th>How you pay</th><th>Good for</th><th>Main risk</th></tr></thead>
<tbody>
<tr><td>Construction-linked (CLP)</td><td>In stages as the building goes up</td><td>Most buyers</td><td>Small; you pay as work is done</td></tr>
<tr><td>Down payment</td><td>Most of the price soon after booking</td><td>Buyers with cash who want a discount</td><td>Your money is stuck if the project stalls</td></tr>
<tr><td>Flexi</td><td>A larger first payment, then stages</td><td>Buyers who want some discount with less risk</td><td>Partly the same as down payment</td></tr>
<tr><td>Subvention (e.g. 20:80)</td><td>A small part upfront; the bank pays the rest to the developer</td><td>Buyers paying rent who can’t afford EMI + rent</td><td>You owe the bank even if the developer defaults</td></tr>
</tbody></table></div>

<h3>1. Construction-linked plan (CLP)</h3>
<p>This is the most common plan. After the booking amount and a payment on signing the agreement, each further payment is due when a stage of construction is complete: the plinth, each slab, the walls and plaster, the plumbing and lifts, and finally possession. If work slows down, your payments slow down too. The MahaRERA model agreement follows this approach.</p>

<h3>2. Down payment plan</h3>
<p>You pay most of the price, often 90% or more, soon after the agreement, usually in return for a discount. The saving can be real, but so is the risk: if the project is delayed or stalls, most of your money is already with the developer. Consider it only with an established developer whose project is well under way.</p>

<h3>3. Flexi plan</h3>
<p>A middle path: you pay a larger share upfront than in a CLP, for a smaller discount, and the rest is linked to construction.</p>

<h3>4. Subvention plans (20:80, 10:90)</h3>
<p>You pay a small part of the price, and the bank disburses most of the loan to the developer early. The developer agrees to pay the interest on your loan (the pre-EMI) until possession, so you pay nothing more until then.</p>
<p>The catch: the loan is in <strong>your</strong> name. If the developer stops paying the interest or the project is delayed, the bank will ask you to pay, even if your flat is not ready. Regulators have cautioned lenders about these schemes in the past. If you take one, read the tripartite agreement between you, the developer and the bank carefully, and know what happens if the developer stops paying.</p>

<h2>Home loans during construction</h2>
<p>With a construction-linked plan, the bank releases your loan in parts as each demand letter comes in. Until the full loan is disbursed you can choose to pay:</p>
<ul>
  <li><strong>Pre-EMI:</strong> interest only on the amount released so far. It is lower now, but you have not started paying off the loan.</li>
  <li><strong>Full EMI:</strong> the normal EMI from the start, which reduces the loan sooner and the total interest you pay.</li>
</ul>
<p>Our guide to <a href="/blog/home-loan-emi-eligibility-pune">home loan EMI and eligibility</a> shows how much you can borrow and what the EMI will be.</p>

<h2>How to check a demand letter</h2>
<ol>
  <li><strong>Match the stage.</strong> The letter should name a stage in your agreement’s payment schedule, such as “completion of the 8th slab”.</li>
  <li><strong>Check the progress.</strong> Compare it with the project’s latest progress update on MahaRERA, and, if you can, with what you see on site. Our guide shows <a href="/blog/how-to-check-maharera-registration-number">how to find a project on MahaRERA</a>.</li>
  <li><strong>Check the amount.</strong> It should be the agreed percentage of the agreement value, plus GST. Under-construction flats attract 5% GST (1% for affordable housing) on each instalment; see <a href="/blog/ready-to-move-vs-under-construction-flats-pune">ready-to-move vs under-construction flats</a>.</li>
  <li><strong>Pay to the right account.</strong> Pay only to the bank account named in the agreement or the demand letter on the developer’s letterhead, never in cash, and keep every receipt.</li>
</ol>

<h2>FAQs</h2>
<h3>Which payment plan is safest?</h3>
<p>A construction-linked plan, because your payments follow the actual progress of the building.</p>
<h3>Is a down payment discount worth it?</h3>
<p>Only if you trust the developer to deliver on time. Compare the discount with the interest you would earn on the money, and with the risk of a delay.</p>
<h3>Can a developer ask for payment before the stage is complete?</h3>
<p>Under a construction-linked plan, a payment is due only when the stage in the agreement is complete. If the progress on MahaRERA or on site does not match, ask the developer for proof before you pay.</p>
<h3>Who pays the interest if a subvention developer defaults?</h3>
<p>You do. The loan is in your name, so the bank can ask you to pay even though the developer had agreed to.</p>

<blockquote>This guide is general information, not legal or financial advice. Check the terms with your bank and a property lawyer, and verify project details on the official MahaRERA website before you pay.</blockquote>
`,
  };
}

// ---- photos ---------------------------------------------------------------------

const PHOTO_DIR = path.resolve('migration/blog-photos');
const CREDITS = JSON.parse(await readFile(path.join(PHOTO_DIR, 'credits.json'), 'utf8'));

// Crop position per cover photo (sharp gravity); default 'centre'.
const PHOTO_POSITION = {
  'new-projects-in-mundhwa-pune': 'top',
  'how-to-check-maharera-registration-number': 'bottom',
  'new-projects-in-navi-mumbai': 'bottom',
  'luxury-flats-villas-in-pune': 'right',
  'new-projects-in-bengaluru': 'bottom',
  'agreement-for-sale-clauses-to-check-maharera': 'right',
  'payment-plans-construction-linked-subvention-flats-pune': 'bottom',
};

/** CC licences require attribution and a note that the photo was changed. */
function photoCredit(c) {
  const title = `<a href="${esc(c.source)}" rel="nofollow noopener" target="_blank">${esc(c.title)}</a>`;
  const license = c.licenseUrl
    ? `<a href="${esc(c.licenseUrl)}" rel="license nofollow noopener" target="_blank">${esc(c.license)}</a>`
    : esc(c.license);
  return `<p class="photo-credit"><small>Cover photo: ${title} by ${esc(c.author)}, ${license}, via Wikimedia Commons. Cropped, with text added.</small></p>`;
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
  let articles = [
    mundhwaArticle(h), puneAreasArticle(h), kharadiArticle(h), reraArticle(h),
    westPuneArticle(h), pcmcArticle(h), eastPuneArticle(h), readyVsUcArticle(h),
    underOneCroreArticle(h), stampDutyArticle(h), threeBhkArticle(h), homeLoanArticle(h),
    twoBhkArticle(h), luxuryArticle(h), naviMumbaiArticle(h), kalyanDombivliArticle(h),
    commercialArticle(h), upcomingArticle(h), bengaluruArticle(h), mumbaiArticle(h),
    centralPuneArticle(h), documentsArticle(h), carpetAreaArticle(), possessionDelayArticle(),
    siteVisitArticle(), occupancyCertificateArticle(), agreementForSaleArticle(), paymentPlansArticle(),
  ];

  // --only=slug-a,slug-b seeds just those posts and leaves the rest (and the old
  // placeholder) alone.
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice(7).split(',').map((s) => s.trim()).filter(Boolean) : null;
  if (only) {
    const unknown = only.filter((s) => !articles.some((a) => a.slug === s));
    if (unknown.length) throw new Error(`unknown slug(s): ${unknown.join(', ')}`);
    articles = articles.filter((a) => only.includes(a.slug));
  }

  // Sanity: every slug used by the articles' internal links must be stable.
  for (const a of articles) if (slugify(a.slug) !== a.slug) throw new Error(`bad slug ${a.slug}`);

  await mkdir(COVER_DIR, { recursive: true });
  for (const a of articles) {
    const credit = CREDITS[a.slug];
    if (!credit) throw new Error(`no cover photo for ${a.slug} (run migration/fetch-blog-photos.mjs)`);
    // Versioned name: /img is browser-cached for a week (next.config.mjs).
    const file = `${a.slug}-v4.jpg`;
    await makeCover(path.join(COVER_DIR, file), {
      ...a.cover,
      photo: { file: path.join(PHOTO_DIR, credit.file), position: PHOTO_POSITION[a.slug] },
    });
    a.cover_image = `/img/blog/${file}`;
    a.content = `${a.content.trim()}\n\n${photoCredit(credit)}`;
    console.log(`Cover: public/img/blog/${file}`);
  }

  if (process.argv.includes('--dry-run')) {
    console.log(`Dry run: ${articles.length} articles built, database untouched.`);
    return;
  }

  for (const slug of only ? [] : OLD_SLUGS) {
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

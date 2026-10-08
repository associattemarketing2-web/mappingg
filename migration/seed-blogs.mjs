// Seed the public blog with SEO articles built from the live project data.
//
//   node --env-file=.env migration/seed-blogs.mjs [--dry-run]
//
// --dry-run renders the covers and builds every article but writes nothing to
// the database — use it to commit the new covers before the posts go live.
//
// - Removes the old placeholder post ("welcome-to-the-mappingg-blog").
// - Renders an illustrated 1200x630 cover per article (migration/blog-covers.mjs)
//   into public/img/blog/, also used as the Open Graph / Twitter card image.
//   Commit and deploy them before seeding, so production can serve them.
// - Upserts each article by slug, so re-running refreshes the content instead
//   of creating duplicates.
//
// Project names, prices, BHK mixes, possession dates, RERA numbers and photos
// are read from the `pins` table at run time; project links use the same slug
// rules as the /projects/<slug> pages (lib/seo/slug.ts + lib/locality.ts).

import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
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
  const articles = [
    mundhwaArticle(h), puneAreasArticle(h), kharadiArticle(h), reraArticle(h),
    westPuneArticle(h), pcmcArticle(h), eastPuneArticle(h), readyVsUcArticle(h),
  ];

  // Sanity: every slug used by the articles' internal links must be stable.
  for (const a of articles) if (slugify(a.slug) !== a.slug) throw new Error(`bad slug ${a.slug}`);

  await mkdir(COVER_DIR, { recursive: true });
  for (const a of articles) {
    // Versioned name: /img is browser-cached for a week (next.config.mjs).
    const file = `${a.slug}-v2.jpg`;
    await makeCover(path.join(COVER_DIR, file), a.cover);
    a.cover_image = `/img/blog/${file}`;
    console.log(`Cover: public/img/blog/${file}`);
  }

  if (process.argv.includes('--dry-run')) {
    console.log(`Dry run: ${articles.length} articles built, database untouched.`);
    return;
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

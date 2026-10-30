// Download the real (Wikimedia Commons, CC-licensed) photos behind the blog
// covers into migration/blog-photos/ and record their credits in
// migration/blog-photos/credits.json. One-off: the photos are committed, so
// seed-blogs.mjs never needs the network. Photos already in credits.json are
// skipped, so adding an article only downloads its new photo.
//
//   node migration/fetch-blog-photos.mjs

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// article slug → Commons file name
const PHOTOS = {
  'new-projects-in-mundhwa-pune': 'Google Pune office in Mundhwa.jpg',
  'best-areas-to-buy-property-in-pune': 'An aerial view of Pune Maharashtra.jpg',
  'new-projects-in-kharadi-pune': 'Kharadi Skyline.jpg',
  'how-to-check-maharera-registration-number': 'Pune Skyline 2018.jpg',
  'new-projects-in-hinjewadi-baner-balewadi-pune': 'Pune West skyline - March 2017.jpg',
  'new-projects-in-pimpri-chinchwad-pcmc': 'Pimpri-Chinchwad Municipal Corporation.jpg',
  'new-projects-in-east-pune-hadapsar-viman-nagar-lohegaon': 'Hadapsar Skyline.jpg',
  'ready-to-move-vs-under-construction-flats-pune': 'Under Construction Building.jpg',
  'flats-under-1-crore-in-pune': 'Bavdhan skyline Pune.jpg',
  'stamp-duty-registration-charges-pune': 'Skyline of Pune city as seen from The Westin Koregaon Park.jpg',
  '3-bhk-flats-in-pune': 'Magarpatta Residential Zone.JPG',
  'home-loan-emi-eligibility-pune': 'Magarpatta Residential Apartments.JPG',
  '2-bhk-flats-in-pune': 'Hadapsar area.jpg',
  'luxury-flats-villas-in-pune': 'Pune, kalyani nagar.jpg',
  'new-projects-in-navi-mumbai': 'Navi Mumbai Skyline.jpg',
  'new-projects-in-kalyan-dombivli-palava-thane': 'Aerial view of completed developments at Palava today.jpg',
  'commercial-property-office-space-in-pune': 'World Trade Center, Kharadi.jpg',
  'upcoming-new-launch-projects-in-pune': 'Skyline of Pune.jpg',
  'new-projects-in-bengaluru': 'Skyline of Varthur, Bangalore.jpg',
  'new-projects-in-mumbai-andheri-borivali-south-mumbai': 'Mumbai Skyline with Bandra–Worli Sea Link 25 July 2018 (1).jpg',
  'new-projects-in-kothrud-koregaon-park-central-pune': 'Kothrud full view.JPG',
  'documents-to-check-before-buying-flat-pune': 'Pune Municipal Corporation building in October 2023.jpg',
  'carpet-area-vs-built-up-vs-super-built-up-area': 'Baner from Baner Pashan Biodiversity Park.JPG',
  'possession-delay-rera-buyer-rights-maharera-complaint': 'Scaffolding for a building under construction.jpg',
  'site-visit-checklist-before-buying-flat-pune': 'STP, residential building construction and Mutha River clogged with water hyacinth as seen from Rajaram Bridge in Pune.jpg',
  'occupancy-certificate-oc-completion-certificate-pune': 'Magarpatta Residential Apartments (2).JPG',
  'agreement-for-sale-clauses-to-check-maharera': 'Pashan, Pune Skyline.jpg',
  'payment-plans-construction-linked-subvention-flats-pune': 'South Pune Skyline.jpg',
  'new-projects-in-whitefield-bengaluru-east': 'NCC apartments at Mahadevapura Bangalore.JPG',
  'new-projects-in-sarjapur-anekal-bengaluru': 'KaikondrahalliLake.jpg',
  'new-projects-in-south-bengaluru': 'Brigade Omega Apartments, BSK 6th Stage, Bangalore (2024).jpg',
  'new-projects-in-north-bengaluru-yelahanka': 'Yelahanka New Town.jpg',
  'home-loan-tax-benefits-80c-24b': 'Baner Hill from Pashan, Pune, India..jpg',
  'buying-resale-flat-checklist-pune': 'Ganesh Apartment, Kasba Peth, Pune.jpg',
  'flat-prices-in-pune-by-locality-and-bhk': 'Eastern Pune Skyline.jpg',
  'flats-in-mumbai-thane-navi-mumbai-by-bhk-and-budget': 'Hiranandani Gardens, Powai skyline.JPG',
  'nri-guide-buying-property-in-india-pune': 'Pune Airport Front View 2025.jpg',
  'maintenance-charges-sinking-fund-society-handover-pune': 'Asawari Apartments,Nanded City.jpg',
};

const OUT = path.resolve('migration/blog-photos');
const UA = { 'User-Agent': 'MappinggBlogCovers/1.0 (https://mappingg.com)' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function get(url, binary) {
  for (let i = 0; i < 8; i++) {
    const res = await fetch(url, { headers: UA });
    if (res.ok) {
      if (binary) return Buffer.from(await res.arrayBuffer());
      const text = await res.text();
      if (text.startsWith('{')) return JSON.parse(text);
    }
    await wait(10000 * (i + 1)); // Commons rate limit
  }
  throw new Error(`failed: ${url}`);
}

const credits = JSON.parse(await readFile(path.join(OUT, 'credits.json'), 'utf8').catch(() => '{}'));
for (const [slug, name] of Object.entries(PHOTOS)) {
  if (credits[slug]?.title === name.replace(/\.[a-z]+$/i, '')) continue;
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=${encodeURIComponent(`File:${name}`)}` +
    `&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=2000&iiextmetadatafilter=LicenseShortName|LicenseUrl|Artist`;
  const page = Object.values((await get(api)).query.pages)[0];
  const info = page.imageinfo[0];
  const m = info.extmetadata;
  const file = `${slug}.jpg`;
  const img = await get(info.thumburl || info.url, true);
  await sharp(img).rotate().resize({ width: 2000, withoutEnlargement: true }).jpeg({ quality: 86, mozjpeg: true }).toFile(path.join(OUT, file));
  credits[slug] = {
    file,
    title: name.replace(/\.[a-z]+$/i, ''),
    author: strip(m.Artist?.value),
    license: m.LicenseShortName?.value,
    licenseUrl: m.LicenseUrl?.value || '',
    source: info.descriptionurl,
  };
  console.log(`${file}  ${credits[slug].license}  ${credits[slug].author}`);
  await wait(3000);
}
await writeFile(path.join(OUT, 'credits.json'), JSON.stringify(credits, null, 2) + '\n');

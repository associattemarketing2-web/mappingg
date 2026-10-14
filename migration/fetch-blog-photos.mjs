// Download the real (Wikimedia Commons, CC-licensed) photos behind the blog
// covers into migration/blog-photos/ and record their credits in
// migration/blog-photos/credits.json. One-off: the photos are committed, so
// seed-blogs.mjs never needs the network.
//
//   node migration/fetch-blog-photos.mjs

import { writeFile } from 'node:fs/promises';
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

const credits = {};
for (const [slug, name] of Object.entries(PHOTOS)) {
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

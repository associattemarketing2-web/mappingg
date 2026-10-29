// One-off (29 Oct 2026): complete the 2 Jhamtani Group submissions from the 29 Oct Excel import and publish them.
//
//   npx tsx --env-file=.env migration/jhamtani-go-live-2026-10-29.mts <img-dir>            (dry run)
//   npx tsx --env-file=.env migration/jhamtani-go-live-2026-10-29.mts <img-dir> --apply    (backup, update, upload photos, publish)
//
// Sources: addresses, RERA numbers, unit types, amenities and photos from the official pages jhamtani.com/ace-ayodhya
// and jhamtani.com/biz-one; lat/lng from the Google Maps places "Ace Ayodhya" (the same place the official page
// embeds; address matches) and "Jhamtani Bizone" (HQXR+46H Kokane Chowk, Rahatani 411017). Bizone's land area,
// unit count and building services are from the authorised marketing partner's site (jhamtanibizzone.com).
// The sheet's "Google Maps" column held titles, not links; its price cells were ambiguous ("Rs. 2.93cr" in the
// unit, 29000 as the price), so both stay "Price on request" with the sheet's top figure stored in crore.
// No live pin existed for either project (checked by RERA number and within 600 m).
// <img-dir> holds the photos downloaded from jhamtani.com/assets/... (file names below).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { getDb } from '../lib/mongodb';
import { query } from '../lib/pg';
import { runPartnersRpc } from '../lib/partners-engine';

const APPLY = process.argv.includes('--apply');
const IMG_DIR = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!IMG_DIR) throw new Error('pass the photo folder');

type Fix = {
  id: string; name: string; lat: number; lng: number; mapsLink: string; address: string; page: string;
  short_description: string; configurations: string[]; amenities: string[]; priceMaxCr: number;
  details: { label: string; value: string }[]; cover: string; gallery: string[];
  land_area_acres?: number; total_units?: number;
};

const FIXES: Fix[] = [
  {
    id: '6ba2bc69-e003-45ed-94b6-25634e62e95e', name: 'Ace Ayodhya',
    lat: 18.6094796, lng: 73.7697555,
    mapsLink: 'https://www.google.com/maps/place/Ace+Ayodhya/@18.6094796,73.7697555,17z/data=!4m6!3m5!1s0x3bc2b95110208c85:0x74b9282fb4f3dc1b!8m2!3d18.6094796!4d73.7697555',
    address: 'Near Dange Chowk, on Aundh-Ravet BRTS Road, Sr. No. 15/1/A (P), 15/1C/1 (P), 2839 (P), Thergaon, Pune 411033',
    page: 'https://jhamtani.com/ace-ayodhya',
    short_description: 'High-street retail shops and showrooms of about 600–1,100 sq ft carpet at Ace Ayodhya, Jhamtani Group\'s project on the Aundh–Ravet BRTS Road near Dange Chowk, Thergaon, Pune, which also has 2 and 3 BHK residences.',
    configurations: ['Retail Shops', 'Showrooms'],
    amenities: ['Retail / Shops', 'Swimming Pool', 'Kids Play Area', 'Amphitheatre', 'Landscaped Garden', 'Multipurpose Hall', 'Party Lawn'],
    priceMaxCr: 2.93,
    details: [
      { label: 'Project amenities (developer website)', value: 'Creche, sandpit, scribbling wall, rock climbing wall, children\'s play area, zen garden, recreational hall, swimming pool, kids pool, amphitheatre, activity lawns, community plaza' },
      { label: 'Residences in the project', value: '2 & 3 BHK premium residences (developer website)' },
    ],
    cover: 'ace-ayodhya_hero.webp',
    gallery: ['ace-ayodhya_gallery_the-grand-courtyard.webp', 'ace-ayodhya_gallery_the-open-air-lounge.webp', 'ace-ayodhya_gallery_the-court-in-the-sky.webp', 'ace-ayodhya_gallery_childrens-play-garden.webp', 'ace-ayodhya_gallery_the-wellness-court.webp'],
  },
  {
    id: 'a8c35285-b0aa-42c3-95ff-0322d40c88bc', name: 'Bizone',
    lat: 18.5977292, lng: 73.790665,
    mapsLink: 'https://www.google.com/maps/place/Jhamtani+Bizone/@18.5977292,73.790665,17z/data=!4m6!3m5!1s0x3bc2b90044dbce41:0x427955df208f8e68!8m2!3d18.5977292!4d73.790665',
    address: 'Sr. No. 6/1B, Kokane Chowk, Prasanna Colony, Rahatani, Pimpri-Chinchwad, Pune 411017',
    page: 'https://jhamtani.com/biz-one',
    short_description: 'Jhamtani Bizone is a Grade A commercial project at Kokane Chowk, Pimple Saudagar (Rahatani), Pune, with boutique office suites, corporate offices, high-street retail and double-height showrooms, dual-street exposure and an open-air 6th-floor deck.',
    configurations: ['Office Spaces', 'Retail Shops', 'Showrooms'],
    amenities: ['Retail / Shops', 'Power Backup', '24x7 Security', 'CCTV', 'Covered Parking'],
    priceMaxCr: 1.27,
    land_area_acres: 1, total_units: 120,
    details: [
      { label: 'Unit types (developer website)', value: 'Boutique office suites, corporate executive offices, high-street retail spaces, double-height showrooms' },
      { label: 'Features (developer website)', value: 'Grand entrance lobby in Italian marble, meeting & conference rooms, breakout spaces, open-air 6th-floor deck, dual-street exposure, double-height retail frontage' },
      { label: 'Building services (authorised marketing partner)', value: '100% DG power backup, multi-level smart parking, 24/7 surveillance, central VRV air-conditioning, high-speed fibre connectivity' },
      { label: 'Nearby (developer website)', value: 'Kokane Chowk 0.1 km, Pimple Saudagar High Street 0.6 km, Linear Garden 0.8 km, Govind Garden Chowk 1.2 km' },
    ],
    cover: 'biz-one_banner-laptop.jpg',
    gallery: ['biz-one_img-03.png', 'biz-one_img-04.jpg', 'biz-one_img-1.png', 'biz-one_img-02.png'],
  },
];

const publicUrl = (p: string) => `/api/partners/storage?bucket=project-media&path=${encodeURIComponent(p)}&public=1`;

async function putFile(bucket: string, p: string, buf: Buffer) {
  const filename = `${bucket}/${p}`;
  await query(`DELETE FROM "partners_media" WHERE filename = $1`, [filename]);
  await query(`INSERT INTO "partners_media" (filename, content_type, metadata, data) VALUES ($1, $2, $3::jsonb, $4)`,
    [filename, 'image/jpeg', JSON.stringify({ bucket, path: p }), buf]);
}

const db = await getDb();
const subs = db.collection<any>('project_submissions');
const before: any[] = [];
const plans: { f: Fix; patch: Record<string, unknown> }[] = [];

for (const f of FIXES) {
  const sub = await subs.findOne({ id: f.id });
  if (!sub) throw new Error(`submission ${f.id} missing`);
  if (sub.project_name !== f.name) throw new Error(`${f.id}: name is ${sub.project_name}`);
  if (!['submitted', 'in_review'].includes(sub.status)) throw new Error(`${sub.project_name}: status is ${sub.status}, expected review`);
  for (const file of [f.cover, ...f.gallery]) readFileSync(path.join(IMG_DIR, file)); // all photos present
  before.push(sub);
  const jpg = (file: string) => `${f.id}/${file.replace(/\.[a-z]+$/, '')}.jpg`;
  const patch: Record<string, unknown> = {
    project_name: `Jhamtani ${f.name}`, lat: f.lat, lng: f.lng, google_maps_link: f.mapsLink, address: f.address,
    short_description: f.short_description, configurations: f.configurations, amenities: f.amenities,
    price_unit: 'Crore', price_min: null, price_max: f.priceMaxCr, price_on_request: true,
    additional_details: [...(Array.isArray(sub.additional_details) ? sub.additional_details : []), ...f.details,
      { label: 'Developer project page', value: f.page }],
    cover_image_path: jpg(f.cover), gallery_paths: f.gallery.map(jpg),
    updated_at: new Date().toISOString(),
  };
  if (f.land_area_acres != null) patch.land_area_acres = f.land_area_acres;
  if (f.total_units != null) patch.total_units = f.total_units;
  plans.push({ f, patch });
}

for (const { f, patch } of plans) console.log(f.name, JSON.stringify({ ...patch, additional_details: undefined }, null, 1));
if (!APPLY) { console.log('\nDry run. Pass --apply to write and publish.'); process.exit(0); }

const dir = path.resolve(`migration/backup/pg-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}-before-jhamtani-go-live`);
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'before.json'), JSON.stringify({ submissions: before }, null, 1));
console.log(`backup → ${path.relative(process.cwd(), dir)}/before.json`);

for (const { f, patch } of plans) {
  // Photos: 1600 px JPEGs into the intake upload bucket (so the form shows them) and the public project bucket.
  const published: Record<string, string> = {};
  for (const [file, p] of [[f.cover, patch.cover_image_path], ...f.gallery.map((g, i) => [g, (patch.gallery_paths as string[])[i]])] as [string, string][]) {
    const buf = await sharp(path.join(IMG_DIR, file)).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    await putFile('submission-media', p, buf);
    await putFile('project-media', p, buf);
    published[p] = publicUrl(p);
    console.log(`  ${p} ${Math.round(buf.length / 1024)} KB`);
  }
  await subs.updateOne({ id: f.id }, { $set: { ...patch, published_media: published } });
  const media = {
    cover_image_url: published[patch.cover_image_path as string],
    gallery_urls: (patch.gallery_paths as string[]).map((p) => published[p]),
    brochure_url: null, rera_qr_url: null, floor_plan_urls: [], payment_plan_url: null,
  };
  const r = await runPartnersRpc('admin_publish', { p_id: f.id, p_media: media }, { authed: true, userEmail: 'script:jhamtani-go-live' });
  console.log(f.name, '→', r.error ? `ERROR ${r.error.message}` : JSON.stringify(r.data));
}
process.exit(0);

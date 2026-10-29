// One-off (28 Oct 2026): complete the 8 Nyati Group submissions from the 27 Oct Excel import and publish them.
//
//   npx tsx --env-file=.env migration/nyati-go-live-2026-10-28.mts            (dry run: prints the patches)
//   npx tsx --env-file=.env migration/nyati-go-live-2026-10-28.mts --apply    (backup, update, publish)
//
// Sources: lat/lng from the Google Maps embed on each nyatigroup.com project page (Equinox and Era: Google Places,
// the Equinox embed is centred ~2 km off the site); RERA numbers checked on nyatigroup.com; YouTube links are the
// official Nyati Group channel videos whose titles the sheet gave; towers / floors / acres / amenities from
// nyatigroup.com. Prices in the sheet were whole rupees with unit "Crore" → converted to crore.
// Elenor and Evoque publish onto their existing live pins (#105 "Nyati Lullanagar", #194) instead of new ones.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDb } from '../lib/mongodb';
import { runPartnersRpc } from '../lib/partners-engine';

const APPLY = process.argv.includes('--apply');
const yt = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const site = (p: string) => `https://nyatigroup.com/${p}`;

type Fix = {
  id: string; lat: number; lng: number; video: string; page: string;
  short_description: string; towers?: number; floors?: number; land_area_acres?: number;
  amenities: string[]; amenityList: string; flatSizes?: string; floorsText?: string; source_pin_id?: string;
};

const FIXES: Fix[] = [
  {
    id: '6e6dd821-61a2-428c-8717-21278764bfae', // Nyati Elenor
    lat: 18.488459, lng: 73.887546, video: yt('5H5Rj7jIxXw'), page: site('nyati-elenor/'),
    source_pin_id: 'af48e07b-099f-490a-8adc-72e9a732c036', // pin #105 "Nyati Lullanagar"
    short_description: 'Nyati Elenor is a luxury residential project in Lulla Nagar, South Pune, with 3.5, 4.5 and 5.5 BHK sky residences in 2 towers of B+G+32 storeys on a 2.5-acre site.',
    towers: 2, floors: 32, land_area_acres: 2.5, floorsText: 'B+G+32',
    amenities: ['Multipurpose Hall', 'Kids Play Area', 'Amphitheatre', 'Party Lawn', 'Yoga Deck', 'Sports Court', 'Landscaped Garden'],
    amenityList: 'Celebration lawn, regal stage, amphitheatre, pavilion, fruit orchard, aromatic garden, creche, multipurpose hall, feature waterbody, kids and toddlers play areas, multipurpose play court, temple pavilion, open gym, sky gazing deck, net cricket, barbeque counter, outdoor lounge, zen garden, yoga deck, maze garden, open air theatre',
  },
  {
    id: 'd481d738-b058-4fd8-bba2-46405c767126', // Nyati Esteban II
    lat: 18.4566726, lng: 73.9176876, video: yt('vxQVnjTcr_A'), page: site('nyati-esteban2/'),
    short_description: 'Nyati Esteban II offers 2 and 3 BHK homes in Nyati County, Nyati Group\'s 210-acre township in Undri, Pune, next to Nyati Esteban I with views of the Sahyadri hills.',
    amenities: ['Clubhouse', 'Swimming Pool', 'Kids Play Area', 'Jogging Track', 'Sports Court', 'Indoor Games', 'Amphitheatre', 'Party Lawn', 'Library', 'Mini Theatre', 'Senior Citizen Area'],
    amenityList: 'Clubhouse with indoor games, kids pool, tree house, children\'s and toddlers play areas, tennis court, multipurpose court, jogging track, outdoor gym, cycling zone, net cricket, climbing wall, mini theatre, billiards and table tennis rooms, party lawn, senior citizen plaza, amphitheatre, BBQ deck, nature trail, library reading zone',
  },
  {
    id: '96671a9e-3741-4890-ab0a-f444a4e5032e', // Nyati Evoque
    lat: 18.544239, lng: 73.915282, video: yt('cI1gZaglSao'), page: site('nyati-evoque/'),
    source_pin_id: '46f9c7ab-4310-4b2e-a5be-7902c5ad5204', // pin #194
    short_description: 'Nyati Evoque is a sensory-themed project of 3 and 4 BHK homes in Kalyani Nagar, Pune: twin 27-storey towers on 2 acres with 4 apartments per floor, a podium clubhouse and a rooftop lounge.',
    towers: 2, floors: 27, land_area_acres: 2,
    amenities: ['Swimming Pool', 'Gym', 'Kids Play Area', 'Jogging Track', 'Multipurpose Hall', 'Mini Theatre', 'Sports Court', 'Yoga Deck', 'Party Lawn', 'Indoor Games'],
    amenityList: 'Swimming pool with deck, kids pool and jacuzzi, half basketball court, double-height badminton court, squash court, gymnasium, yoga room, mini theatre, multipurpose hall with party lawn, game zone, rooftop bowling alley, net cricket, outdoor gym, zumba area, sky gazing deck, jogging track, acupressure pathway',
  },
  {
    id: 'faa64eb5-9685-4406-8964-a67c4f74ad2f', // Nyati Era IV
    lat: 18.6044009, lng: 73.905574, video: yt('M6Paz3ZNlTQ'), page: site('projects/residential/nyati-era'),
    short_description: 'Nyati Era IV is the last phase of Nyati Era, an 8-acre, 18-tower township of 2 and 3 BHK homes with sundecks on 7th Heaven Road, Dhanori, about 4.5 km from Pune airport, with a commercial arcade.',
    towers: 18, land_area_acres: 8,
    amenities: ['Clubhouse', 'Swimming Pool', 'Kids Play Area', 'Jogging Track', 'Sports Court', 'Amphitheatre', 'Party Lawn', 'Yoga Deck', 'Senior Citizen Area', 'Retail / Shops', 'Multipurpose Hall'],
    amenityList: 'Clubhouse, swimming pool, kids pool, children\'s play area, amphitheatre, outdoor gym, community hall, jogging and walking tracks, basketball and football courts, indoor badminton court, cricket pitch, multipurpose sports court, rooftop lounge, party lawn, yoga deck, senior citizens\' park, convenience shopping',
  },
  {
    id: '2df28b89-411d-4685-accc-e36dc4a3e0d9', // Nyati Equinox I
    lat: 18.5057491, lng: 73.7729965, video: yt('zgTZJmzxKv4'), page: site('nyati_equinox/'),
    short_description: 'Nyati Equinox is a 14-acre, 10-tower project of 2, 3 and 4 BHK homes near PVPIT College, Bavdhan, Pune, with 70% open space, hill and city views and about 2 minutes to Chandani Chowk.',
    towers: 10, land_area_acres: 14,
    amenities: ['Swimming Pool', 'Kids Play Area', 'Jogging Track', 'Co-working Space', 'Sports Court', 'Yoga Deck', 'Senior Citizen Area', 'Amphitheatre', 'Party Lawn', 'Library', 'Spa / Sauna', 'Multipurpose Hall', 'Indoor Games'],
    amenityList: 'Co-working space, steam, sauna and salon, yoga and meditation rooms, zumba, kids game zone, day care, library, billiards and table tennis rooms, swimming pool, kids pool, multipurpose hall, party lawn, jogging and cycling tracks, cricket pitch, football / tennis court, multipurpose court, skating rink, outdoor gym, amphitheatre, herbal garden, senior citizens\' plaza',
  },
  {
    id: '3605c96f-a3d6-4ff6-9c4c-79c1e3cdb4f1', // Nyati Emerald
    lat: 18.552094, lng: 73.766212, video: yt('3Aak3N3SH-o'), page: site('nyati-emerald/'),
    short_description: 'Nyati Emerald is a 15-acre, 14-tower project of 2 and 3 BHK homes in Baner, Pune, with a vehicle-free podium, a commercial wing and a club with 30+ amenities.',
    towers: 14, land_area_acres: 15,
    amenities: ['Clubhouse', 'Swimming Pool', 'Kids Play Area', 'Jogging Track', 'Co-working Space', 'Sports Court', 'Mini Theatre', 'Indoor Games', 'Yoga Deck', 'Party Lawn', 'Senior Citizen Area', 'Amphitheatre', 'Retail / Shops'],
    amenityList: 'Swimming pool and kids pool, real-life chess, skating rink, sand pit, gaming zone, outdoor gym, football court, co-working space, mini theatre, indoor games, cricket pitch, multipurpose court, jogging and cycling tracks, herbal and tree gardens, yoga lawn, party lawn, senior citizen plaza, food plaza, amphitheatre',
  },
  {
    id: '69ebfc73-1e46-4d0b-aaf6-664a07050648', // Nyati Evania
    lat: 18.503314, lng: 73.847428, video: yt('WZNDp-maVQY'), page: site('nyati-evania/'),
    short_description: 'Nyati Evania is a 4-acre project with 2, 3 and 4 BHK residences, offices and retail behind SP College near Dandekar Bridge, Sadashiv Peth, Pune: 2 towers of B2+B1+LG+G+32 with 40+ amenities and views of Saras Baug and Parvati Hill.',
    towers: 2, floors: 32, land_area_acres: 4, floorsText: 'B2+B1+LG+G+32',
    amenities: ['Swimming Pool', 'Gym', 'Kids Play Area', 'Jogging Track', 'Multipurpose Hall', 'Co-working Space', 'Sports Court', 'Indoor Games', 'Library', 'Mini Theatre', 'Party Lawn', 'Spa / Sauna', 'Retail / Shops'],
    amenityList: 'AC multipurpose hall, badminton and pickleball courts, indoor games, co-working spaces, conference room, creche, AC gym, AC yoga / pilates room, home theatre, library, lounge, steam rooms, swimming pool with deck, kids pool, party lawn, stage, jogging track, cricket pitch, box cricket, football, basketball, tennis, kids play area, wheelchair-friendly pathways',
  },
  {
    id: '60c378b4-7459-492f-854f-8d5e993e78ae', // Nyati Emblem
    lat: 18.483117, lng: 73.845568, video: yt('0FnrZbrYjOg'), page: site('luxury-projects/nyati-emblem'),
    short_description: 'Nyati Emblem is a low-density luxury project of 4 BHK homes with large decks at the foothills of Taljai Hills, Sahakar Nagar, Pune: 2 towers of 27 storeys with 2 flats per floor on 4.5 acres and 45+ amenities.',
    towers: 2, floors: 27, land_area_acres: 4.5,
    amenities: ['Swimming Pool', 'Gym', 'Kids Play Area', 'Jogging Track', 'Multipurpose Hall', 'Mini Theatre', 'Indoor Games', 'Library', 'Spa / Sauna', 'Sports Court', 'Senior Citizen Area', 'Amphitheatre', 'Yoga Deck'],
    amenityList: 'Infinity edge pool with jacuzzi, kids pool, gymnasium, yoga and meditation zone, aerobics / zumba room, steam rooms, salon, indoor games, AC mini theatre, conference room, library and lounge, business centre, multipurpose hall, party lawn, viewing decks, children\'s and toddlers play areas, skating ring, cricket net, multipurpose court, amphitheatre, zen garden, senior citizen zone, jogging track',
  },
];

const crore = (v: unknown) => (v == null ? null : Math.round((Number(v) / 1e7) * 100) / 100);

const db = await getDb();
const subs = db.collection<any>('project_submissions');
const before: any[] = [];
const patches: { id: string; name: string; patch: Record<string, unknown> }[] = [];

for (const f of FIXES) {
  const sub = await subs.findOne({ id: f.id });
  if (!sub) throw new Error(`submission ${f.id} missing`);
  if (!['submitted', 'in_review'].includes(sub.status)) throw new Error(`${sub.project_name}: status is ${sub.status}, expected review`);
  before.push(sub);
  const details = [
    { label: 'Amenities (developer website)', value: f.amenityList },
    ...(f.floorsText ? [{ label: 'Floors (developer website)', value: f.floorsText }] : []),
    { label: 'Developer project page', value: f.page },
  ];
  const patch: Record<string, unknown> = {
    lat: f.lat, lng: f.lng,
    google_maps_link: `https://www.google.com/maps?q=${f.lat},${f.lng}`,
    youtube_url: f.video,
    media_folder_link: null, // the sheet held a folder name, not a link
    price_unit: 'Crore', price_min: crore(sub.price_min), price_max: crore(sub.price_max),
    short_description: f.short_description, amenities: f.amenities,
    additional_details: [...(Array.isArray(sub.additional_details) ? sub.additional_details : []), ...details],
    updated_at: new Date().toISOString(),
  };
  if (f.towers != null) patch.towers = f.towers;
  if (f.floors != null) patch.floors = f.floors;
  if (f.land_area_acres != null) patch.land_area_acres = f.land_area_acres;
  if (f.source_pin_id) patch.source_pin_id = f.source_pin_id;
  patches.push({ id: f.id, name: sub.project_name, patch });
}

for (const p of patches) console.log(p.name, JSON.stringify({ ...p.patch, additional_details: undefined, short_description: undefined, amenities: undefined }));
if (!APPLY) { console.log('\nDry run. Pass --apply to write and publish.'); process.exit(0); }

const pinIds = FIXES.map((f) => f.source_pin_id).filter(Boolean);
const pinsBefore = await Promise.all(pinIds.map((id) => db.collection<any>('pins').findOne({ id })));
const dir = path.resolve(`migration/backup/pg-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}-before-nyati-go-live`);
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'before.json'), JSON.stringify({ submissions: before, pins: pinsBefore }, null, 1));
console.log(`backup → ${path.relative(process.cwd(), dir)}/before.json`);

for (const p of patches) {
  await subs.updateOne({ id: p.id }, { $set: p.patch });
  const r = await runPartnersRpc('admin_publish', { p_id: p.id }, { authed: true, userEmail: 'script:nyati-go-live' });
  console.log(p.name, '→', r.error ? `ERROR ${r.error.message}` : JSON.stringify(r.data));
}
process.exit(0);

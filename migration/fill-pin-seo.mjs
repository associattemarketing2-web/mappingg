// Fill EMPTY SEO fields on public pins — never overwrites a value that exists.
//
//   node --env-file=.env migration/fill-pin-seo.mjs          # dry run (prints the plan)
//   node --env-file=.env migration/fill-pin-seo.mjs --apply  # writes + backup
//
// What it fills (only when the field is empty):
//  - location:    hand-checked against the nearest mapped projects and an
//                 OpenStreetMap reverse lookup of the pin's lat/lng (Oct 2026).
//  - developer:   only where the project name already carries a developer
//                 brand that exists in our data (e.g. "Lodha Estilo" → Lodha).
//  - price:       "Price on Request" for unsold projects with no published price.
//  - description: a factual summary composed from the pin's own fields.
// Also gives the second pin #116 a free number (two pins shared it, so one
// project page could never be reached).
//
// --apply first writes every touched pin's ORIGINAL document to
// migration/backup/pin-seo-fill-<timestamp>.json so the change is reversible.

import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');

const LOCATIONS = {
  14: 'Mundhwa, Pune', 32: 'Mundhwa, Pune', 33: 'Mundhwa, Pune', 40: 'Mundhwa, Pune', 42: 'Mundhwa, Pune',
  43: 'Mundhwa, Pune', 44: 'Mundhwa, Pune', 45: 'Mundhwa, Pune', 49: 'Mundhwa, Pune', 51: 'Mundhwa, Pune',
  57: 'Mundhwa, Pune', 63: 'Mundhwa, Pune', 64: 'Mundhwa, Pune', 65: 'Mundhwa, Pune', 66: 'Mundhwa, Pune',
  67: 'Mundhwa, Pune', 69: 'Mundhwa, Pune', 71: 'Mundhwa, Pune', 77: 'Mundhwa, Pune',
  80: 'Kharadi, Pune', 86: 'Kharadi, Pune', 90: 'Kharadi, Pune', 97: 'Kharadi, Pune', 98: 'Kharadi, Pune',
  73: 'Viman Nagar, Pune', 74: 'Viman Nagar, Pune', 102: 'Viman Nagar, Pune',
  106: 'NIBM, Pune', 107: 'NIBM, Pune', 108: 'NIBM, Pune', 116: 'NIBM, Pune',
  94: 'Hadapsar, Pune', 'codename-autobiography': 'Hadapsar, Pune',
  105: 'Lulla Nagar, Pune', 157: 'Koregaon Park, Pune', 117: 'Wakad, Pune',
  110: 'Loni Kalbhor, Pune', 112: 'Loni Kalbhor, Pune',
  172: 'Sanpada, Navi Mumbai', 174: 'Digha, Airoli, Navi Mumbai', 176: 'Airoli, Navi Mumbai',
};

const DEVELOPERS = {
  14: 'Majestique Landmark', 33: 'Panchshil Realty', 44: 'Omicron', 45: 'Amar Builders',
  58: 'A Advani Realty', 65: 'Ram India Group', 67: 'Panchshil Realty', 72: 'A Advani Realty',
  80: 'Goel Ganga Developments', 86: 'Kundan Spaces', 90: 'Panchshil Realty', 97: 'Lodha', 98: 'Lodha',
  105: 'Nyati Group', 106: 'Tribeca Developers', 107: 'Tribeca Developers', 108: 'K Raheja Corp',
  117: 'Lodha', 141: 'Platinum Corp', 142: 'Platinum Corp', 172: 'Godrej Properties',
  'codename-autobiography': 'Jhamtani Group',
};

// The duplicate #116 that moves to a free number.
const DUPLICATE_ID = '2f813591-6a0e-4654-8530-e862829b9ae3'; // Codename Autobiography by Jhamtani

const filled = (v) => (typeof v === 'string' ? v.trim().length > 0 : v != null && v !== false);
const clean = (v) => String(v || '').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();

const STATUS_PHRASE = { construction: 'an under-construction', upcoming: 'an upcoming', available: 'a ready-to-move', sold: 'a sold-out' };

/** Factual one-paragraph description built only from the pin's own fields. */
function describe(p) {
  const title = clean(p.title);
  const type = clean(p.type).toLowerCase();
  const isLand = /land/i.test(type) || /^land\b/i.test(title);
  const noun = isLand ? 'land parcel' : `${type && type !== 'property' ? `${type} ` : ''}project`;
  const status = STATUS_PHRASE[p.status] || 'a';
  const s = [];
  let first = `${title} is ${status} ${noun}`;
  if (filled(p.developer)) first += ` by ${clean(p.developer)}`;
  if (filled(p.location)) first += ` in ${clean(p.location)}`;
  s.push(`${first}.`);

  const config = clean(p.configuration);
  const price = clean(p.price);
  const hasPrice = /₹|\bcr\b|\blacs?\b|\blakhs?\b|\bL\b/i.test(price);
  const from = /onwards|\+/i.test(price);
  const bare = price.replace(/\s*onwards/i, '');
  if (config && /bhk|office|shop|showroom|retail|villa|studio|suite|plot|commercial|jodi|duplex/i.test(config)) {
    s.push(`It offers ${config}${hasPrice ? (from ? `, with prices from ${bare}` : `, priced at ${price}`) : ''}.`);
  } else if (hasPrice) {
    s.push(from ? `Prices start from ${bare}.` : `It is priced at ${price}.`);
  }

  const poss = clean(p.possession_timeline);
  if (/nearing possession/i.test(poss)) s.push('The project is nearing possession.');
  // Skip dates that are clearly typos in the source data (e.g. "Dec 1930").
  else if (poss && p.status !== 'sold' && !/\b(19\d\d|20[01]\d|202[0-3])\b/.test(poss)) s.push(`Possession is expected by ${poss}.`);

  const rera = clean(p.rera_number);
  if (/^P[A-Z0-9]{8,}/i.test(rera)) s.push(`It is registered with MahaRERA under ${rera.split(/\s/)[0]}.`);

  s.push('See its exact location, nearby infrastructure and surrounding projects on the Mappingg live map.');
  return s.join(' ');
}

function poolConfig(connectionString) {
  const url = new URL(connectionString);
  const mode = url.searchParams.get('sslmode');
  if (mode === 'disable') return { connectionString };
  url.searchParams.delete('sslmode');
  return { connectionString: url.toString(), ssl: mode ? true : { rejectUnauthorized: false } };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required (run with --env-file=.env).');
  const pool = new pg.Pool(poolConfig(process.env.DATABASE_URL));
  try {
    // Full docs (images included) so the backup is a faithful copy.
    const { rows } = await pool.query(`select id, doc from pins`);
    const usedNumbers = new Set(rows.map((r) => Number(r.doc.number)));
    let freeNumber = Math.max(...usedNumbers) + 1;

    const backups = [];
    const updates = [];
    const counts = { location: 0, developer: 0, price: 0, description: 0, number: 0 };

    for (const { id, doc } of rows) {
      if (doc.hidden === true) continue;
      const key = id === DUPLICATE_ID ? 'codename-autobiography' : Number(doc.number);
      const patch = {};

      if (id === DUPLICATE_ID && Number(doc.number) === 116) {
        patch.number = freeNumber++;
        counts.number++;
      }
      if (!filled(doc.location) && LOCATIONS[key]) { patch.location = LOCATIONS[key]; counts.location++; }
      if (!filled(doc.developer) && DEVELOPERS[key]) { patch.developer = DEVELOPERS[key]; counts.developer++; }
      if (!filled(doc.price) && doc.status !== 'sold') { patch.price = 'Price on Request'; counts.price++; }
      if (!filled(doc.description) && filled(doc.title)) {
        patch.description = describe({ ...doc, ...patch, price: filled(doc.price) ? doc.price : '' });
        counts.description++;
      }
      if (!Object.keys(patch).length) continue;

      patch.updated_at = new Date().toISOString();
      backups.push({ id, doc });
      updates.push({ id, number: doc.number, title: doc.title, patch });
    }

    for (const u of updates.slice(0, 12)) console.log(`#${u.number} ${u.title}:`, JSON.stringify(u.patch));
    console.log(`… ${updates.length} pins to update`, counts);
    const unmapped = rows.filter((r) => r.doc.hidden !== true && !filled(r.doc.location) && !LOCATIONS[r.id === DUPLICATE_ID ? 'codename-autobiography' : Number(r.doc.number)]);
    if (unmapped.length) console.log('Still without a location:', unmapped.map((r) => `#${r.doc.number} ${r.doc.title}`));

    if (!APPLY) {
      console.log('\nDry run — nothing written. Re-run with --apply.');
      return;
    }

    const file = `migration/backup/pin-seo-fill-${Date.now()}.json`;
    await writeFile(file, JSON.stringify(backups, null, 2));
    console.log(`Backup of original documents: ${file}`);

    for (const u of updates) {
      // jsonb || merges only the patched keys; every other field stays as-is.
      await pool.query(`update pins set doc = doc || $2::jsonb where id = $1`, [u.id, JSON.stringify(u.patch)]);
    }
    console.log(`Updated ${updates.length} pins.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

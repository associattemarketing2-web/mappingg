// Turns the free-text locations people type ("Mundhwa, Pune", "Mundhwa /
// Magarpatta", "Upper Kharadi,  Wagholi", "Mundwa Pune") into clean locality
// names, so accounts and leads can be grouped and filtered location-wise.
//
// Known localities (incl. common misspellings) are matched anywhere in the
// text; if none match, the first meaningful part of the text is used as-is.

const KNOWN: [string, RegExp][] = [
  // Pune
  ['Mundhwa', /\bmun?dh?wa\b|\bmundha\b/i],
  ['Kharadi', /\bkhara?di\b/i],
  ['Magarpatta', /\bmagarpatta\b/i],
  ['Hadapsar', /\bhadapsar\b/i],
  ['Viman Nagar', /\bviman\s*nagar\b/i],
  ['Wagholi', /\bwagholi\b/i],
  ['Kothrud', /\bkothrud\b/i],
  ['Baner', /\bbaner\b/i],
  ['Balewadi', /\bbalewadi\b/i],
  ['Hinjewadi', /\bhinj[ae]wadi\b/i],
  ['Kalyani Nagar', /\bkalyani\s*nagar\b/i],
  ['Koregaon Park', /\bkoregaon\s*park\b/i],
  ['Wadgaon Sheri', /\bwadgaon\s*sh?eri\b|\bwadgaonshri\b/i],
  ['Dhanori', /\bdhanori\b/i],
  ['NIBM', /\bnibm\b/i],
  ['Mohammadwadi', /\bmoh[ae]mm[ae]dwadi\b/i],
  ['Kondhwa', /\bkondhwa\b/i],
  ['Undri', /\bundri\b/i],
  ['Wakad', /\bwakad\b/i],
  ['Aundh', /\baundh?\b/i],
  ['Warje', /\bwarje\b/i],
  ['Mahalunge', /\bmahalunge\b/i],
  ['Manjri', /\bmanjri\b/i],
  ['Talegaon', /\btalegaon\b/i],
  // Mumbai region
  ['Andheri', /\bandheri\b/i],
  ['Khar', /\bkhar\b/i],
  ['Bandra', /\bbandra\b/i],
  ['Vashi', /\bvashi\b/i],
  ['Nerul', /\bnerul\b/i],
  ['Kharghar', /\bkharghar\b/i],
  ['Airoli', /\bairoli\b/i],
  ['Juinagar', /\bjuinagar\b/i],
  ['Thane', /\bthane\b/i],
  ['Dombivli', /\bdombiv[ae]?li\b/i],
  ['Palava', /\bpall?ava\b/i],
  ['Kalyan', /\bkalyan\b/i],
  ['Manpada', /\bmanpada\b/i],
];

// Parts that are a city/state/country or an address fragment, not a locality.
const NOISE = /^(pune|mumbai|navi mumbai|maharashtra|india|mh|road|rd)$/i;
const CITY = /^(pune|mumbai|navi mumbai)$/i;

// Capitalise words typed in lower case; leave words with capitals (PCMC, II, NX) as typed.
const titleCase = (s: string) =>
  s.split(' ').map((w) => (w && w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

/** Clean locality names found in a free-text location (may be several). */
export function localitiesOf(text?: unknown): string[] {
  const raw = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (!raw) return [];

  // In the order they appear in the text.
  const found = KNOWN
    .map(([name, re]) => ({ name, at: raw.search(re) }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((m) => m.name);
  if (found.length) return found;

  // Nothing recognised: use the first meaningful part of the text, or failing
  // that the city it names (someone who only typed "Pune").
  let city = '';
  for (const part of raw.split(/[,/;|&\n]+/)) {
    const p = part.replace(/^\s*(near|opp\.?|opposite)\s+/i, '').replace(/\.+$/, '').trim();
    if (!city && CITY.test(p)) city = titleCase(p.toLowerCase());
    if (!p || NOISE.test(p) || /^\d/.test(p)) continue;
    return [titleCase(p)];
  }
  return city ? [city] : [];
}

/** Unique localities across several free-text values, in first-seen order. */
export function localitiesOfAll(values: unknown[]): string[] {
  const out: string[] = [];
  for (const v of values) for (const l of localitiesOf(v)) if (!out.includes(l)) out.push(l);
  return out;
}

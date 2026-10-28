// Shared by the server (lib/developers.ts) and the admin Developers panel.
//
// companyKey(): the same company written different ways gets the same key —
// "GODREJ PROPERTIES LIMITED", "Godrej Properties", "M/s. Godrej Properties Pvt Ltd".
// Ignores case, punctuation and spacing ("ARKA BUILD CON" = "Arka Buildcon"),
// legal words (Pvt, Ltd, Limited, LLP, M/s, India…), anything in brackets, a city
// at the end ("Balaji Homes Bangalore"), a trailing "s" and doubled letters
// ("Modern Spaaces"). Names that only share a first word ("Kolte Patil" and
// "Kolte-Patil Integrated Townships") get different keys — those stay for review.

const LEGAL = new Set(['pvt', 'private', 'ltd', 'limited', 'llp', 'liability', 'partnership', 'co', 'company', 'inc', 'india', 'm', 's', 'ms', 'the', 'and']);
const CITY = new Set(['bangalore', 'bengaluru', 'pune', 'mumbai', 'noida', 'hyderabad', 'gurgaon', 'gurugram', 'chennai', 'delhi']);

const words = (s: unknown) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

export function companyKey(name: unknown): string {
  const t = words(name).filter((w) => !LEGAL.has(w));
  while (t.length > 1 && CITY.has(t[t.length - 1])) t.pop();
  return t.join('').replace(/s\b/g, '').replace(/(.)\1+/g, '$1');
}

/** The nicest of several spellings to show: no legal words, not ALL CAPS, then the shortest. */
export function displayName(names: string[]): string {
  const legal = (n: string) => words(n).some((w) => LEGAL.has(w) && w !== 'and');
  const caps = (n: string) => n === n.toUpperCase() && /[A-Z]{3}/.test(n);
  return [...names].sort((a, b) => Number(legal(a)) - Number(legal(b)) || Number(caps(a)) - Number(caps(b)) || a.length - b.length)[0];
}

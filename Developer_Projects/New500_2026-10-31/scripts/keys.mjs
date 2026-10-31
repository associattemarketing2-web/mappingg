// Normalised keys for duplicate checks, shared by the audit and the per-state collectors.

/** RERA number without spaces, punctuation or case: "P52100 012345" and "p52100012345" match. */
export const reraKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null;

const STOP = /\b(the|by|at|in|phase|ph|tower|towers|wing|block|project|residency|residences?|apartments?|homes?|enclave|new|launch)\b/g;
/** Project name reduced to its distinctive words ("Prestige Lakeside Habitat Phase 2" -> "prestige lakeside habitat 2"). */
export const nameKey = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(STOP, ' ').replace(/\s+/g, ' ').trim() || null;

const LEGAL = /\b(private|pvt|limited|ltd|llp|india|developers?|builders?|constructions?|infra(structure)?|projects?|realty|realtors?|estates?|properties|housing|homes|promoters?|group|and|co|company|the|m s|ms)\b/g;
/** Developer name without legal suffixes ("SOBHA LIMITED" -> "sobha"). */
export const devKey = (s) => String(s || '').toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(LEGAL, ' ').replace(/\s+/g, ' ').trim() || null;

/** Distance in metres between two points. */
export function metres(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

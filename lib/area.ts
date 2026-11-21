// Area as typed on a pin ("1166 – 2345", "1166 – 2345 sq ft", "2 acres") with the unit
// shown once: " sq.ft" is added only to a number that doesn't already name a unit
// ("1200sqft" counts — the unit may follow the digits directly).
const UNIT = /(?<![a-z])(sq\.?\s*(ft|feet|mt?r?s?|m|yd|yards?)|sqft|sqm|sft|square|acres?|hectares?|guntha)(?![a-z])|ft²|m²/i;

export function withSqft(area: unknown): string {
  const v = typeof area === 'string' ? area.trim() : typeof area === 'number' && Number.isFinite(area) ? String(area) : '';
  if (!v) return '';
  return UNIT.test(v) || !/\d/.test(v) ? v : `${v} sq.ft`;
}

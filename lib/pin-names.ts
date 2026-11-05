// Project-name helpers shared by the super-admin Pins Data API and panel.

/**
 * A project's name without its phase / tower / wing part:
 * "DOSTI EASTERN BAY - PHASE 3" → "DOSTI EASTERN BAY", "Golfland VII and VIII" → "Golfland".
 * Used to spot phases of one project and to suggest a name when merging them.
 */
export function baseName(title: string): string {
  let s = title.replace(/\s*[-–—,(:|]?\s*\b(phase|ph|tower|towers|wing|wings|block|blocks|bldg|building|stage|cluster|plot|parcel|sector)\b.*$/i, '');
  // Trailing part numbers: "2", "2A", "II", "B", "and VI", "& 2".
  const tail = /[\s\-–—,(&]+(?:and|&|[ivx]+|\d+[a-z]?|[a-z])\)?\s*$/i;
  for (let i = 0; i < 6 && tail.test(s); i++) s = s.replace(tail, '');
  return s.replace(/[\s\-–—,(:|]+$/, '').trim();
}

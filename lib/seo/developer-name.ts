// Display form of a developer name: "KRISALA DEVELOPERS" → "Krisala Developers",
// "Platinum  Corp" → "Platinum Corp". Display only — the stored value is untouched,
// and slugify() ignores case and repeated spaces, so URLs don't change.
//
// - Names already typed in mixed case are kept exactly as typed (brand spellings
//   such as "DS-MAX Properties" or "K Raheja Corp" stay as they are).
// - In ALL-CAPS names, acronyms (SSPL, LLP…) and vowel-less tokens stay upper-case.
// - Spellings are never "corrected" and different names are never merged; see
//   seo-doc for the duplicate candidates that need a human decision.

const KEEP_UPPER = new Set(['LLP', 'LLC', 'SSPL', 'PCPL', 'DLF', 'NCC', 'NPS', 'VTP', 'ADI', 'GRC', 'TCG', 'HDIL', 'MHADA', 'CIDCO', 'II', 'III']);
const LOWER_WORDS = new Set(['and', 'of', 'by', 'the', 'at']);
// Company-form abbreviations have no vowels but are not acronyms.
const ABBREVIATIONS: Record<string, string> = { PVT: 'Pvt', 'PVT.': 'Pvt.', LTD: 'Ltd', 'LTD.': 'Ltd.' };

export function displayDeveloperName(raw?: string): string {
  const name = (raw || '').replace(/\s+/g, ' ').trim();
  // "M/s. KNS INFRA PLOTLUXE LLP": the honorific is mixed case, the name is not.
  const ms = /^(m\/s\.?)\s+(.+)$/i.exec(name);
  if (ms) return `${ms[1].endsWith('.') ? 'M/s.' : 'M/s'} ${displayDeveloperName(ms[2])}`;
  if (!name || name !== name.toUpperCase() || !/[A-Z]{3}/.test(name)) return name;
  return name
    .split(' ')
    .map((word, i) =>
      word
        .split('-')
        .map((part) => {
          if (ABBREVIATIONS[part]) return ABBREVIATIONS[part];
          const lower = part.toLowerCase();
          if (i > 0 && LOWER_WORDS.has(lower)) return lower;
          if (KEEP_UPPER.has(part) || (part.length <= 4 && !/[AEIOU]/.test(part))) return part;
          return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join('-'),
    )
    .join(' ');
}

/**
 * Display form of a locality typed or imported in capitals: "VILLAGE- GADAULI KALAN"
 * → "Village Gadauli Kalan", "SECTOR- 76" → "Sector 76". A hyphen with a space on
 * one side only is a typing slip, so it becomes a space. slugify() gives the same
 * slug either way, so locality URLs don't change.
 */
export function displayPlaceName(raw?: string): string {
  const name = (raw || '').replace(/\s+-\s*|\s*-\s+/g, ' ').replace(/\s+/g, ' ').trim();
  return displayDeveloperName(name);
}

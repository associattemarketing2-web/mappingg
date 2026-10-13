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

export function displayDeveloperName(raw?: string): string {
  const name = (raw || '').replace(/\s+/g, ' ').trim();
  if (!name || name !== name.toUpperCase() || !/[A-Z]{3}/.test(name)) return name;
  return name
    .split(' ')
    .map((word, i) =>
      word
        .split('-')
        .map((part) => {
          if (KEEP_UPPER.has(part) || (part.length <= 4 && !/[AEIOU]/.test(part))) return part;
          const lower = part.toLowerCase();
          if (i > 0 && LOWER_WORDS.has(lower)) return lower;
          return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join('-'),
    )
    .join(' ');
}

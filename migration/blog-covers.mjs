// Illustrated 1200x630 blog covers (also the Open Graph / Twitter card image).
//
// Every article gets its own theme — colour palette + illustration — so no two
// covers look alike. Everything is vector (SVG rendered by sharp), so covers
// never depend on third-party project photos or developer logos.
//
// Used by migration/seed-blogs.mjs; preview without the DB with
//   node migration/blog-covers.mjs <out-dir>

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

export const W = 1200, H = 630;
const FONT = `'Segoe UI', 'Inter', Arial, sans-serif`;

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Deterministic pseudo-random numbers, so re-running gives identical covers. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** A grid of lit / unlit windows on a building face. */
function windows(x, y, w, h, { cols, rows, lit, dim, seed = 1, pad = 8, density = 0.55 }) {
  const r = rng(seed);
  const cw = (w - pad * 2) / cols, rh = (h - pad * 2) / rows;
  let out = '';
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const on = r() < density;
      out += `<rect x="${(x + pad + i * cw + cw * 0.18).toFixed(1)}" y="${(y + pad + j * rh + rh * 0.2).toFixed(1)}" width="${(cw * 0.64).toFixed(1)}" height="${(rh * 0.6).toFixed(1)}" rx="1.5" fill="${on ? lit : dim}"${on ? '' : ' opacity=".55"'}/>`;
    }
  }
  return out;
}

/** Map pin glyph with its tip at (x, y). */
function pin(x, y, fill, s = 1, dot = '#fff') {
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <ellipse cx="0" cy="2" rx="9" ry="3.5" fill="#000" opacity=".25"/>
    <path d="M0 0 C -6 -12 -17 -20 -17 -33 A 17 17 0 1 1 17 -33 C 17 -20 6 -12 0 0 Z" fill="${fill}"/>
    <circle cx="0" cy="-33" r="6.5" fill="${dot}"/></g>`;
}

// ---- illustrations (each draws inside the right-hand area, x ≈ 680–1170) ------

const ART = {
  /** Dusk skyline over the river — Mundhwa. */
  skyline(t) {
    const back = [[690, 300, 70], [770, 250, 58], [838, 330, 64], [912, 205, 74], [996, 285, 60], [1066, 230, 80]];
    const front = [[700, 380, 88, 3], [798, 300, 66, 4], [874, 360, 96, 5], [980, 270, 70, 6], [1060, 340, 104, 7]];
    return `
      <circle cx="1010" cy="170" r="74" fill="${t.accent}" opacity=".95"/>
      <circle cx="1010" cy="170" r="120" fill="${t.accent}" opacity=".12"/>
      ${back.map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="${520 - y}" fill="${t.ink}" opacity=".45"/>`).join('')}
      ${front.map(([x, y, w, s]) => `<rect x="${x}" y="${y}" width="${w}" height="${520 - y}" rx="4" fill="${t.ink}"/>
        <rect x="${x}" y="${y}" width="${w}" height="6" fill="${t.accent}" opacity=".7"/>
        ${windows(x, y + 10, w, 510 - y, { cols: Math.round(w / 22), rows: Math.round((510 - y) / 26), lit: t.accent, dim: '#ffffff22', seed: s })}`).join('')}
      <rect x="680" y="520" width="520" height="110" fill="${t.ink}" opacity=".6"/>
      ${[0, 1, 2, 3, 4].map((i) => `<rect x="${720 + i * 86}" y="${540 + (i % 2) * 22}" width="${40 + (i % 3) * 14}" height="4" rx="2" fill="${t.accent}" opacity=".45"/>`).join('')}
      <path d="M680 520 Q 900 506 1200 524" stroke="${t.accent}" stroke-width="2" fill="none" opacity=".6"/>`;
  },

  /** Stylised city map with river, roads and locality pins — Pune overview. */
  map(t) {
    const pins = [[812, 236, 'Hinjewadi'], [930, 350, 'Baner'], [1078, 246, 'Kharadi'], [1040, 418, 'Mundhwa'], [892, 470, 'NIBM']];
    return `
      <g transform="rotate(-6 925 330)">
        <clipPath id="mapcard"><rect x="700" y="96" width="450" height="460" rx="28"/></clipPath>
        <rect x="700" y="96" width="450" height="460" rx="28" fill="${t.paper}"/>
        <g clip-path="url(#mapcard)">
        <path d="M700 300 C 800 260 880 380 980 330 S 1110 250 1150 290" stroke="${t.water}" stroke-width="22" fill="none" stroke-linecap="round"/>
        ${[[700, 180, 1150, 210], [700, 430, 1150, 400], [760, 96, 820, 556], [1000, 96, 960, 556], [700, 520, 1150, 470]]
          .map(([a, b, c, d]) => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="#fff" stroke-width="9"/>`).join('')}
        ${[[860, 130, 70, 40], [1050, 140, 60, 50], [720, 360, 60, 54], [1060, 450, 70, 50], [880, 490, 60, 40]]
          .map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${t.park}"/>`).join('')}
        <path d="M812 236 C 870 300 900 330 930 350 S 1010 420 1040 418 S 1060 300 1078 246" stroke="${t.ink}" stroke-width="4" stroke-dasharray="2 12" stroke-linecap="round" fill="none"/>
      </g></g>
      ${pins.map(([x, y, label], i) => `${pin(x, y, i === 2 ? t.accent : t.ink, 1.05)}
        <rect x="${x - label.length * 5.4 - 12}" y="${y + 10}" width="${label.length * 10.8 + 24}" height="28" rx="14" fill="#fff"/>
        <text x="${x}" y="${y + 30}" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="700" fill="${t.ink}">${label}</text>`).join('')}`;
  },

  /** Glass office towers of an IT park — Kharadi. */
  towers(t) {
    const tw = [[720, 250, 92], [826, 150, 110], [952, 210, 96], [1062, 300, 90]];
    return `
      <circle cx="930" cy="300" r="230" fill="${t.accent}" opacity=".08"/>
      ${tw.map(([x, y, w], i) => `
        <path d="M${x} ${y + 24} L${x + w / 2} ${y} L${x + w} ${y + 24} V540 H${x} Z" fill="${t.ink}"/>
        <path d="M${x + w / 2} ${y} L${x + w} ${y + 24} V540 H${x + w / 2} Z" fill="#fff" opacity=".07"/>
        ${Array.from({ length: Math.floor((516 - y) / 18) }, (_, k) => `<rect x="${x + 8}" y="${y + 34 + k * 18}" width="${w - 16}" height="9" rx="2" fill="${t.accent}" opacity="${(0.15 + ((k * 7 + i * 3) % 10) / 22).toFixed(2)}"/>`).join('')}
        <line x1="${x + w / 2}" y1="${y}" x2="${x + w / 2}" y2="${y - 26}" stroke="${t.accent}" stroke-width="3"/>
        <circle cx="${x + w / 2}" cy="${y - 28}" r="4" fill="${t.accent}"/>`).join('')}
      <rect x="690" y="540" width="480" height="8" rx="4" fill="${t.accent}" opacity=".7"/>
      ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${700 + i * 68}" y="566" width="36" height="5" rx="2.5" fill="#fff" opacity=".25"/>`).join('')}`;
  },

  /** Registration certificate + verified shield — MahaRERA guide. */
  shield(t) {
    return `
      <g transform="rotate(5 900 330)">
        <rect x="730" y="110" width="330" height="430" rx="22" fill="${t.paper}"/>
        <rect x="730" y="110" width="330" height="70" rx="22" fill="${t.accent}"/>
        <rect x="730" y="158" width="330" height="22" fill="${t.accent}"/>
        <text x="760" y="155" font-family="${FONT}" font-size="22" font-weight="800" fill="${t.ink}" letter-spacing="2">MahaRERA</text>
        <text x="762" y="226" font-family="Consolas, monospace" font-size="22" font-weight="700" fill="${t.ink}">PR1260002500852</text>
        ${[262, 296, 330, 364, 398, 432].map((y, i) => `<rect x="762" y="${y}" width="${[250, 200, 266, 180, 236, 150][i]}" height="12" rx="6" fill="${t.ink}" opacity=".16"/>`).join('')}
        <circle cx="990" cy="480" r="34" fill="none" stroke="${t.accent}" stroke-width="5" stroke-dasharray="6 5"/>
      </g>
      <g transform="translate(1010 318)">
        <circle r="150" fill="${t.accent}" opacity=".12"/>
        <path d="M0 -118 L96 -82 V-6 C96 62 50 104 0 124 C-50 104 -96 62 -96 -6 V-82 Z" fill="${t.accent}"/>
        <path d="M0 -96 L76 -67 V-6 C76 50 40 84 0 101 C-40 84 -76 50 -76 -6 V-67 Z" fill="${t.ink}"/>
        <path d="M-38 2 L-10 30 L44 -28" stroke="${t.accent}" stroke-width="17" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </g>`;
  },

  /** Sunrise over the hills with a new township — West Pune IT belt. */
  hills(t) {
    return `
      <circle cx="960" cy="300" r="110" fill="${t.accent}"/>
      <circle cx="960" cy="300" r="170" fill="${t.accent}" opacity=".15"/>
      <path d="M680 380 C 760 300 820 300 890 360 S 1030 280 1200 350 V630 H680 Z" fill="${t.ink}" opacity=".45"/>
      ${[[760, 240, 54, 11], [826, 200, 60, 12], [1040, 230, 56, 13], [1104, 270, 50, 14]].map(([x, y, w, s]) => `
        <rect x="${x}" y="${y}" width="${w}" height="${480 - y}" rx="4" fill="${t.ink}"/>
        ${windows(x, y + 4, w, 470 - y, { cols: 3, rows: Math.round((470 - y) / 24), lit: t.accent, dim: '#ffffff1a', seed: s, density: 0.5 })}`).join('')}
      <path d="M680 470 C 800 420 900 440 960 470 S 1100 430 1200 450 V630 H680 Z" fill="${t.ink}"/>
      <path d="M760 630 C 840 560 980 560 940 500 S 1000 460 1060 470" stroke="${t.accent}" stroke-width="7" fill="none" stroke-dasharray="18 12" stroke-linecap="round" opacity=".8"/>
      ${[[720, 520], [1120, 520], [1150, 560], [700, 580]].map(([x, y]) => `<path d="M${x} ${y} l14 -40 l14 40 Z" fill="${t.park}"/>`).join('')}`;
  },

  /** Elevated metro line with stations — Pimpri-Chinchwad. */
  metro(t) {
    const st = [[722, 'Ravet'], [826, 'Akurdi'], [934, 'Chinchwad'], [1040, 'Pimpri'], [1136, 'Dapodi']];
    return `
      ${[[700, 230, 70, 11], [786, 170, 64, 12], [880, 250, 82, 13], [990, 190, 70, 14], [1080, 240, 80, 15]].map(([x, y, w, s]) => `
        <rect x="${x}" y="${y}" width="${w}" height="${380 - y}" rx="4" fill="${t.ink}" opacity=".55"/>
        ${windows(x, y + 4, w, 370 - y, { cols: 3, rows: Math.round((370 - y) / 24), lit: t.accent, dim: '#ffffff14', seed: s, density: 0.4 })}`).join('')}
      <rect x="680" y="380" width="520" height="22" fill="${t.ink}"/>
      ${[740, 880, 1020, 1160].map((x) => `<rect x="${x - 12}" y="402" width="24" height="140" fill="${t.ink}"/>`).join('')}
      <g transform="translate(760 330)">
        <rect width="330" height="50" rx="16" fill="#fff"/>
        <rect x="0" y="34" width="330" height="8" fill="${t.accent}"/>
        ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${20 + i * 50}" y="10" width="34" height="18" rx="4" fill="${t.ink}" opacity=".85"/>`).join('')}
        <path d="M330 0 Q 372 2 372 34 V50 H330 Z" fill="#fff"/>
        <path d="M340 10 Q 362 12 364 30 H340 Z" fill="${t.ink}" opacity=".85"/>
      </g>
      <line x1="690" y1="470" x2="1200" y2="470" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".9"/>
      ${st.map(([x, n]) => `<circle cx="${x}" cy="470" r="12" fill="${t.accent}" stroke="#fff" stroke-width="5"/>
        <text x="${x}" y="508" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="700" fill="#fff" opacity=".9">${n}</text>`).join('')}
      <rect x="680" y="542" width="520" height="88" fill="${t.ink}" opacity=".7"/>`;
  },

  /** Plane taking off over the riverside towers — East Pune. */
  airport(t) {
    return `
      <path d="M700 470 C 820 430 930 330 1080 200" stroke="#fff" stroke-width="4" stroke-dasharray="4 14" stroke-linecap="round" fill="none" opacity=".7"/>
      <g transform="translate(1092 186) rotate(-36) scale(1.35)">
        <path d="M-60 0 C -60 -9 -50 -12 -40 -12 H48 C62 -12 72 -6 72 0 C72 6 62 12 48 12 H-40 C-50 12 -60 9 -60 0 Z" fill="#fff"/>
        <path d="M-6 -10 L-34 -70 H-16 L30 -10 Z M-6 10 L-34 70 H-16 L30 10 Z" fill="#fff"/>
        <path d="M-52 -8 L-66 -38 H-54 L-34 -8 Z M-52 8 L-66 38 H-54 L-34 8 Z" fill="#fff"/>
        ${[0, 1, 2, 3, 4].map((i) => `<circle cx="${-24 + i * 14}" cy="0" r="3" fill="${t.ink}" opacity=".6"/>`).join('')}
      </g>
      ${[[700, 330, 66, 21], [776, 280, 58, 22], [846, 360, 74, 23], [930, 300, 62, 24], [1002, 380, 70, 25], [1082, 340, 84, 26]].map(([x, y, w, s]) => `
        <rect x="${x}" y="${y}" width="${w}" height="${520 - y}" rx="4" fill="${t.ink}"/>
        ${windows(x, y + 4, w, 510 - y, { cols: 3, rows: Math.round((510 - y) / 26), lit: t.accent, dim: '#ffffff1a', seed: s, density: 0.45 })}`).join('')}
      <rect x="680" y="520" width="520" height="110" fill="${t.ink}" opacity=".85"/>
      ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="${690 + i * 62}" y="572" width="34" height="7" rx="3.5" fill="#fff" opacity=".8"/>`).join('')}
      <rect x="680" y="540" width="520" height="3" fill="${t.accent}" opacity=".8"/>
      <rect x="680" y="606" width="520" height="3" fill="${t.accent}" opacity=".8"/>`;
  },

  /** Crane on a half-built tower vs a finished home with a key — ready vs UC. */
  crane(t) {
    return `
      <rect x="700" y="300" width="130" height="240" rx="4" fill="${t.ink}"/>
      ${windows(700, 304, 130, 236, { cols: 5, rows: 8, lit: '#ffffff30', dim: '#ffffff10', seed: 31, density: 0.3 })}
      ${[0, 1, 2].map((i) => `<rect x="${700 + i * 2}" y="${300 - 40 - i * 40}" width="126" height="6" fill="${t.ink}" opacity=".6"/>
        <line x1="${704 + i * 2}" y1="${300 - 40 - i * 40}" x2="${704 + i * 2}" y2="300" stroke="${t.ink}" stroke-width="4" opacity=".6"/>
        <line x1="${822}" y1="${300 - 40 - i * 40}" x2="${822}" y2="300" stroke="${t.ink}" stroke-width="4" opacity=".6"/>`).join('')}
      <g stroke="${t.accent}" stroke-width="6" fill="none">
        <path d="M860 540 V120 M890 540 V120"/>
        ${Array.from({ length: 13 }, (_, k) => `<path d="M860 ${540 - k * 32} L890 ${508 - k * 32}"/>`).join('')}
        <path d="M700 120 H1000 M760 120 L875 70 L1000 120 M875 70 V120"/>
        <path d="M720 120 V230"/>
      </g>
      <rect x="704" y="230" width="34" height="26" rx="3" fill="${t.accent}"/>
      <rect x="990" y="112" width="34" height="34" rx="4" fill="${t.ink}"/>
      <g transform="translate(940 330)">
        <path d="M0 80 L110 0 L220 80 V210 H0 Z" fill="#fff"/>
        <path d="M-14 86 L110 -6 L234 86" stroke="${t.accent}" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="84" y="128" width="52" height="82" rx="6" fill="${t.ink}"/>
        <rect x="26" y="104" width="40" height="40" rx="4" fill="${t.ink}" opacity=".85"/>
        <rect x="154" y="104" width="40" height="40" rx="4" fill="${t.ink}" opacity=".85"/>
      </g>
      <g transform="translate(1130 300) rotate(35)">
        <circle r="26" fill="none" stroke="${t.accent}" stroke-width="12"/>
        <path d="M26 -6 H92 V6 H80 V24 H68 V6 H56 V20 H44 V6 H26 Z" fill="${t.accent}"/>
      </g>
      <rect x="680" y="540" width="520" height="90" fill="${t.ink}" opacity=".75"/>`;
  },
};

// ---- themes -----------------------------------------------------------------------

export const THEMES = {
  dusk:     { bg: ['#1d1b4b', '#4a2160'], ink: '#14123a', accent: '#ffb547', text: '#ffffff', sub: '#d9d2ff', art: 'skyline' },
  emerald:  { bg: ['#0c5a4a', '#073b33'], ink: '#123c33', accent: '#c6f36b', text: '#ffffff', sub: '#c8ead9', paper: '#eaf5ec', water: '#8fd0e8', park: '#bfe3b0', art: 'map' },
  midnight: { bg: ['#0a1f44', '#0c3a6b'], ink: '#081a38', accent: '#4fd8ff', text: '#ffffff', sub: '#bfe0ff', art: 'towers' },
  forest:   { bg: ['#0f5c47', '#0a3329'], ink: '#0b3d30', accent: '#e8c46a', text: '#ffffff', sub: '#d3e7dc', paper: '#fbf7ea', art: 'shield' },
  sunrise:  { bg: ['#5b1e4d', '#c2493d'], ink: '#3a1236', accent: '#ffd27a', text: '#ffffff', sub: '#ffe0d2', park: '#2c0f29', art: 'hills' },
  metro:    { bg: ['#182032', '#2a3a5c'], ink: '#0f1626', accent: '#ff5fa2', text: '#ffffff', sub: '#d0d8ef', art: 'metro' },
  sky:      { bg: ['#1765b8', '#0b3672'], ink: '#0a2a58', accent: '#ff9b42', text: '#ffffff', sub: '#d5e8ff', art: 'airport' },
  ember:    { bg: ['#3b1d12', '#7a3115'], ink: '#24110a', accent: '#ffc83d', text: '#ffffff', sub: '#f6dccb', art: 'crane' },
};

let markCache;
async function brandMark() {
  markCache ||= await sharp(await readFile(path.resolve('public/img/mappingg-icon-mark-sm.png')))
    .resize(44, 44, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return markCache;
}

/**
 * Render a cover.
 * @param {string} file  output .jpg path
 * @param {{ theme: keyof THEMES, kicker: string, lines: string[], stats?: [string, string][] }} spec
 *   lines: 2–3 headline lines; the last line is drawn in the accent colour.
 *   stats: up to 3 [value, label] chips under the headline.
 */
export async function makeCover(file, { theme, kicker, lines, stats = [] }) {
  const t = THEMES[theme];
  if (!t) throw new Error(`unknown cover theme ${theme}`);
  const size = lines.some((l) => l.length > 17) ? 52 : 58;
  const lineH = size + 10;
  const top = 196;
  const statsY = top + (lines.length - 1) * lineH + 52;
  const chipW = (v, l) => Math.max(v.length * 15.5, l.length * 8.2) + 36;
  let cx = 60;
  const chips = stats.slice(0, 3).map(([v, l]) => {
    const w = chipW(v, l);
    const g = `<g transform="translate(${cx} ${statsY})">
      <rect width="${w}" height="74" rx="16" fill="#fff" fill-opacity=".1" stroke="#fff" stroke-opacity=".22"/>
      <text x="18" y="34" font-family="${FONT}" font-size="26" font-weight="800" fill="${t.accent}">${esc(v)}</text>
      <text x="18" y="58" font-family="${FONT}" font-size="14" font-weight="600" fill="${t.sub}">${esc(l)}</text></g>`;
    cx += w + 14;
    return g;
  });

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.bg[0]}"/><stop offset="1" stop-color="${t.bg[1]}"/></linearGradient>
      <radialGradient id="glow" cx=".78" cy=".45" r=".55"><stop offset="0" stop-color="${t.accent}" stop-opacity=".22"/><stop offset="1" stop-color="${t.accent}" stop-opacity="0"/></radialGradient>
      <pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="#fff" opacity=".07"/></pattern>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <rect width="${W}" height="${H}" fill="url(#dots)"/>
    <rect width="${W}" height="${H}" fill="url(#glow)"/>
    <g>${ART[t.art](t)}</g>
    <rect x="60" y="70" rx="20" width="${Math.round(kicker.length * 12.6) + 52}" height="40" fill="${t.accent}"/>
    <circle cx="82" cy="90" r="5" fill="${t.ink}"/>
    <text x="96" y="97" font-family="${FONT}" font-size="17" font-weight="800" fill="${t.ink}" letter-spacing="2">${esc(kicker.toUpperCase())}</text>
    ${lines.map((l, i) => `<text x="60" y="${top + i * lineH}" font-family="${FONT}" font-size="${size}" font-weight="800" letter-spacing="-1" fill="${i === lines.length - 1 ? t.accent : t.text}">${esc(l)}</text>`).join('')}
    ${chips.join('')}
    <text x="114" y="${H - 52}" font-family="${FONT}" font-size="24" font-weight="800" fill="#fff">mappingg.com</text>
    <text x="114" y="${H - 30}" font-family="${FONT}" font-size="15" fill="${t.sub}">Pune’s live real-estate map</text>
  </svg>`;

  await sharp(Buffer.from(svg))
    .composite([{ input: await brandMark(), left: 60, top: H - 88 }])
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(file);
}

// Preview every theme without touching the database.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const out = process.argv[2] || '.';
  for (const theme of Object.keys(THEMES)) {
    await makeCover(path.join(out, `${theme}.jpg`), {
      theme,
      kicker: 'Locality guide',
      lines: ['New Projects in', 'Hinjewadi & Baner', '2026 Price Guide'],
      stats: [['17+', 'projects tracked'], ['₹82 L', 'starting price'], ['2026–31', 'possession']],
    });
    console.log(theme);
  }
}

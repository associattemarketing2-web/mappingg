// Photo-style 1200x630 blog covers (also the Open Graph / Twitter card image).
//
// Each cover is a full-bleed rendered scene — sky, sun glow, layered skyline with
// haze, lit buildings with depth, reflections, light trails, film grain and a
// vignette — with the headline over a soft scrim on the left. Every article gets
// its own scene and palette so no two covers look alike. Everything is vector
// (SVG rendered by sharp), so covers never depend on third-party project photos
// or developer logos (the pins' pictures are mostly developer logos).
//
// Used by migration/seed-blogs.mjs; preview without the DB with
//   node migration/blog-covers.mjs <out-dir>

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

export const W = 1200, H = 630;
const FONT = `'Segoe UI', 'Inter', Arial, sans-serif`;
const GROUND = 520;

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const f1 = (n) => n.toFixed(1);

/** Deterministic pseudo-random numbers, so re-running gives identical covers. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// ---- per-render state: gradient defs and the glow layer ---------------------------

let defs, glow, uid;
function reset() { defs = []; glow = []; uid = 0; }

/** A linear gradient; `stops` = [[offset, colour, opacity?], …]. Returns `url(#id)`. */
function lin(stops, [x1, y1, x2, y2] = [0, 0, 0, 1]) {
  const id = `g${++uid}`;
  defs.push(`<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops
    .map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`);
  return `url(#${id})`;
}
function rad(stops, cx = 0.5, cy = 0.5, r = 0.5) {
  const id = `g${++uid}`;
  defs.push(`<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops
    .map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`);
  return `url(#${id})`;
}

// ---- scene pieces -----------------------------------------------------------------

function sky(t) {
  let out = `<rect width="${W}" height="${GROUND + 20}" fill="${lin(t.sky.map((c, i) => [i / (t.sky.length - 1), c]))}"/>`;
  if (t.stars) {
    const r = rng(77);
    for (let i = 0; i < 140; i++) {
      const x = r() * W, y = r() * 330, s = r();
      out += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(0.5 + s * 1.1)}" fill="#fff" opacity="${(0.25 + s * 0.6).toFixed(2)}"/>`;
    }
  }
  if (t.sun) {
    const { x, y, r: sr, color, halo = color } = t.sun;
    out += `<circle cx="${x}" cy="${y}" r="${sr * 5}" fill="${rad([[0, halo, 0.55], [0.35, halo, 0.18], [1, halo, 0]])}"/>`;
    out += `<circle cx="${x}" cy="${y}" r="${sr}" fill="${rad([[0, '#fffbe8'], [0.7, color], [1, color, 0.9]])}"/>`;
  }
  if (t.clouds) {
    const r = rng(t.clouds.seed || 5);
    let c = '';
    for (let i = 0; i < t.clouds.n; i++) {
      const cx = 380 + r() * 820, cy = 60 + r() * 200, w = 90 + r() * 170;
      c += `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="${f1(w)}" ry="${f1(w * 0.16)}" fill="${t.clouds.color}" opacity="${(0.25 + r() * 0.35).toFixed(2)}"/>`;
      c += `<ellipse cx="${f1(cx + w * 0.2)}" cy="${f1(cy - w * 0.07)}" rx="${f1(w * 0.45)}" ry="${f1(w * 0.12)}" fill="${t.clouds.color}" opacity="${(0.2 + r() * 0.3).toFixed(2)}"/>`;
    }
    out += `<g filter="url(#blur12)">${c}</g>`;
  }
  return out;
}

/** Distant skyline silhouettes across the whole width, softened by haze. */
function farSkyline(t, { seed = 3, base = GROUND, min = 40, max = 170, color, opacity = 1, x0 = 0, lights = 0.15 } = {}) {
  const r = rng(seed);
  let out = '', x = x0;
  while (x < W) {
    const w = 26 + r() * 52, h = min + r() * (max - min);
    out += `<rect x="${f1(x)}" y="${f1(base - h)}" width="${f1(w)}" height="${f1(h)}" fill="${color}"/>`;
    if (r() < 0.3) out += `<rect x="${f1(x + w * 0.4)}" y="${f1(base - h - 14)}" width="2" height="14" fill="${color}"/>`;
    if (lights) {
      for (let k = 0; k < h / 14; k++) {
        if (r() < lights) out += `<rect x="${f1(x + 4 + r() * (w - 10))}" y="${f1(base - h + 6 + k * 13)}" width="3" height="3" fill="${t.lit[0]}" opacity=".7"/>`;
      }
    }
    x += w + r() * 6;
  }
  return `<g opacity="${opacity}">${out}</g>`;
}

/** Haze band that melts the far layers into the horizon. */
const haze = (t, y0 = 300, y1 = GROUND) =>
  `<rect x="0" y="${y0}" width="${W}" height="${y1 - y0}" fill="${lin([[0, t.haze, 0], [1, t.haze, t.hazeA ?? 0.55]])}"/>`;

/**
 * A building with a lit front face, a darker side face and a roof, drawn in
 * slight perspective. kind 'res' = apartments with balconies, 'glass' = office
 * curtain wall. Lit windows also go to the glow layer.
 */
function tower(t, o) {
  const { x, top, w, d = 24, base = GROUND, kind = 'res', floorH = 22, cols = Math.max(3, Math.round(w / 24)), seed = 1, lit = 0.45, crown = false, sideLit = t.sideLit } = o;
  const r = rng(seed);
  const rise = d * 0.42;
  const h = base - top;
  const face = sideLit ? t.side : t.face, side = sideLit ? t.face : t.side;
  let out = `
    <path d="M${x + w} ${top} L${x + w + d} ${top - rise} V${base} H${x + w} Z" fill="${lin([[0, side[0]], [1, side[1]]])}"/>
    <rect x="${x}" y="${top}" width="${w}" height="${h}" fill="${lin([[0, face[0]], [1, face[1]]])}"/>
    <path d="M${x} ${top} H${x + w} L${x + w + d} ${top - rise} H${x + d} Z" fill="${t.roof}"/>`;
  const floors = Math.floor((h - 12) / floorH);

  if (kind === 'res') {
    const cw = w / cols;
    for (let i = 0; i < floors; i++) {
      const fy = top + 10 + i * floorH;
      for (let c = 0; c < cols; c++) {
        const on = r() < lit;
        const wx = x + c * cw + cw * 0.16, ww = cw * 0.68, wy = fy + 4, wh = floorH - 9;
        if (on) {
          const col = t.lit[Math.floor(r() * t.lit.length)];
          const win = `<rect x="${f1(wx)}" y="${f1(wy)}" width="${f1(ww)}" height="${f1(wh)}" fill="${col}"/>`;
          out += win; glow.push(win);
        } else {
          out += `<rect x="${f1(wx)}" y="${f1(wy)}" width="${f1(ww)}" height="${f1(wh)}" fill="${t.glass}" opacity="${(0.7 + r() * 0.3).toFixed(2)}"/>`;
        }
      }
      // balcony slab + railing
      out += `<rect x="${x - 2}" y="${f1(fy + floorH - 4)}" width="${w + 4}" height="3" fill="${t.slab}" opacity=".75"/>`;
      out += `<path d="M${x + w} ${f1(fy + floorH - 3)} L${x + w + d} ${f1(fy + floorH - 3 - rise)}" stroke="${t.slab}" stroke-width="1.5" opacity=".35"/>`;
      const sOn = r() < lit * 0.6;
      const a = 0.25, b = 0.75, y1 = fy + 4, y2 = fy + floorH - 6;
      const sw = `<path d="M${f1(x + w + d * a)} ${f1(y1 - rise * a)} L${f1(x + w + d * b)} ${f1(y1 - rise * b)} L${f1(x + w + d * b)} ${f1(y2 - rise * b)} L${f1(x + w + d * a)} ${f1(y2 - rise * a)} Z" fill="${sOn ? t.lit[0] : t.glass}" opacity="${sOn ? 0.8 : 0.5}"/>`;
      out += sw; if (sOn) glow.push(sw);
    }
  } else {
    // curtain wall: lit office floors, mullions, a diagonal sky reflection
    for (let i = 0; i < floors; i++) {
      const fy = top + 8 + i * floorH;
      if (r() < lit) {
        const band = `<rect x="${x + 2}" y="${f1(fy + 2)}" width="${w - 4}" height="${floorH - 5}" fill="${t.office}" opacity="${(0.35 + r() * 0.45).toFixed(2)}"/>`;
        out += band; glow.push(band);
      }
      out += `<rect x="${x}" y="${f1(fy + floorH - 2)}" width="${w}" height="1.6" fill="#fff" opacity=".10"/>`;
    }
    for (let c = 1; c < cols; c++) out += `<rect x="${f1(x + (c * w) / cols)}" y="${top}" width="1.2" height="${h}" fill="#fff" opacity=".10"/>`;
    out += `<path d="M${x} ${top + h * 0.55} L${x + w} ${top + h * 0.15} V${top + h * 0.32} L${x} ${top + h * 0.72} Z" fill="${lin([[0, '#fff', 0], [0.5, '#fff', 0.16], [1, '#fff', 0]], [0, 0, 1, 1])}"/>`;
  }
  if (crown) {
    const cx = x + w / 2 + d / 2, cy = top - rise / 2;
    out += `<rect x="${f1(cx - 1.5)}" y="${f1(cy - 46)}" width="3" height="46" fill="${t.side[0]}"/>`;
    const light = `<circle cx="${f1(cx)}" cy="${f1(cy - 48)}" r="3.5" fill="#ff3b30"/>`;
    out += light; glow.push(light, light);
  }
  return out;
}

/** Soft tree canopies along the ground line. */
function trees(t, xs, { base = GROUND + 4, seed = 9, size = 1 } = {}) {
  const r = rng(seed);
  let out = '';
  for (const x of xs) {
    for (let k = 0; k < 4; k++) {
      const rr = (11 + r() * 13) * size;
      out += `<circle cx="${f1(x + (r() - 0.5) * 36 * size)}" cy="${f1(base - rr * 0.8 - r() * 10 * size)}" r="${f1(rr)}" fill="${t.tree[k % t.tree.length]}"/>`;
    }
  }
  return `<g filter="url(#blur1)">${out}</g>`;
}

function ground(t) {
  return `<rect x="0" y="${GROUND}" width="${W}" height="${H - GROUND}" fill="${lin([[0, t.ground[0]], [1, t.ground[1]]])}"/>`;
}

/** Long-exposure car light trails on the road. */
function lightTrails(t, { y = GROUND + 30, seed = 4, n = 12 } = {}) {
  const r = rng(seed);
  let out = `<rect x="0" y="${y - 6}" width="${W}" height="${n * 3.2 + 14}" fill="#000" opacity=".25"/>`;
  for (let i = 0; i < n; i++) {
    const red = i % 2 === 0;
    const x = 300 + r() * 300, w = 300 + r() * 600, yy = y + i * 3.2;
    const col = red ? '#ff4a3d' : '#fff2c6';
    const s = `<rect x="${f1(x)}" y="${f1(yy)}" width="${f1(w)}" height="1.8" rx=".9" fill="${lin([[0, col, 0], [0.2, col, 0.9], [0.85, col, 0.9], [1, col, 0]], [0, 0, 1, 0])}"/>`;
    out += s; glow.push(s);
  }
  return out;
}

/** River in front of the skyline with a blurred mirror image of `scene`. */
function water(t, scene, { y = GROUND } = {}) {
  const r = rng(12);
  let ripples = '';
  for (let i = 0; i < 70; i++) {
    const yy = y + 6 + r() ** 1.4 * (H - y - 6);
    ripples += `<rect x="${f1(380 + r() * 820)}" y="${f1(yy)}" width="${f1(20 + r() * 70)}" height="1.4" fill="${t.lit[0]}" opacity="${(0.15 + r() * 0.35).toFixed(2)}"/>`;
  }
  return `
    <rect x="0" y="${y}" width="${W}" height="${H - y}" fill="${lin([[0, t.water[0]], [1, t.water[1]]])}"/>
    <g clip-path="url(#below)" opacity=".38" filter="url(#blur3)"><g transform="translate(0 ${2 * y}) scale(1 -1)">${scene}</g></g>
    ${ripples}
    <rect x="0" y="${y}" width="${W}" height="2" fill="${t.lit[0]}" opacity=".35"/>`;
}

// ---- hero props -------------------------------------------------------------------

/** A glossy 3D map pin with its tip at (x, y) and a label pill. */
function mapPin(t, x, y, label, { color = t.accent, s = 1 } = {}) {
  const body = lin([[0, '#ffffff', 0.55], [0.35, color], [1, color]], [0.2, 0, 0.8, 1]);
  const lw = label.length * 9.6 + 28;
  return `
    <ellipse cx="${x}" cy="${y + 3}" rx="${16 * s}" ry="${5 * s}" fill="${color}" opacity=".35" filter="url(#blur3)"/>
    <ellipse cx="${x}" cy="${y + 3}" rx="${30 * s}" ry="${9 * s}" fill="none" stroke="${color}" stroke-width="2" opacity=".5"/>
    <g transform="translate(${x} ${y}) scale(${s})" filter="url(#shadow)">
      <path d="M0 0 C -7 -14 -22 -26 -22 -44 A 22 22 0 1 1 22 -44 C 22 -26 7 -14 0 0 Z" fill="${color}"/>
      <path d="M0 0 C -7 -14 -22 -26 -22 -44 A 22 22 0 1 1 22 -44 C 22 -26 7 -14 0 0 Z" fill="${body}"/>
      <circle cx="0" cy="-44" r="8.5" fill="#fff"/>
    </g>
    <g filter="url(#shadow)">
      <rect x="${f1(x - lw / 2)}" y="${f1(y - 54 * s - 66)}" width="${f1(lw)}" height="34" rx="17" fill="#fff" opacity=".96"/>
      <text x="${x}" y="${f1(y - 54 * s - 43)}" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="800" fill="${t.ink}">${esc(label)}</text>
    </g>`;
}

/** A MahaRERA registration certificate with a QR code, and a verified shield. */
function certificate(t) {
  const r = rng(21);
  let qr = '';
  const q = 21, cs = 4.6, qx = 912, qy = 382;
  const finder = (fx, fy) => (fx < 7 && fy < 7) || (fx >= q - 7 && fy < 7) || (fx < 7 && fy >= q - 7);
  for (let i = 0; i < q; i++) for (let j = 0; j < q; j++) if (!finder(i, j) && r() < 0.5) qr += `<rect x="${f1(qx + i * cs)}" y="${f1(qy + j * cs)}" width="${cs}" height="${cs}" fill="${t.ink}"/>`;
  for (const [fx, fy] of [[0, 0], [q - 7, 0], [0, q - 7]]) {
    const X = qx + fx * cs, Y = qy + fy * cs;
    qr += `<rect x="${f1(X)}" y="${f1(Y)}" width="${f1(7 * cs)}" height="${f1(7 * cs)}" fill="${t.ink}"/><rect x="${f1(X + cs)}" y="${f1(Y + cs)}" width="${f1(5 * cs)}" height="${f1(5 * cs)}" fill="#fff"/><rect x="${f1(X + 2 * cs)}" y="${f1(Y + 2 * cs)}" width="${f1(3 * cs)}" height="${f1(3 * cs)}" fill="${t.ink}"/>`;
  }
  return `
    <g transform="rotate(-4 870 330)">
      <rect x="712" y="118" width="330" height="420" rx="14" fill="#000" opacity=".45" filter="url(#blur12)" transform="translate(10 18)"/>
      <rect x="712" y="118" width="330" height="420" rx="14" fill="${lin([[0, '#ffffff'], [1, '#eef1ea']])}"/>
      <rect x="712" y="118" width="330" height="74" rx="14" fill="${lin([[0, t.accent], [1, t.accent2 || t.accent]], [0, 0, 1, 1])}"/>
      <rect x="712" y="170" width="330" height="22" fill="${t.accent2 || t.accent}"/>
      <text x="740" y="158" font-family="${FONT}" font-size="25" font-weight="800" fill="#fff" letter-spacing="1">MahaRERA</text>
      <text x="740" y="180" font-family="${FONT}" font-size="11.5" font-weight="600" fill="#fff" opacity=".85" letter-spacing="1.5">CERTIFICATE OF REGISTRATION</text>
      <text x="740" y="226" font-family="${FONT}" font-size="12" font-weight="700" fill="#7a8379" letter-spacing="1">PROJECT REGISTRATION NO.</text>
      <text x="740" y="254" font-family="Consolas, 'Courier New', monospace" font-size="23" font-weight="700" fill="${t.ink}">PR1260002500852</text>
      ${[284, 308, 332, 356].map((y, i) => `<rect x="740" y="${y}" width="${[262, 214, 240, 170][i]}" height="9" rx="4.5" fill="${t.ink}" opacity=".13"/>`).join('')}
      <rect x="904" y="374" width="113" height="113" rx="6" fill="#fff" stroke="#dde3db"/>
      ${qr}
      <circle cx="800" cy="440" r="44" fill="none" stroke="${t.accent}" stroke-width="3" opacity=".75"/>
      <circle cx="800" cy="440" r="36" fill="none" stroke="${t.accent}" stroke-width="1.5" stroke-dasharray="3 4" opacity=".75"/>
      <text x="800" y="436" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="${t.accent}" letter-spacing="1">REGISTERED</text>
      <text x="800" y="452" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="700" fill="${t.accent}" opacity=".8">MAHARASHTRA</text>
    </g>
    <g transform="translate(1068 196)" filter="url(#shadow)">
      <circle r="92" fill="${t.gold}" opacity=".18" filter="url(#blur12)"/>
      <path d="M0 -78 L64 -54 V-4 C64 42 34 70 0 84 C-34 70 -64 42 -64 -4 V-54 Z" fill="${lin([[0, '#fff3c4'], [0.45, t.gold], [1, '#a5741c']], [0, 0, 1, 1])}"/>
      <path d="M0 -64 L51 -45 V-4 C51 33 27 56 0 68 C-27 56 -51 33 -51 -4 V-45 Z" fill="${lin([[0, t.accent2 || t.accent], [1, t.ink]])}"/>
      <path d="M-25 2 L-7 20 L28 -17" stroke="#fff" stroke-width="11" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M-50 -44 L0 -63 L50 -44 V-20 C 20 -34 -20 -34 -50 -20 Z" fill="#fff" opacity=".12"/>
    </g>`;
}

/** Tower crane next to a half-built tower. */
function crane(t, { x = 900, top = 92, base = GROUND } = {}) {
  const c = t.crane;
  let lattice = '';
  for (let y = base; y > top + 20; y -= 22) lattice += `<path d="M${x} ${y} L${x + 18} ${y - 22} M${x + 18} ${y} L${x} ${y - 22}" stroke="${c}" stroke-width="1.4"/>`;
  let jib = '';
  for (let k = x - 80; k < x + 290; k += 18) jib += `<path d="M${k} ${top} L${k + 9} ${top - 12} L${k + 18} ${top}" stroke="${c}" stroke-width="1.3" fill="none"/>`;
  const light = `<circle cx="${x + 9}" cy="${top - 52}" r="3.5" fill="#ff3b30"/>`;
  glow.push(light, light);
  return `
    <rect x="${x - 1}" y="${top}" width="3" height="${base - top}" fill="${c}"/><rect x="${x + 16}" y="${top}" width="3" height="${base - top}" fill="${c}"/>
    ${lattice}
    <path d="M${x - 80} ${top} H${x + 290} M${x - 80} ${top - 12} H${x + 290}" stroke="${c}" stroke-width="2.5"/>${jib}
    <path d="M${x + 9} ${top - 50} L${x - 70} ${top - 12} M${x + 9} ${top - 50} L${x + 240} ${top - 12}" stroke="${c}" stroke-width="1.4"/>
    <path d="M${x - 2} ${top - 12} L${x + 9} ${top - 50} L${x + 20} ${top - 12}" fill="${c}"/>
    <rect x="${x - 76}" y="${top + 2}" width="34" height="22" fill="${c}"/>
    <rect x="${x + 22}" y="${top + 2}" width="22" height="16" rx="2" fill="${t.accent}"/>
    <path d="M${x + 210} ${top} V${top + 168}" stroke="${c}" stroke-width="1.2"/>
    <path d="M${x + 203} ${top + 168} h14 v6 a7 7 0 0 1 -14 0 Z" fill="${c}"/>
    <rect x="${x + 180}" y="${top + 182}" width="62" height="12" fill="${t.accent}" opacity=".9"/>
    ${light}`;
}

/** Concrete frame of a building still under construction. */
function frame(t, { x, top, w, base = GROUND, floorH = 26 }) {
  let out = '';
  const floors = Math.floor((base - top) / floorH);
  for (let i = 0; i <= floors; i++) out += `<rect x="${x - 3}" y="${base - i * floorH}" width="${w + 6}" height="4" fill="${t.slab}"/>`;
  for (let c = 0; c <= 5; c++) out += `<rect x="${f1(x + (c * (w - 6)) / 5)}" y="${base - floors * floorH}" width="6" height="${floors * floorH}" fill="${t.slab}" opacity=".85"/>`;
  // lower floors are enclosed already
  out += `<rect x="${x}" y="${base - 6 * floorH}" width="${w}" height="${6 * floorH}" fill="${lin([[0, t.face[0]], [1, t.face[1]]])}"/>`;
  for (let i = 0; i < 6; i++) {
    for (let c = 0; c < 6; c++) out += `<rect x="${f1(x + 6 + c * (w - 12) / 6 + 3)}" y="${base - (i + 1) * floorH + 7}" width="${f1((w - 12) / 6 - 6)}" height="${floorH - 12}" fill="${t.glass}" opacity=".8"/>`;
    out += `<rect x="${x - 2}" y="${base - i * floorH - 4}" width="${w + 4}" height="3" fill="${t.roof}" opacity=".6"/>`;
  }
  out += `<rect x="${x}" y="${base - 9 * floorH}" width="${w}" height="${3 * floorH}" fill="${t.net}" opacity=".55"/>`;
  return out;
}

/** Elevated metro viaduct with a train in motion. */
function metro(t, { y = 420 } = {}) {
  const concrete = lin([[0, '#6b7194'], [1, '#3a3f5e']]);
  let out = `<rect x="440" y="${y}" width="${W - 440}" height="18" fill="${concrete}"/><rect x="440" y="${y}" width="${W - 440}" height="2" fill="#a9b0d0" opacity=".6"/><rect x="440" y="${y + 18}" width="${W - 440}" height="5" fill="#1e2240"/>`;
  for (const px of [520, 700, 880, 1060]) out += `<path d="M${px - 16} ${y + 23} h32 l-7 14 v${GROUND - y - 37} h-18 v-${GROUND - y - 37} Z" fill="${concrete}"/>`;
  const tx = 640, tw = 520, ty = y - 44;
  out += `<g filter="url(#blur3)" opacity=".7">${[0, 1, 2, 3].map((i) => `<rect x="${360 + i * 20}" y="${ty + 8 + i * 8}" width="${280 - i * 40}" height="3" fill="${t.lit[0]}" opacity="${0.5 - i * 0.1}"/>`).join('')}</g>`;
  out += `<rect x="${tx}" y="${ty}" width="${tw}" height="42" rx="10" fill="${lin([[0, '#f4f6fb'], [1, '#aeb6c8']])}"/>`;
  out += `<path d="M${tx + tw} ${ty} q 34 4 38 34 v8 h-38 Z" fill="${lin([[0, '#f4f6fb'], [1, '#aeb6c8']])}"/>`;
  out += `<rect x="${tx}" y="${ty + 30}" width="${tw + 38}" height="5" fill="${t.accent}"/>`;
  for (let i = 0; i < 12; i++) {
    const wnd = `<rect x="${tx + 14 + i * 42}" y="${ty + 8}" width="30" height="16" rx="3" fill="${t.lit[1] || t.lit[0]}"/>`;
    out += wnd; glow.push(wnd);
  }
  for (const k of [0, 1, 2, 3]) out += `<rect x="${tx + k * 130 + 128}" y="${ty + 2}" width="3" height="38" fill="#7d8597"/>`;
  return out;
}

/** An airliner on approach with nav lights and a vapour trail, runway lights below. */
function plane(t) {
  const lights = [
    `<circle cx="1010" cy="166" r="4" fill="#ff3b30"/>`,
    `<circle cx="1112" cy="128" r="4" fill="#3dff7a"/>`,
    `<circle cx="1072" cy="139" r="5" fill="#ffffff"/>`,
  ];
  glow.push(...lights, ...lights);
  let runway = '';
  for (let i = 0; i < 14; i++) {
    const l = `<circle cx="${560 + i * 46}" cy="${GROUND + 34 + i * 1.6}" r="${2 + i * 0.12}" fill="${i % 3 ? '#ffd27a' : '#fff'}"/>`;
    runway += l; glow.push(l);
  }
  return `
    <path d="M520 330 C 700 280 860 220 1010 170" stroke="#fff" stroke-width="5" fill="none" opacity=".22" filter="url(#blur3)"/>
    <g transform="translate(1066 148) rotate(-20)">
      <path d="M-70 0 C -70 -7 -62 -10 -54 -10 H52 C66 -10 78 -5 82 0 C78 5 66 10 52 10 H-54 C-62 10 -70 7 -70 0 Z" fill="${lin([[0, '#eef2f7'], [1, '#9aa6b8']])}"/>
      <path d="M-4 -8 L-36 -66 H-20 L28 -8 Z" fill="#c9d1dd"/>
      <path d="M-4 8 L-30 52 H-16 L28 8 Z" fill="#8c97a8"/>
      <path d="M-58 -7 L-74 -34 H-62 L-42 -7 Z" fill="#c9d1dd"/>
      ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${-40 + i * 12}" y="-3" width="6" height="3" rx="1" fill="${t.ink}" opacity=".6"/>`).join('')}
    </g>
    ${lights.join('')}${runway}`;
}

/** A cost breakdown slip: what a ₹80 L flat really costs. */
function costCard(t) {
  const rows = [
    ['Agreement value', '₹80,00,000'],
    ['Stamp duty (7%)', '₹5,60,000'],
    ['Registration fee', '₹30,000'],
    ['GST (5%, under-constr.)', '₹4,00,000'],
  ];
  return `
    <g transform="rotate(3 900 320)">
      <rect x="730" y="104" width="340" height="430" rx="16" fill="#000" opacity=".5" filter="url(#blur12)" transform="translate(8 20)"/>
      <rect x="730" y="104" width="340" height="430" rx="16" fill="${lin([[0, '#ffffff'], [1, '#f1efe9']])}"/>
      <text x="760" y="150" font-family="${FONT}" font-size="14" font-weight="800" fill="${t.accent2}" letter-spacing="2">COST OF A ₹80 L FLAT</text>
      <text x="760" y="180" font-family="${FONT}" font-size="13" font-weight="600" fill="#8a8578">Pune city · PMC limits · example</text>
      <rect x="760" y="196" width="280" height="1.5" fill="#e3ddd0"/>
      ${rows.map(([k, v], i) => `
        <text x="760" y="${236 + i * 46}" font-family="${FONT}" font-size="16" font-weight="600" fill="#4a4740">${esc(k)}</text>
        <text x="1040" y="${236 + i * 46}" text-anchor="end" font-family="${FONT}" font-size="17" font-weight="800" fill="${t.ink}">${v}</text>
        <rect x="760" y="${252 + i * 46}" width="280" height="1" fill="#ece6da"/>`).join('')}
      <rect x="752" y="${236 + 4 * 46 - 18}" width="296" height="58" rx="10" fill="${t.accent2}" opacity=".1"/>
      <text x="768" y="${236 + 4 * 46 + 16}" font-family="${FONT}" font-size="17" font-weight="800" fill="${t.ink}">You actually pay</text>
      <text x="1032" y="${236 + 4 * 46 + 17}" text-anchor="end" font-family="${FONT}" font-size="24" font-weight="900" fill="${t.accent2}">₹89.9 L</text>
      <text x="760" y="508" font-family="${FONT}" font-size="11.5" fill="#9a9488">+ maintenance, legal &amp; loan fees</text>
    </g>
    <g transform="translate(1092 452) rotate(-16)" opacity=".9">
      <circle r="58" fill="none" stroke="${t.stamp}" stroke-width="5"/>
      <circle r="48" fill="none" stroke="${t.stamp}" stroke-width="1.5"/>
      <text y="-6" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="900" fill="${t.stamp}" letter-spacing="1">STAMP</text>
      <text y="14" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="900" fill="${t.stamp}" letter-spacing="1">DUTY</text>
      <text y="32" text-anchor="middle" font-family="${FONT}" font-size="9" font-weight="700" fill="${t.stamp}" letter-spacing="1">MAHARASHTRA</text>
    </g>`;
}

function emiCard(t) {
  const rows = [
    ['Flat price', '₹90,00,000'],
    ['Down payment (20%)', '₹18,00,000'],
    ['Home loan (80%)', '₹72,00,000'],
    ['Rate · tenure', '8.5% · 20 yrs'],
  ];
  return `
    <g transform="rotate(-3 900 320)">
      <rect x="730" y="104" width="340" height="430" rx="16" fill="#000" opacity=".5" filter="url(#blur12)" transform="translate(8 20)"/>
      <rect x="730" y="104" width="340" height="430" rx="16" fill="${lin([[0, '#ffffff'], [1, '#eef4f1']])}"/>
      <text x="760" y="150" font-family="${FONT}" font-size="14" font-weight="800" fill="${t.accent2}" letter-spacing="2">HOME LOAN EMI</text>
      <text x="760" y="180" font-family="${FONT}" font-size="13" font-weight="600" fill="#7c8a84">₹90 L flat in Pune · example</text>
      <rect x="760" y="196" width="280" height="1.5" fill="#d9e4de"/>
      ${rows.map(([k, v], i) => `
        <text x="760" y="${236 + i * 46}" font-family="${FONT}" font-size="16" font-weight="600" fill="#45504b">${esc(k)}</text>
        <text x="1040" y="${236 + i * 46}" text-anchor="end" font-family="${FONT}" font-size="17" font-weight="800" fill="${t.ink}">${v}</text>
        <rect x="760" y="${252 + i * 46}" width="280" height="1" fill="#e2ebe6"/>`).join('')}
      <rect x="752" y="${236 + 4 * 46 - 18}" width="296" height="58" rx="10" fill="${t.accent2}" opacity=".1"/>
      <text x="768" y="${236 + 4 * 46 + 16}" font-family="${FONT}" font-size="17" font-weight="800" fill="${t.ink}">Monthly EMI</text>
      <text x="1032" y="${236 + 4 * 46 + 17}" text-anchor="end" font-family="${FONT}" font-size="24" font-weight="900" fill="${t.accent2}">₹62,483</text>
      <text x="760" y="508" font-family="${FONT}" font-size="11.5" fill="#8a9690">Rates vary by lender · illustrative only</text>
    </g>`;
}

// ---- scenes -----------------------------------------------------------------------

const SCENES = {
  /** Dusk over the river — Mundhwa. */
  riverside(t) {
    const city = [
      tower(t, { x: 560, top: 300, w: 70, seed: 2, lit: 0.5 }),
      tower(t, { x: 660, top: 220, w: 84, seed: 3, lit: 0.55, crown: true }),
      tower(t, { x: 778, top: 262, w: 74, seed: 4, lit: 0.5 }),
      tower(t, { x: 884, top: 160, w: 96, seed: 5, lit: 0.6, kind: 'glass', crown: true }),
      tower(t, { x: 1012, top: 240, w: 82, seed: 6, lit: 0.55 }),
      tower(t, { x: 1124, top: 300, w: 66, seed: 7, lit: 0.5 }),
    ].join('');
    return [sky(t), farSkyline(t, { seed: 31, color: t.far, max: 200 }), haze(t, 260), city, trees(t, [600, 760, 870, 1000, 1110]), water(t, city)];
  },

  /** Golden-hour panorama with locality pins — Pune overview. */
  panorama(t) {
    return [
      sky(t), farSkyline(t, { seed: 41, color: t.far, max: 150, lights: 0 }), haze(t, 280),
      tower(t, { x: 520, top: 330, w: 70, seed: 11, lit: 0.3 }),
      tower(t, { x: 612, top: 270, w: 80, seed: 12, lit: 0.35 }),
      tower(t, { x: 726, top: 310, w: 66, seed: 13, lit: 0.3 }),
      tower(t, { x: 820, top: 230, w: 84, seed: 14, lit: 0.35, kind: 'glass' }),
      tower(t, { x: 940, top: 290, w: 74, seed: 15, lit: 0.3 }),
      tower(t, { x: 1046, top: 250, w: 80, seed: 16, lit: 0.35 }),
      tower(t, { x: 1150, top: 320, w: 60, seed: 17, lit: 0.3 }),
      ground(t), trees(t, [540, 700, 800, 930, 1030, 1140, 1190], { size: 1.2 }),
      mapPin(t, 652, 262, 'Hinjewadi', { color: t.pin }),
      mapPin(t, 862, 222, 'Kharadi'),
      mapPin(t, 978, 282, 'Mundhwa', { color: t.pin }),
      mapPin(t, 1086, 242, 'Balewadi', { color: t.pin }),
    ];
  },

  /** Night glass towers and traffic trails — Kharadi IT hub. */
  itpark(t) {
    return [
      sky(t), farSkyline(t, { seed: 51, color: t.far, max: 220, lights: 0.25 }), haze(t, 250),
      tower(t, { x: 560, top: 250, w: 80, seed: 21, lit: 0.6, kind: 'glass' }),
      tower(t, { x: 668, top: 130, w: 104, seed: 22, lit: 0.7, kind: 'glass', crown: true }),
      tower(t, { x: 806, top: 200, w: 92, seed: 23, lit: 0.65, kind: 'glass' }),
      tower(t, { x: 932, top: 96, w: 112, seed: 24, lit: 0.7, kind: 'glass', crown: true }),
      tower(t, { x: 1076, top: 220, w: 96, seed: 25, lit: 0.6, kind: 'glass' }),
      ground(t), lightTrails(t, { y: GROUND + 26 }), trees(t, [580, 790, 1060], { size: 0.9 }),
    ];
  },

  /** Daylight towers behind a registration certificate — MahaRERA guide. */
  certificate(t) {
    return [
      sky(t), farSkyline(t, { seed: 61, color: t.far, max: 170, lights: 0 }), haze(t, 280),
      tower(t, { x: 560, top: 250, w: 84, seed: 31, lit: 0.08 }),
      tower(t, { x: 1110, top: 210, w: 80, seed: 32, lit: 0.08 }),
      ground(t), trees(t, [560, 640, 1100, 1180], { size: 1.3 }),
      certificate(t),
    ];
  },

  /** Sunrise over the hills with a new township — West Pune. */
  township(t) {
    const hills = `
      <path d="M0 400 C 200 330 360 360 520 320 S 860 250 1040 300 S 1160 290 1200 280 V${GROUND} H0 Z" fill="${t.hill[0]}"/>
      <path d="M0 450 C 240 400 420 430 640 390 S 980 360 1200 380 V${GROUND} H0 Z" fill="${t.hill[1]}"/>`;
    return [
      sky(t), hills, haze(t, 300),
      tower(t, { x: 600, top: 270, w: 62, seed: 41, lit: 0.25 }),
      tower(t, { x: 684, top: 220, w: 70, seed: 42, lit: 0.3 }),
      tower(t, { x: 776, top: 250, w: 66, seed: 43, lit: 0.25 }),
      tower(t, { x: 1000, top: 210, w: 72, seed: 44, lit: 0.3 }),
      tower(t, { x: 1094, top: 260, w: 66, seed: 45, lit: 0.25 }),
      ground(t), trees(t, [570, 660, 760, 860, 900, 960, 1080, 1170], { size: 1.3 }),
    ];
  },

  /** Elevated metro at night — Pimpri-Chinchwad. */
  metro(t) {
    return [
      sky(t), farSkyline(t, { seed: 71, color: t.far, max: 210, lights: 0.25 }), haze(t, 250),
      tower(t, { x: 560, top: 230, w: 76, seed: 51, lit: 0.5 }),
      tower(t, { x: 668, top: 170, w: 84, seed: 52, lit: 0.55, crown: true }),
      tower(t, { x: 790, top: 250, w: 70, seed: 53, lit: 0.5 }),
      tower(t, { x: 902, top: 190, w: 86, seed: 54, lit: 0.55 }),
      tower(t, { x: 1030, top: 150, w: 90, seed: 55, lit: 0.55, crown: true }),
      tower(t, { x: 1146, top: 260, w: 60, seed: 56, lit: 0.5 }),
      ground(t), metro(t), lightTrails(t, { y: GROUND + 40, n: 8, seed: 8 }),
    ];
  },

  /** Twilight approach over the airport side — East Pune. */
  airport(t) {
    return [
      sky(t), farSkyline(t, { seed: 81, color: t.far, max: 160, lights: 0.2 }), haze(t, 300),
      tower(t, { x: 600, top: 320, w: 70, seed: 61, lit: 0.5 }),
      tower(t, { x: 700, top: 280, w: 78, seed: 62, lit: 0.55 }),
      tower(t, { x: 820, top: 330, w: 64, seed: 63, lit: 0.5 }),
      tower(t, { x: 920, top: 290, w: 80, seed: 64, lit: 0.55, crown: true }),
      tower(t, { x: 1040, top: 340, w: 70, seed: 65, lit: 0.5 }),
      tower(t, { x: 1140, top: 300, w: 62, seed: 66, lit: 0.5 }),
      ground(t), plane(t),
    ];
  },

  /** Golden hour: finished tower beside one under construction — ready vs UC. */
  construction(t) {
    return [
      sky(t), farSkyline(t, { seed: 91, color: t.far, max: 150, lights: 0 }), haze(t, 300),
      tower(t, { x: 600, top: 210, w: 110, seed: 71, lit: 0.45, floorH: 24 }),
      frame(t, { x: 930, top: 200, w: 150 }),
      crane(t, { x: 870, top: 100 }),
      ground(t), trees(t, [580, 740, 1110, 1180], { size: 1.2 }),
    ];
  },

  /** Bright morning society with price pins — flats under ₹1 Cr. */
  budget(t) {
    return [
      sky(t), farSkyline(t, { seed: 101, color: t.far, max: 160, lights: 0 }), haze(t, 280),
      tower(t, { x: 560, top: 290, w: 74, seed: 81, lit: 0.06 }),
      tower(t, { x: 664, top: 220, w: 84, seed: 82, lit: 0.06 }),
      tower(t, { x: 786, top: 270, w: 74, seed: 83, lit: 0.06 }),
      tower(t, { x: 900, top: 200, w: 88, seed: 84, lit: 0.06 }),
      tower(t, { x: 1026, top: 250, w: 80, seed: 85, lit: 0.06 }),
      tower(t, { x: 1140, top: 300, w: 60, seed: 86, lit: 0.06 }),
      ground(t), trees(t, [560, 650, 760, 880, 1000, 1120, 1190], { size: 1.3 }),
      mapPin(t, 706, 212, '₹30 L+', { color: t.pin }),
      mapPin(t, 944, 192, '₹65 L+'),
      mapPin(t, 1066, 242, '₹90 L+', { color: t.pin }),
    ];
  },

  /** Tall family towers at golden hour with BHK price pins — 3 BHK flats. */
  family(t) {
    return [
      sky(t), farSkyline(t, { seed: 121, color: t.far, max: 180, lights: 0.15 }), haze(t, 270),
      tower(t, { x: 560, top: 260, w: 78, seed: 101, lit: 0.35 }),
      tower(t, { x: 668, top: 170, w: 92, seed: 102, lit: 0.4, crown: true }),
      tower(t, { x: 800, top: 230, w: 80, seed: 103, lit: 0.35 }),
      tower(t, { x: 916, top: 140, w: 100, seed: 104, lit: 0.45, kind: 'glass', crown: true }),
      tower(t, { x: 1052, top: 210, w: 86, seed: 105, lit: 0.4 }),
      tower(t, { x: 1160, top: 290, w: 56, seed: 106, lit: 0.35 }),
      ground(t), trees(t, [560, 650, 780, 900, 1030, 1140, 1190], { size: 1.25 }),
      mapPin(t, 714, 162, '₹1 Cr+', { color: t.pin }),
      mapPin(t, 966, 132, '₹1.7 Cr+'),
      mapPin(t, 1094, 202, '₹4 Cr+', { color: t.pin }),
    ];
  },

  /** Daylight apartments behind an EMI slip — home loan guide. */
  loan(t) {
    return [
      sky(t), farSkyline(t, { seed: 131, color: t.far, max: 170, lights: 0 }), haze(t, 280),
      tower(t, { x: 560, top: 240, w: 86, seed: 111, lit: 0.08 }),
      tower(t, { x: 1100, top: 200, w: 86, seed: 112, lit: 0.08, crown: true }),
      ground(t), trees(t, [580, 660, 1090, 1180], { size: 1.2 }),
      emiCard(t),
    ];
  },

  /** Evening apartments behind a cost slip — stamp duty & hidden costs. */
  costs(t) {
    return [
      sky(t), farSkyline(t, { seed: 111, color: t.far, max: 190, lights: 0.2 }), haze(t, 260),
      tower(t, { x: 560, top: 230, w: 86, seed: 91, lit: 0.5 }),
      tower(t, { x: 1100, top: 190, w: 86, seed: 92, lit: 0.5, crown: true }),
      ground(t), trees(t, [580, 660, 1090, 1180]),
      costCard(t),
    ];
  },
};

// ---- themes -----------------------------------------------------------------------
//   sky: top → horizon; face/side: building faces [top, bottom]; lit: window colours;
//   scrim: the colour behind the headline; accent: kicker, last headline line, chips.

export const THEMES = {
  dusk: {
    scene: 'riverside', sky: ['#1b1440', '#4b2466', '#c0566a', '#f7a35c'], sun: { x: 1010, y: 300, r: 46, color: '#ffc46b', halo: '#ff9a4d' },
    clouds: { n: 6, color: '#ff9f7a', seed: 3 }, far: '#3a2350', haze: '#e0786a', hazeA: 0.45,
    face: ['#2c2148', '#1a1430'], side: ['#1b1330', '#100b20'], roof: '#3f3160', slab: '#6a5a8a', glass: '#2a2450',
    lit: ['#ffd27a', '#ffb85a', '#fff0c2'], office: '#ffd9a0', water: ['#3b2450', '#120c22'],
    tree: ['#1c1530', '#231a3a'], ground: ['#1a1230', '#0c0818'], scrim: '#150f30', accent: '#ffb547', ink: '#14123a', sub: '#e6dcff',
  },
  emerald: {
    scene: 'panorama', sky: ['#2f6f8f', '#7fb3c0', '#f3d29a', '#f6b26b'], sun: { x: 760, y: 360, r: 40, color: '#ffe3a1', halo: '#ffc277' },
    clouds: { n: 7, color: '#fff1d6', seed: 8 }, far: '#7f9fa8', haze: '#f5cf98', hazeA: 0.6,
    face: ['#f1e6d6', '#c9b79e'], side: ['#9a8a78', '#6f6252'], roof: '#fff4e2', slab: '#ffffff', glass: '#5d7d8c',
    lit: ['#ffe2a0', '#fff1c8'], office: '#ffe7b0', tree: ['#2f5a3e', '#3b6b49', '#24482f'], ground: ['#3d5a3c', '#1e3121'],
    scrim: '#0b3a35', accent: '#c6f36b', pin: '#0e7a62', ink: '#123c33', sub: '#d6efe4',
  },
  midnight: {
    scene: 'itpark', sky: ['#020713', '#071a3a', '#123a6b', '#2a5d8f'], stars: true, far: '#0b1c38', haze: '#2a5d8f', hazeA: 0.5,
    face: ['#13305c', '#0a1a36'], side: ['#0a1a36', '#050d1f'], roof: '#1f4478', slab: '#3b5d8f', glass: '#0d2448',
    lit: ['#bfe9ff', '#ffe7a8'], office: '#9fe3ff', tree: ['#05101f', '#081629'], ground: ['#0a1426', '#03070f'],
    scrim: '#030b1c', accent: '#4fd8ff', ink: '#081a38', sub: '#c4ddff',
  },
  forest: {
    scene: 'certificate', sky: ['#5aa6d6', '#9fd0ea', '#e4f1f2'], sun: { x: 1150, y: 70, r: 34, color: '#fffbe0', halo: '#fff3c0' },
    clouds: { n: 8, color: '#ffffff', seed: 11 }, far: '#9fbccc', haze: '#e8f2ef', hazeA: 0.7,
    face: ['#f2efe7', '#cfc8b8'], side: ['#a9a292', '#827c6e'], roof: '#ffffff', slab: '#ffffff', glass: '#6f93a6',
    lit: ['#fff1c8'], office: '#fff', tree: ['#2e6b45', '#3d8054', '#25583a'], ground: ['#4c7d4f', '#24432a'],
    scrim: '#0b3f31', accent: '#0f7a55', accent2: '#0a5c40', gold: '#e8c46a', ink: '#0b3d30', sub: '#d6eee2', headAccent: '#f2d27a',
  },
  sunrise: {
    scene: 'township', sky: ['#3a2a6b', '#9a4d7a', '#f08a6a', '#ffd08a'], sun: { x: 900, y: 250, r: 52, color: '#ffe9a8', halo: '#ffb26b' },
    clouds: { n: 6, color: '#ffc6a0', seed: 14 }, haze: '#ffb98a', hazeA: 0.5, hill: ['#9a5a78', '#6b3a5e'],
    face: ['#f7d6c0', '#b98a86'], side: ['#7a4c62', '#53304a'], roof: '#ffe6d2', slab: '#fff1e6', glass: '#6b4a72',
    lit: ['#ffe2a0'], office: '#ffe2a0', tree: ['#3a2140', '#4a2a4c', '#2c1832'], ground: ['#3a2140', '#1c0e20'],
    scrim: '#2a1036', accent: '#ffd27a', ink: '#3a1236', sub: '#ffe0d2',
  },
  metro: {
    scene: 'metro', sky: ['#0b0f24', '#1b1f45', '#3d2c62', '#7a3f6f'], stars: true, far: '#1a1a3a', haze: '#6a3a6a', hazeA: 0.45,
    face: ['#262a4e', '#151831'], side: ['#151831', '#0b0d1f'], roof: '#353a66', slab: '#4d5384', glass: '#1d2142',
    lit: ['#ffd88a', '#ffeccc'], office: '#ffd88a', tree: ['#0d0f22'], ground: ['#121429', '#06070f'],
    scrim: '#0b0d22', accent: '#ff5fa2', ink: '#0f1626', sub: '#d8dcf5',
  },
  sky: {
    scene: 'airport', sky: ['#0d1f4a', '#2b4f8f', '#d9708a', '#ffb070'], stars: false, sun: { x: 640, y: 470, r: 30, color: '#ffcf8a', halo: '#ff9b6b' },
    clouds: { n: 5, color: '#f6a3a0', seed: 17 }, far: '#2b3560', haze: '#e88a7a', hazeA: 0.45,
    face: ['#24325e', '#141d3c'], side: ['#141d3c', '#0a1026'], roof: '#33467a', slab: '#4c5f94', glass: '#1c2850',
    lit: ['#ffd88a', '#fff0c8'], office: '#ffd88a', ground: ['#141b36', '#070a18'], tree: ['#0c1228'],
    scrim: '#0a1638', accent: '#ff9b42', ink: '#0a2a58', sub: '#d5e8ff',
  },
  ember: {
    scene: 'construction', sky: ['#4a2a4a', '#b0514a', '#f39a4f', '#ffd48a'], sun: { x: 1110, y: 360, r: 44, color: '#fff0b0', halo: '#ffb050' },
    clouds: { n: 6, color: '#ffb27a', seed: 19 }, far: '#8a4a48', haze: '#ffb070', hazeA: 0.55,
    face: ['#f2c49a', '#a8705a'], side: ['#6e3e36', '#4a2826'], roof: '#ffd9b0', slab: '#5a3430', glass: '#5a3a44', net: '#2f7a5a',
    lit: ['#ffe2a0'], office: '#ffe2a0', crane: '#2a1614', tree: ['#3a1e1c', '#4a2622'], ground: ['#3a201c', '#1a0c0a'],
    scrim: '#2a100a', accent: '#ffc83d', ink: '#24110a', sub: '#f8dcc8',
  },
  morning: {
    scene: 'budget', sky: ['#3f8fd0', '#86c0e6', '#dff0f5'], sun: { x: 1130, y: 70, r: 34, color: '#fffbe0', halo: '#fff2b8' },
    clouds: { n: 9, color: '#ffffff', seed: 23 }, far: '#a8c4d4', haze: '#eef6f7', hazeA: 0.75,
    face: ['#fbf4ea', '#d9ccb8'], side: ['#b6a894', '#8d806c'], roof: '#ffffff', slab: '#ffffff', glass: '#5f8aa3',
    lit: ['#fff1c8'], office: '#fff', tree: ['#3f8a4a', '#54a05c', '#2e6d3a'], ground: ['#5a9a55', '#2c5a2e'],
    scrim: '#0b2f5a', accent: '#ffcc3d', pin: '#e8553d', ink: '#0b2f5a', sub: '#d8e9ff',
  },
  slate: {
    scene: 'costs', sky: ['#14213d', '#2e3f6b', '#7a6a8f', '#d99a7a'], sun: { x: 900, y: 500, r: 30, color: '#ffd0a0', halo: '#ff9f7a' },
    clouds: { n: 5, color: '#c890a0', seed: 29 }, far: '#2a3558', haze: '#c88a86', hazeA: 0.4,
    face: ['#2b3760', '#18203d'], side: ['#18203d', '#0d1226'], roof: '#3a4878', slab: '#55649a', glass: '#1f2950',
    lit: ['#ffd88a', '#ffeccc'], office: '#ffd88a', tree: ['#0e1428', '#141b33'], ground: ['#141a33', '#080b18'],
    scrim: '#0d1530', accent: '#ffb85a', accent2: '#b0532c', stamp: '#c0392b', ink: '#1e1a14', sub: '#d8dff5',
  },
  golden: {
    scene: 'family', sky: ['#2a2350', '#6a4a7a', '#e0906a', '#ffd59a'], sun: { x: 1120, y: 330, r: 42, color: '#fff0b8', halo: '#ffc070' },
    clouds: { n: 6, color: '#ffc9a0', seed: 31 }, far: '#6a5070', haze: '#f6bd8a', hazeA: 0.5,
    face: ['#f4dcc2', '#b8927a'], side: ['#7a5a5a', '#523a40'], roof: '#ffecd6', slab: '#fff3e6', glass: '#5a4a6a',
    lit: ['#ffe2a0', '#fff1c8'], office: '#ffe2a0', tree: ['#2f3a2a', '#3c4a34', '#232c20'], ground: ['#3a3a2c', '#1a1a12'],
    scrim: '#22123a', accent: '#ffcf5a', pin: '#d9485f', ink: '#22123a', sub: '#f5e2d8',
  },
  mint: {
    scene: 'loan', sky: ['#2f8a9a', '#7cc4c8', '#e2f3ee'], sun: { x: 640, y: 90, r: 34, color: '#fffbe0', halo: '#fff2b8' },
    clouds: { n: 8, color: '#ffffff', seed: 37 }, far: '#9cc4c4', haze: '#eaf6f2', hazeA: 0.7,
    face: ['#f3f0e8', '#cfc8b8'], side: ['#a6a090', '#7f7a6c'], roof: '#ffffff', slab: '#ffffff', glass: '#5f8f9a',
    lit: ['#fff1c8'], office: '#fff', tree: ['#2e7a5a', '#3d8f68', '#25604a'], ground: ['#4a8a64', '#244a34'],
    scrim: '#08343a', accent: '#7af0c8', accent2: '#0f7a6a', ink: '#08343a', sub: '#d4f0ea',
  },
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
  reset();
  const scene = SCENES[t.scene](t).join('');
  const glowLayer = glow.join('');

  const size = lines.some((l) => l.length > 17) ? 52 : 58;
  const lineH = size + 10;
  const top = 196;
  const statsY = top + (lines.length - 1) * lineH + 52;
  const head = t.headAccent || t.accent;
  const chipW = (v, l) => Math.max(v.length * 15.5, l.length * 8.2) + 36;
  let cx = 60;
  const chips = stats.slice(0, 3).map(([v, l]) => {
    const w = chipW(v, l);
    const g = `<g transform="translate(${cx} ${statsY})">
      <rect width="${w}" height="74" rx="16" fill="#fff" fill-opacity=".12" stroke="#fff" stroke-opacity=".28"/>
      <rect x="1" y="1" width="${w - 2}" height="30" rx="15" fill="#fff" fill-opacity=".06"/>
      <text x="18" y="34" font-family="${FONT}" font-size="26" font-weight="800" fill="${head}">${esc(v)}</text>
      <text x="18" y="58" font-family="${FONT}" font-size="14" font-weight="600" fill="${t.sub}">${esc(l)}</text></g>`;
    cx += w + 14;
    return g;
  });

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="blur1" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="0.8"/></filter>
      <filter id="blur3" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.6"/></filter>
      <filter id="blur12" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12"/></filter>
      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>
      <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="6"/><feOffset dy="6"/>
        <feComponentTransfer><feFuncA type="linear" slope=".45"/></feComponentTransfer>
        <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="tshadow" x="-10%" y="-30%" width="120%" height="160%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="5"/><feOffset dy="2"/>
        <feComponentTransfer><feFuncA type="linear" slope=".55"/></feComponentTransfer>
        <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="4" stitchTiles="stitch"/>
        <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .9 -.38"/>
      </filter>
      <clipPath id="below"><rect x="0" y="${GROUND}" width="${W}" height="${H - GROUND}"/></clipPath>
      <linearGradient id="scrim" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${t.scrim}" stop-opacity=".94"/><stop offset=".42" stop-color="${t.scrim}" stop-opacity=".84"/>
        <stop offset=".6" stop-color="${t.scrim}" stop-opacity=".38"/><stop offset=".76" stop-color="${t.scrim}" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="foot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.scrim}" stop-opacity="0"/><stop offset="1" stop-color="${t.scrim}" stop-opacity=".7"/></linearGradient>
      <radialGradient id="vignette" cx=".6" cy=".45" r=".85"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></radialGradient>
      ${defs.join('')}
    </defs>
    ${scene}
    <g filter="url(#glow)" opacity=".9">${glowLayer}</g>
    <rect width="${W}" height="${H}" fill="url(#vignette)"/>
    <rect width="${W}" height="${H}" fill="url(#scrim)"/>
    <rect y="${H - 160}" width="${W}" height="160" fill="url(#foot)"/>
    <rect width="${W}" height="${H}" filter="url(#grain)" opacity=".28"/>
    <rect x="60" y="70" rx="20" width="${Math.round(kicker.length * 12.6) + 52}" height="40" fill="${head}"/>
    <circle cx="82" cy="90" r="5" fill="${t.scrim}"/>
    <text x="96" y="97" font-family="${FONT}" font-size="17" font-weight="800" fill="${t.scrim}" letter-spacing="2">${esc(kicker.toUpperCase())}</text>
    <g filter="url(#tshadow)">${lines.map((l, i) => `<text x="60" y="${top + i * lineH}" font-family="${FONT}" font-size="${size}" font-weight="800" letter-spacing="-1" fill="${i === lines.length - 1 ? head : '#fff'}">${esc(l)}</text>`).join('')}</g>
    ${chips.join('')}
    <text x="114" y="${H - 52}" font-family="${FONT}" font-size="24" font-weight="800" fill="#fff">mappingg.com</text>
    <text x="114" y="${H - 30}" font-family="${FONT}" font-size="15" fill="${t.sub}">Pune’s live real-estate map</text>
  </svg>`;

  await sharp(Buffer.from(svg))
    .composite([{ input: await brandMark(), left: 60, top: H - 88 }])
    .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: '4:4:4' })
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

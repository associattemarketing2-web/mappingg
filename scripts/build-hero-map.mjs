// Builds public/img/hero-map.svg, the street-map background of the landing hero:
// city blocks of building footprints, gated housing societies (towers in a green
// compound), parks with trees, a river with bridges, a lake, a highway, a ring
// road and a diagonal arterial, in the live map's palette. The street grid is
// drawn slightly rotated so it reads as a real city rather than a chart.
// Seeded, so re-running gives the same map.
//
//   node scripts/build-hero-map.mjs

import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const W = 1600;
const H = 900;
// The map is drawn on a larger canvas, then rotated and centred on W×H.
const PAD = 260;
const MW = W + PAD * 2;
const MH = H + PAD * 2;
const ROT = -9;

// Small seeded PRNG (mulberry32) so the map is stable between builds.
let seed = 20261031;
const rnd = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a, b) => a + rnd() * (b - a);
const r1 = (n) => Math.round(n * 10) / 10;
const rect = (x, y, w, h) => `M${r1(x)} ${r1(y)}h${r1(w)}v${r1(h)}h${r1(-w)}z`;

const C = {
  land: '#f3efe6',
  building: '#e7e0d1',
  buildingAlt: '#dfd6c4',
  tower: '#d8cdb8',
  edge: '#d2c8b3',
  compound: '#e4eedb',
  compoundEdge: '#d3e3c6',
  park: '#d6ebce',
  parkEdge: '#c3e0b8',
  tree: '#bcdcae',
  water: '#a9d0ef',
  waterEdge: '#93c2e8',
  road: '#ffffff',
  casing: '#e1dbcd',
  highway: '#f6d58f',
  highwayCasing: '#e8b95c',
};

// ---- features the buildings keep clear of (map coordinates) ----
const riverY = (x) => 900 + 60 * Math.sin(x / 290) + 26 * Math.sin(x / 105 + 1.3);
const highwayY = (x) => 360 + 40 * Math.sin(x / 440 + 0.4);
const ringY = (x) => 1180 - 0.00023 * (x - 1150) ** 2;
const diag = { x1: 120, y1: 180, x2: 1250, y2: MH + 40 };
const lake = { cx: 1560, cy: 600, rx: 104, ry: 58 };

function distToSegment(px, py, { x1, y1, x2, y2 }) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
const inRiver = (x, y, m = 0) => Math.abs(y - riverY(x)) < 30 + m;
const inLake = (x, y, m = 0) => ((x - lake.cx) / (lake.rx + m)) ** 2 + ((y - lake.cy) / (lake.ry + m)) ** 2 < 1;
function blocked(x, y, w, h) {
  const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h], [x + w / 2, y + h / 2]];
  return pts.some(([px, py]) =>
    inRiver(px, py, 16) || inLake(px, py, 16) ||
    Math.abs(py - highwayY(px)) < 21 ||
    (px > 400 && Math.abs(py - ringY(px)) < 15) ||
    distToSegment(px, py, diag) < 17);
}

// ---- street grid ----
const xs = [0];
while (xs.at(-1) < MW) xs.push(xs.at(-1) + Math.round(between(112, 176)));
const ys = [0];
while (ys.at(-1) < MH) ys.push(ys.at(-1) + Math.round(between(92, 140)));
const wide = (i) => i % 3 === 1; // every third street is an arterial road
const half = (i) => (wide(i) ? 11 : 6);

const parks = [];
const trees = [];
const compounds = [];
const towers = [];
const buildings = [];

const addTrees = (bx, by, bw, bh, density) => {
  const n = Math.round((bw * bh) / density);
  for (let k = 0; k < n; k++) trees.push([r1(between(bx + 7, bx + bw - 7)), r1(between(by + 7, by + bh - 7)), r1(between(3.5, 7.5))]);
};

for (let i = 0; i < xs.length - 1; i++) {
  for (let j = 0; j < ys.length - 1; j++) {
    const bx = xs[i] + half(i) + 4, by = ys[j] + half(j) + 4;
    const bw = xs[i + 1] - half(i + 1) - 4 - bx, bh = ys[j + 1] - half(j + 1) - 4 - by;
    if (bw < 30 || bh < 30) continue;
    const roll = rnd();
    const clear = !blocked(bx, by, bw, bh);

    // park
    if (roll < 0.09 && clear) {
      parks.push(rect(bx, by, bw, bh));
      addTrees(bx, by, bw, bh, 760);
      continue;
    }
    // gated housing society: towers spaced out in a green compound
    if (roll < 0.25 && clear && bw > 80 && bh > 70) {
      compounds.push(rect(bx, by, bw, bh));
      const tw = between(20, 28), th = between(26, 38);
      const cols = Math.max(2, Math.floor((bw - 14) / (tw + 18)));
      const rows = Math.max(1, Math.floor((bh - 14) / (th + 16)));
      const gx = (bw - cols * tw) / (cols + 1), gy = (bh - rows * th) / (rows + 1);
      for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
        towers.push(rect(bx + gx + c * (tw + gx), by + gy + r * (th + gy), tw, th));
      }
      addTrees(bx, by, bw, bh, 2600);
      continue;
    }
    // ordinary block: one footprint per lot
    const cols = Math.max(1, Math.round(bw / between(26, 46)));
    const rows = Math.max(1, Math.round(bh / between(26, 48)));
    const lw = bw / cols, lh = bh / rows;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (rnd() < 0.07) continue; // open plot
        const ix = between(1.5, 5), iy = between(1.5, 5);
        const x = bx + c * lw + ix, y = by + r * lh + iy;
        const w = lw - ix - between(1.5, 5), h = lh - iy - between(1.5, 5);
        if (w < 7 || h < 7 || blocked(x, y, w, h)) continue;
        const alt = rnd() < 0.3;
        if (rnd() < 0.2 && w > 18 && h > 18) {
          const cw = w * between(0.35, 0.55), ch = h * between(0.35, 0.55);
          buildings.push([alt, `M${r1(x)} ${r1(y)}h${r1(w)}v${r1(h - ch)}h${r1(-cw)}v${r1(ch)}h${r1(cw - w)}z`]);
        } else {
          buildings.push([alt, rect(x, y, w, h)]);
        }
      }
    }
  }
}

// ---- roads: one segment per block edge, so streets stop at the water ----
const streets = [];
const arterials = [];
const wet = (x, y) => inRiver(x, y, 4) || inLake(x, y, 6);
for (let i = 0; i < xs.length; i++) {
  for (let j = 0; j < ys.length - 1; j++) {
    const x = xs[i], mid = (ys[j] + ys[j + 1]) / 2;
    if (inLake(x, mid, 10) || (!wide(i) && wet(x, mid))) continue; // arterials bridge the river
    (wide(i) ? arterials : streets).push(`M${x} ${ys[j]}V${ys[j + 1]}`);
  }
}
for (let j = 0; j < ys.length; j++) {
  for (let i = 0; i < xs.length - 1; i++) {
    const y = ys[j], mid = (xs[i] + xs[i + 1]) / 2;
    if (inLake(mid, y, 10) || (!wide(j) && wet(mid, y))) continue;
    (wide(j) ? arterials : streets).push(`M${xs[i]} ${y}H${xs[i + 1]}`);
  }
}
const curve = (f, from = -40, to = MW + 40, step = 20) => {
  let d = `M${from} ${r1(f(from))}`;
  for (let x = from + step; x <= to; x += step) d += `L${x} ${r1(f(x))}`;
  return d;
};
const river = curve(riverY);
const highway = curve(highwayY);
const ring = curve(ringY, 400, MW + 40);
const diagonal = `M${diag.x1} ${diag.y1}L${diag.x2} ${diag.y2}`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${C.land}"/>
<g transform="translate(${W / 2} ${H / 2}) rotate(${ROT}) translate(${-MW / 2} ${-MH / 2})">
<path fill="${C.park}" stroke="${C.parkEdge}" stroke-width="2" d="${parks.join('')}"/>
<path fill="${C.compound}" stroke="${C.compoundEdge}" stroke-width="2" d="${compounds.join('')}"/>
<g fill="${C.tree}">${trees.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>
<path fill="${C.building}" stroke="${C.edge}" stroke-width="1" d="${buildings.filter(([a]) => !a).map(([, d]) => d).join('')}"/>
<path fill="${C.buildingAlt}" stroke="${C.edge}" stroke-width="1" d="${buildings.filter(([a]) => a).map(([, d]) => d).join('')}"/>
<path fill="${C.tower}" stroke="${C.edge}" stroke-width="1" d="${towers.join('')}"/>
<g fill="none" stroke-linecap="round" stroke-linejoin="round">
<path d="${river}" stroke="${C.waterEdge}" stroke-width="66"/>
<path d="${river}" stroke="${C.water}" stroke-width="58"/>
<path d="${streets.join('')}" stroke="${C.casing}" stroke-width="13"/>
<path d="${arterials.join('')}${diagonal}${ring}" stroke="${C.casing}" stroke-width="24"/>
<path d="${streets.join('')}" stroke="${C.road}" stroke-width="9"/>
<path d="${arterials.join('')}${diagonal}${ring}" stroke="${C.road}" stroke-width="18"/>
<path d="${highway}" stroke="${C.highwayCasing}" stroke-width="27"/>
<path d="${highway}" stroke="${C.highway}" stroke-width="20"/>
</g>
<ellipse cx="${lake.cx}" cy="${lake.cy}" rx="${lake.rx}" ry="${lake.ry}" fill="${C.water}" stroke="${C.waterEdge}" stroke-width="4"/>
</g>
</svg>
`;

const out = path.resolve('public/img/hero-map.svg');
await writeFile(out, svg);
console.log(`${out}  ${(svg.length / 1024).toFixed(1)} KB  ${buildings.length} buildings, ${towers.length} towers in ${compounds.length} societies, ${parks.length} parks, ${trees.length} trees`);

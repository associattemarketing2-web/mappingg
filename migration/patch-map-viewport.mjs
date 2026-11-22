// node migration/patch-map-viewport.mjs [--check]
//
// Map performance (22 Nov 2026, seo-doc/IMPLEMENTATION-PLAN.md Phase 2):
// the public map (public/legacy/public-map.json, also the home page's embedded
// map) drew one Leaflet DOM marker for EVERY project (≈935) — Lighthouse mobile:
// 6,198 DOM nodes, 7.5 s blocking time, one logo request per marker.
//
// This patch keeps all project data in memory exactly as before (search, filters,
// area lists, "nearby", compare and share all still work on the full `pins`
// array) and changes only which markers get a DOM element:
//   - viewport culling: a project marker is attached to the map only while it is
//     inside the (padded) visible area;
//   - clustering: below zoom 13, when many markers are in view, nearby ones are
//     drawn as one numbered bubble (click → zoom in). Featured (highlighted)
//     projects are never clustered;
//   - filters and search keep working unchanged: for project markers,
//     map.addLayer / removeLayer / hasLayer read and write a "wanted" flag, and
//     the next pass (debounced on moveend/zoomend) attaches what is wanted + in view;
//   - marker.openPopup() attaches a wanted marker immediately, so search,
//     share links and "nearby" still open the card at once.
// Kill switch: add ?vp=0 to the map URL to get the old behaviour.
//
// Idempotent: running it again on a patched file changes nothing.

import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'public/legacy/public-map.json';
const MARK = 'mgViewportCulling';
const check = process.argv.includes('--check');

const j = JSON.parse(readFileSync(FILE, 'utf8'));
const idx = j.scripts.findIndex((s) => s.code && s.code.includes('function renderPin(pin)'));
if (idx < 0) throw new Error('renderPin() not found in the map script');
let code = j.scripts[idx].code;

if (code.includes(MARK)) {
  console.log('[patch-map-viewport] already applied — nothing to do');
  process.exit(0);
}

const ANCHOR_MAP = '  const pinMarkerMap = new Map();\n';
const ANCHOR_MARKER = '    const marker = L.marker([pin.lat, pin.lng], {icon: pinIcon(pin)}).addTo(map);\n';
for (const [name, a] of [['pinMarkerMap', ANCHOR_MAP], ['renderPin marker', ANCHOR_MARKER]]) {
  const n = code.split(a).length - 1;
  if (n !== 1) throw new Error(`anchor "${name}" found ${n} times (expected 1) — the map script changed; review the patch`);
}

const BLOCK = `  const pinMarkerMap = new Map();

  // ---------- ${MARK} (22 Nov 2026) ----------
  // Only project markers inside the visible area get a DOM element, and at low
  // zoom crowded ones are grouped into numbered bubbles. All project data stays
  // in memory: filters/search still call map.addLayer/removeLayer/hasLayer on
  // project markers, which here read/write a "wanted" flag instead. ?vp=0 = off.
  const MG_VP_ON = (function(){ try { return new URLSearchParams(location.search).get('vp') !== '0'; } catch(_e){ return true; } })();
  const MG_CLUSTER_BELOW_ZOOM = 13;   // cluster only when zoomed out further than this
  const MG_CLUSTER_MIN_VISIBLE = 40;  // ...and only when this many markers are in view
  const MG_CLUSTER_CELL_PX = 60;      // grid cell size on screen
  const mgAdd = map.addLayer.bind(map), mgRemove = map.removeLayer.bind(map), mgHas = map.hasLayer.bind(map);
  const mgWanted = new Set();         // project markers that filters/search want shown
  const mgClusters = L.layerGroup();
  let mgTimer = null;
  function mgAttach(m){ if(!mgHas(m)) mgAdd(m); }
  function mgDetach(m){ if(mgHas(m) && !(m.isPopupOpen && m.isPopupOpen())) mgRemove(m); }
  function mgSchedule(delay){
    if(mgTimer) return;
    mgTimer = setTimeout(()=>{ mgTimer = null; requestAnimationFrame(mgPass); }, delay == null ? 120 : delay);
  }
  function mgPass(){
    const z = map.getZoom();
    const view = map.getBounds().pad(0.35);
    const inView = [];
    for(const m of mgWanted){
      if(view.contains(m.getLatLng())) inView.push(m);
      else mgDetach(m);
    }
    mgClusters.clearLayers();
    if(z >= MG_CLUSTER_BELOW_ZOOM || inView.length < MG_CLUSTER_MIN_VISIBLE){
      inView.forEach(mgAttach);
      return;
    }
    const cells = new Map();
    for(const m of inView){
      if(m._mgKeep || (m.isPopupOpen && m.isPopupOpen())){ mgAttach(m); continue; }
      const p = map.latLngToLayerPoint(m.getLatLng());
      const key = Math.floor(p.x / MG_CLUSTER_CELL_PX) + ':' + Math.floor(p.y / MG_CLUSTER_CELL_PX);
      if(!cells.has(key)) cells.set(key, []);
      cells.get(key).push(m);
    }
    cells.forEach(list=>{
      if(list.length === 1){ mgAttach(list[0]); return; }
      list.forEach(mgDetach);
      let lat = 0, lng = 0;
      list.forEach(m=>{ const ll = m.getLatLng(); lat += ll.lat; lng += ll.lng; });
      const n = list.length;
      const size = n >= 100 ? 52 : n >= 25 ? 46 : 40;
      const bubble = L.marker([lat / n, lng / n], {
        icon: L.divIcon({ className:'', html:'<div class="mg-cluster" style="width:'+size+'px;height:'+size+'px;"><b>'+n+'</b></div>', iconSize:[size, size], iconAnchor:[size/2, size/2] }),
        keyboard: true, title: n + ' projects — zoom in', alt: n + ' projects', riseOnHover: true,
      });
      bubble.on('click', ()=>{
        const b = L.latLngBounds(list.map(m => m.getLatLng()));
        map.flyToBounds(b, { padding:[70,70], maxZoom: Math.max(map.getZoom() + 2, MG_CLUSTER_BELOW_ZOOM), duration: 0.6 });
      });
      bubble.on('add', ()=>{ const el = bubble.getElement(); if(el) el.setAttribute('aria-label', n + ' projects here. Zoom in to see them'); });
      mgClusters.addLayer(bubble);
    });
  }
  /** Puts a project marker under viewport culling (no-op with ?vp=0). */
  function mgCullable(marker, pin){
    if(!MG_VP_ON) return marker;
    marker._mgCull = true;
    marker._mgKeep = !!(pin && pin.highlighted);   // featured projects are never clustered
    // Opening a card (search, share link, "nearby", deep links) must work even
    // while the marker is out of view or inside a bubble: attach it first.
    marker.openPopup = function(){
      if(mgWanted.has(this)) mgAttach(this);
      return L.Marker.prototype.openPopup.apply(this, arguments);
    };
    return marker;
  }
  if(MG_VP_ON){
    map.addLayer = function(layer){
      if(layer && layer._mgCull){ mgWanted.add(layer); mgSchedule(0); return map; }
      return mgAdd(layer);
    };
    map.removeLayer = function(layer){
      if(layer && layer._mgCull){ mgWanted.delete(layer); if(mgHas(layer)) mgRemove(layer); mgSchedule(); return map; }
      return mgRemove(layer);
    };
    map.hasLayer = function(layer){
      if(layer && layer._mgCull) return mgWanted.has(layer);
      return mgHas(layer);
    };
    mgAdd(mgClusters);
    map.on('moveend zoomend resize', ()=> mgSchedule());
    const css = document.createElement('style');
    css.textContent = '.mg-cluster{display:grid;place-items:center;border-radius:50%;background:rgba(15,75,58,.92);color:#fff;font:700 14px/1 Inter,system-ui,sans-serif;box-shadow:0 0 0 6px rgba(15,75,58,.22),0 6px 16px rgba(0,0,0,.22);cursor:pointer;transition:transform .15s}.mg-cluster:hover{transform:scale(1.08)}.mg-cluster b{font-weight:700}';
    document.head.appendChild(css);
  }
`;

code = code.replace(ANCHOR_MAP, BLOCK);
code = code.replace(
  ANCHOR_MARKER,
  '    const marker = mgCullable(L.marker([pin.lat, pin.lng], {icon: pinIcon(pin)}), pin).addTo(map);\n',
);

if (check) {
  new Function(code); // syntax check only
  console.log('[patch-map-viewport] --check: patch applies cleanly and parses');
  process.exit(0);
}
j.scripts[idx].code = code;
writeFileSync(FILE, JSON.stringify(j));
console.log('[patch-map-viewport] applied to', FILE);

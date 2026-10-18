// READ-ONLY review of the Pune/Mumbai developer-website records: what each still lacks, and what cached official
// evidence (developer pages already fetched) could fix. Proposes; never writes to the database.
const fs = require('fs'), path = require('path');
const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cache', 'pending-54.json'), 'utf8'));
const pages = new Map(); for (const f of fs.readdirSync(path.join(__dirname, '..', 'cache', 'pages'))) { const c = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cache', 'pages', f), 'utf8')); pages.set(c.url, c); }
const vis = (h) => h.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
const km = (a, b, c, d) => { const R = 6371, x = ((d - b) * Math.PI / 180) * Math.cos(((a + c) / 2) * Math.PI / 180), y = (c - a) * Math.PI / 180; return R * Math.hypot(x, y); };
const today = '2026-10-18', out = [];
for (const { id, d, e, a } of rows) {
  const f = e.fields, p = pages.get(f.developer_project_page), h = p?.html || '', t = vis(h);
  const gaps = [];
  if (!f.configurations) gaps.push('no BHK'); if (!f.proposed_completion) gaps.push('no possession'); else if (f.proposed_completion < today) gaps.push('possession passed');
  if (!['verified', 'manual'].includes(d.pin_check)) gaps.push(`pin ${d.pin_check}`); if (!d.locality || !d.project_name) gaps.push('no locality');
  // evidence available on the cached official page
  const pts = [...new Set([...h.matchAll(/!2d(7[2-4]\.\d+)!3d(1[89]\.\d+)/g)].map((m) => `${m[2]},${m[1]}`).concat([...h.matchAll(/@(1[89]\.\d{4,}),(7[2-4]\.\d{4,})/g)].map((m) => `${m[1]},${m[2]}`)))];
  const near = d.lat != null ? pts.map((s) => { const [la, ln] = s.split(',').map(Number); return { s, km: km(d.lat, d.lng, la, ln) }; }).sort((x, y) => x.km - y.km)[0] : null;
  const possCtx = [...t.matchAll(/.{0,90}\b(possession|completion|handover|ready by|delivery)\b.{0,90}/gi)].map((m) => m[0]).filter((s) => /20[2-4]\d|\b[2-4]\d\b/.test(s)).slice(0, 3);
  const bhkCtx = [...new Set((t.match(/\b\d(\.5)?\s*(&|,|and)?\s*\d?(\.5)?\s*BHK\b[^|]{0,40}/gi) || []))].slice(0, 4);
  out.push({ id, rera: d.rera_number, project: d.project_name, city: d.city, new_row: !!a, gaps: gaps.join('; '), lat: d.lat, lng: d.lng, pin_reason: d.pin_reason,
    page: f.developer_project_page, page_rera: f.rera_numbers_on_page, map_points_on_page: pts.join(' '), nearest_page_point_km: near ? +near.km.toFixed(2) : null,
    possession_context: possCtx.join(' || '), bhk_context: bhkCtx.join(' || ') });
}
fs.writeFileSync(path.join(__dirname, '..', 'cache', 'pending-review.json'), JSON.stringify(out, null, 1));
const c = (fn) => out.filter(fn).length;
console.log({ records: out.length, pin_not_ok: c((r) => /pin /.test(r.gaps)), pages_with_map_point: c((r) => r.map_points_on_page), pin_not_ok_with_point_within_1km: c((r) => /pin /.test(r.gaps) && r.nearest_page_point_km != null && r.nearest_page_point_km <= 1),
  no_coords_with_page_point: c((r) => r.lat == null && r.map_points_on_page), no_possession: c((r) => /no possession/.test(r.gaps)), no_possession_with_context: c((r) => /no possession/.test(r.gaps) && r.possession_context), no_bhk: c((r) => /no BHK/.test(r.gaps)) });

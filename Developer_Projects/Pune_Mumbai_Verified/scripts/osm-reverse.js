// Reverse-geocodes each sample record's registry point with OpenStreetMap Nominatim (1 request/second, cached).
// Usage policy: https://operations.osmfoundation.org/policies/nominatim/
const fs = require('fs'), path = require('path');
const sample = require('./sample-ids.js')();
const file = path.resolve(__dirname, '..', 'cache', 'osm-reverse.json');
const cache = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
(async () => {
  for (const { id, doc: { data: d } } of sample) {
    if (cache[id] || d.lat == null) continue;
    const u = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${d.lat}&lon=${d.lng}`;
    const res = await fetch(u, { headers: { 'User-Agent': 'Mappingg data verification (associattemarketing research; low volume)', 'Accept-Language': 'en' } });
    cache[id] = { url: u, fetched: new Date().toISOString(), status: res.status, body: res.ok ? await res.json() : null };
    fs.writeFileSync(file, JSON.stringify(cache, null, 1));
    const a = cache[id].body?.address || {};
    console.log(d.city, d.rera_number, '|', d.locality, d.pincode, '=> OSM', a.suburb || a.neighbourhood || a.village || a.town || '', a.city_district || '', a.postcode || '', '|', a.state_district || a.county || '');
    await new Promise((r) => setTimeout(r, 1200));
  }
  console.log('cached', Object.keys(cache).length);
})();

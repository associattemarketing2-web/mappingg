// Parse cached search-result pages into JSON records.
const fs = require('fs'), path = require('path');
const dec = s => s.replace(/&amp;/g, '&').replace(/&#039;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const field = (c, label) => { const m = c.match(new RegExp(label + '</div>\\s*<p>([\\s\\S]*?)</p>')); return m ? dec(m[1]) : ''; };
function parsePage(h, src) {
  const out = [];
  const body = h.slice(h.indexOf('Showing Final'));
  for (const c of body.split('<div class="row shadow p-3 mb-5 bg-body rounded">').slice(1)) {
    const reg = (c.match(/<p class="p-0">#\s*([^<]+)<\/p>/) || [])[1];
    if (!reg) continue;
    const loc = c.match(/maps\/search\/\?api=1&amp;query=([-\d.]*),([-\d.]*)"><em class="fa-solid fa-location-dot"><\/em>([^<]*)<\/a>/);
    const det = c.match(/href="(https:\/\/maharerait\.maharashtra\.gov\.in\/public\/project\/view\/(\d+))"/);
    out.push({
      reg_no: dec(reg),
      project_name: dec((c.match(/<h4 class="title4"><strong>([\s\S]*?)<\/strong>/) || [, ''])[1]),
      promoter: dec((c.match(/<p class="darkBlue bold ">([\s\S]*?)<\/p>/) || [, ''])[1]),
      location: loc ? dec(loc[3]) : '', lat: loc ? loc[1] : '', lng: loc ? loc[2] : '',
      state: field(c, 'State'), pincode: field(c, 'Pincode'), district: field(c, 'District'),
      last_modified: field(c, 'Last Modified'),
      has_certificate: /DocProjectCert"/.test(c) ? 'Yes' : 'No',
      has_extension_cert: /DocProjectExtCert/.test(c) ? 'Yes' : 'No',
      detail_url: det ? det[1] : '', portal_id: det ? det[2] : '', src
    });
  }
  return out;
}
module.exports = { parsePage };
if (require.main === module) {
  const [dir] = process.argv.slice(2);
  const files = fs.readdirSync(dir).filter(f => /^p\d+\.html$/.test(f)).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
  let all = []; for (const f of files) all = all.concat(parsePage(fs.readFileSync(path.join(dir, f), 'utf8'), f));
  console.log(JSON.stringify(all.slice(0, 3), null, 1)); console.log('records', all.length, 'files', files.length);
}

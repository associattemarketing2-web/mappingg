// The 20 + 20 sample: newest MahaRERA registrations (highest portal sequence) by company/firm promoters, status not closed.
const C = require('./common.js');
module.exports = function sample() {
  const r = C.loadRecords().filter(({ doc: { data: d } }) => C.isCompany(d.developer_name) && !/Lapsed|Dereg|Abey/i.test(d.status_category || ''));
  const out = [];
  for (const city of ['Pune', 'Mumbai']) out.push(...r.filter((x) => x.doc.data.city === city).sort((a, b) => b.doc.data.portal_seq - a.doc.data.portal_seq).slice(0, 20));
  return out;
};

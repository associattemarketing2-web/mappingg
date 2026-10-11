// Parse official MahaRERA status lists (HTML tables) cached in raw/.
const fs = require('fs'), path = require('path');
const B = 'https://www.maharera.maharashtra.gov.in';
const cell = s => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#039;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const rows = h => [...h.matchAll(/<tr[\s\S]*?<\/tr>/g)].map(m => [...m[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => cell(c[1])));
const REG = /^P\d{11}$/;
function load(rawDir) {
  const rd = f => fs.readFileSync(path.join(rawDir, f), 'utf8');
  const out = {};
  out.lapse = rows(rd('due-lapse-completion-date.html')).slice(1).filter(r => REG.test(r[1]))
    .map(r => ({ reg_no: r[1], promoter: r[2], project_name: r[3], district: r[4] }));
  out.qpr = rows(rd('due-non-compliance-qpr.html')).slice(1).filter(r => REG.test(r[3]))
    .map(r => ({ reg_no: r[3], promoter: r[1], project_name: r[2], district: r[4], detail: `QPR period ${r[5]} ${r[6]}` }));
  out.cba = [];
  for (const r of rows(rd('common-bank-account.html')).slice(1)) {
    if (REG.test(r[3])) out.cba.push({ reg_no: r[3], promoter: r[1], project_name: r[2], district: r[4], detail: `Shares account with ${r[8]}` });
    if (REG.test(r[8])) out.cba.push({ reg_no: r[8], promoter: r[6], project_name: r[7], district: r[9], detail: `Shares account with ${r[3]}` });
  }
  out.nclt = rows(rd('nclt-projects.html')).slice(1).filter(r => REG.test(r[3]))
    .map(r => ({ reg_no: r[3], promoter: r[1], project_name: r[2], proposed_completion: r[4], district: r[6], taluka: r[7], status_jan2025: r[8], form4: r[9] }));
  out.dereg = rows(rd('list_of_projects_deregistered.html')).slice(1).filter(r => REG.test(r[3]))
    .map(r => ({ reg_no: r[3], project_name: r[1], promoter: r[2], planning_authority: r[4] }));
  const revFiles = ['projects-registration-revoked-initio-void.html', ...fs.readdirSync(rawDir).filter(f => /^rev_p\d+\.html$/.test(f))];
  out.revokedList = [];
  for (const f of revFiles) for (const r of rows(rd(f)).slice(1)) if (r.length >= 3 && r[1]) out.revokedList.push({ project_name: r[1], promoter: r[2] });
  out.urls = {
    lapse: `${B}/due-lapse-completion-date`, qpr: `${B}/due-non-compliance-qpr`, cba: `${B}/common-bank-account`,
    nclt: `${B}/nclt-projects`, dereg: `${B}/list_of_projects_deregistered`, revokedList: `${B}/projects-registration-revoked-initio-void`
  };
  return out;
}
module.exports = { load };
if (require.main === module) { const o = load(process.argv[2]); for (const k in o) if (Array.isArray(o[k])) console.log(k, o[k].length, JSON.stringify(o[k][0])); }

// Targeted single-stream MahaRERA fetch of specific pages (newest = last pages). Checkpointed, stops on persistent throttling.
// Usage: node crawl4.js <dataDir> "t0_d519:121-130,t0_d518:624-633"   env: DELAY_MS (12000), MAX_COOLOFFS (2), COOLOFF_S (300), BUDGET_MIN (60)
const fs = require('fs'), path = require('path');
const [dataDir, spec] = process.argv.slice(2);
const DELAY = +(process.env.DELAY_MS || 12000), MAX_COOLOFFS = +(process.env.MAX_COOLOFFS || 2), COOLOFF = +(process.env.COOLOFF_S || 300) * 1000, BUDGET = +(process.env.BUDGET_MIN || 60) * 60000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = m => console.log(`${new Date().toISOString()} ${m}`);
const ckFile = path.join(dataDir, 'checkpoint.json');
const ck = fs.existsSync(ckFile) ? JSON.parse(fs.readFileSync(ckFile, 'utf8')) : { jobs: {}, sessions: [] };
const good = h => /colorBlue">\d+/.test(h) && h.includes('# P');
const url = (d, t, p) => `https://www.maharera.maharashtra.gov.in/projects-search-result?project_name=&project_location=&project_completion_date=&project_state=27&project_district=${d}&carpetAreas=&completionPercentages=&project_division=&page=${p}&op=` + (t === '1' ? '&project_type=1' : '');
const queue = [];
for (const part of spec.split(',')) { const [key, r] = part.split(':'); const [a, b] = r.split('-').map(Number); for (let p = b; p >= a; p--) queue.push([key, p]); } // newest first
(async () => {
  const start = Date.now(), session = { started: new Date().toISOString(), spec, ok: 0, throttled: 0, cooloffs: 0 }; ck.sessions.push(session);
  let consec = 0, reason = 'queue complete';
  for (const [key, p] of queue) {
    const [, t, d] = key.match(/t(\d)_d(\d+)/); const dir = path.join(dataDir, key); fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `p${p}.html`);
    if (fs.existsSync(f) && good(fs.readFileSync(f, 'utf8'))) continue;
    if (Date.now() - start > BUDGET) { reason = 'time budget reached'; break; }
    const j = ck.jobs[key] || (ck.jobs[key] = { attempts: {}, failed: [], ok: [] });
    j.attempts[p] = (j.attempts[p] || 0) + 1;
    let ok = false;
    try { const r = await fetch(url(d, t, p), { headers: { 'User-Agent': 'Mozilla/5.0 (research; low-rate)' }, signal: AbortSignal.timeout(60000) }); const h = await r.text();
      if (r.ok && good(h)) { fs.writeFileSync(f, h); ok = true; session.ok++; consec = 0; j.failed = j.failed.filter(x => x !== p); log(`ok ${key} p${p}`); }
      else log(`throttled/empty ${key} p${p} (HTTP ${r.status}, ${h.length} bytes)`);
    } catch (e) { log(`error ${key} p${p}: ${e.message}`); }
    if (!ok) { session.throttled++; consec++; if (!j.failed.includes(p)) j.failed.push(p); }
    fs.writeFileSync(ckFile, JSON.stringify(ck, null, 1));
    if (!ok && consec >= 2) { if (session.cooloffs >= MAX_COOLOFFS) { reason = `still throttled after ${MAX_COOLOFFS} cool-offs`; break; } session.cooloffs++; log(`cooling off ${COOLOFF / 1000}s`); await sleep(COOLOFF); consec = 0; }
    else await sleep(DELAY);
  }
  session.ended = new Date().toISOString(); session.stopReason = reason; fs.writeFileSync(ckFile, JSON.stringify(ck, null, 1));
  log(`STOPPED: ${reason}. ok=${session.ok} throttled=${session.throttled}`);
})();

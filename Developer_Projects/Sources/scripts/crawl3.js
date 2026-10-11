// Bounded, single-stream, checkpointed crawler for MahaRERA public project search.
// Stops (rather than pushing) when the portal keeps throttling.
// Usage: node crawl3.js <dataDir>   env: DELAY_MS (8000), BUDGET_MIN (60), MAX_COOLOFFS (2), COOLOFF_S (300)
const fs = require('fs'), path = require('path');
const dataDir = process.argv[2];
const DELAY = +(process.env.DELAY_MS || 8000), BUDGET = +(process.env.BUDGET_MIN || 60) * 60000;
const MAX_COOLOFFS = +(process.env.MAX_COOLOFFS || 2), COOLOFF = +(process.env.COOLOFF_S || 300) * 1000;
const MAX_ATTEMPTS_PER_PAGE = 2;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ckFile = path.join(dataDir, 'checkpoint.json');
const ck = fs.existsSync(ckFile) ? JSON.parse(fs.readFileSync(ckFile, 'utf8')) : { jobs: {}, sessions: [] };
const save = () => fs.writeFileSync(ckFile, JSON.stringify(ck, null, 1));
const log = m => console.log(`${new Date().toISOString()} ${m}`);
const url = (d, t, p) => `https://www.maharera.maharashtra.gov.in/projects-search-result?project_name=&project_location=&project_completion_date=&project_state=27&project_district=${d}&carpetAreas=&completionPercentages=&project_division=&page=${p}&op=` + (t === '1' ? '&project_type=1' : '');
const good = h => /colorBlue">\d+/.test(h) && h.includes('# P');
// Job order: revoked (statewide, small) first, then registered districts smallest-first.
const JOBS = [['1', '0'], ['0', '519'], ['0', '990'], ['0', '520'], ['0', '518'], ['0', '517'], ['0', '521']];

function jobState(t, d) {
  const key = `t${t}_d${d}`, dir = path.join(dataDir, key);
  fs.mkdirSync(dir, { recursive: true });
  const meta = fs.existsSync(path.join(dir, 'meta.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'))) : null;
  const j = ck.jobs[key] || (ck.jobs[key] = { attempts: {}, failed: [] });
  j.total = meta ? meta.total : j.total; j.pages = meta ? meta.pages : j.pages;
  j.ok = fs.readdirSync(dir).filter(f => /^p\d+\.html$/.test(f) && good(fs.readFileSync(path.join(dir, f), 'utf8'))).map(f => parseInt(f.slice(1))).sort((a, b) => a - b);
  return { key, dir, j };
}
(async () => {
  const start = Date.now(), session = { started: new Date().toISOString(), ok: 0, throttled: 0, cooloffs: 0 };
  ck.sessions.push(session);
  let consecutiveThrottle = 0, stopReason = 'all jobs complete';
  async function fetchPage(t, d, p, st) {
    st.j.attempts[p] = (st.j.attempts[p] || 0) + 1;
    try {
      const r = await fetch(url(d, t, p), { headers: { 'User-Agent': 'Mozilla/5.0 (research; low-rate)' }, signal: AbortSignal.timeout(60000) });
      const h = await r.text();
      if (r.ok && good(h)) {
        fs.writeFileSync(path.join(st.dir, `p${p}.html`), h);
        if (p === 1) { const total = +h.match(/colorBlue">(\d+)/)[1]; fs.writeFileSync(path.join(st.dir, 'meta.json'), JSON.stringify({ district: d, type: t, total, pages: Math.ceil(total / 10), fetchedAt: new Date().toISOString() })); st.j.total = total; st.j.pages = Math.ceil(total / 10); }
        st.j.failed = st.j.failed.filter(x => x !== p); session.ok++; consecutiveThrottle = 0; log(`ok ${st.key} p${p}`);
        return true;
      }
      log(`throttled/empty ${st.key} p${p} (HTTP ${r.status}, ${h.length} bytes)`);
    } catch (e) { log(`error ${st.key} p${p}: ${e.message}`); }
    session.throttled++; consecutiveThrottle++;
    if (st.j.attempts[p] >= MAX_ATTEMPTS_PER_PAGE && !st.j.failed.includes(p)) st.j.failed.push(p);
    return false;
  }
  outer:
  for (const [t, d] of JOBS) {
    const st = jobState(t, d);
    const pending = () => { const ok = new Set(st.j.ok); const out = []; for (let p = 1; p <= (st.j.pages || 1); p++) if (!ok.has(p)) out.push(p); return out; };
    for (let queue = pending(); queue.length; queue = pending().filter(p => (st.j.attempts[p] || 0) < MAX_ATTEMPTS_PER_PAGE)) {
      for (const p of queue) {
        if (Date.now() - start > BUDGET) { stopReason = 'time budget reached'; break outer; }
        const ok = await fetchPage(t, d, p, st);
        if (ok) st.j.ok.push(p);
        save();
        if (!ok && consecutiveThrottle >= 2) {
          if (session.cooloffs >= MAX_COOLOFFS) { stopReason = `portal still throttling after ${MAX_COOLOFFS} cool-offs of ${COOLOFF / 1000}s`; break outer; }
          session.cooloffs++; log(`cooling off ${COOLOFF / 1000}s (${session.cooloffs}/${MAX_COOLOFFS})`); await sleep(COOLOFF); consecutiveThrottle = 0;
        } else await sleep(DELAY);
        if (st.j.pages && p === 1 && ok) break; // page count now known; rebuild queue
      }
      if (!st.j.pages) break;
    }
  }
  session.ended = new Date().toISOString(); session.stopReason = stopReason; save();
  log(`STOPPED: ${stopReason}. Session ok=${session.ok} throttled=${session.throttled}`);
})();

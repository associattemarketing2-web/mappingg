/* Mappingg landing-page behaviour. Loaded by components/landing/LandingClient.tsx
 * after three.js. Wrapped in an IIFE so re-injection never clashes with globals.
 * "Live map" points at the in-app /map route. Buyer/developer/agent accounts are
 * real (MongoDB + JWT via /api/auth/*): buyers land on /map, developers/agents on /dashboard. */
(function () {
  'use strict';

  // This script re-runs on every client-side navigation back to the landing
  // page (see LandingClient.tsx). The DOM is rebuilt each time, so we first tear
  // down the previous run's window/document listeners and the globe animation
  // loop, then re-wire everything against the fresh DOM. `on()` registers a
  // listener and its removal; `__cleanups` is drained by `__mpgCleanup`.
  if (window.__mpgCleanup) { try { window.__mpgCleanup(); } catch (e) { /* ignore */ } }
  const __cleanups = [];
  const on = (target, evt, handler, opts) => {
    target.addEventListener(evt, handler, opts);
    __cleanups.push(() => target.removeEventListener(evt, handler, opts));
  };
  window.__mpgCleanup = () => {
    __cleanups.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
    window.__mpgCleanup = null;
  };

  const byId = id => document.getElementById(id);
  function toast(msg, icon) {
    const t = byId('toast'); if (!t) return;
    t.innerHTML = `<i class="fas ${icon || 'fa-circle-check'}"></i><span>${msg}</span>`; t.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 3000);
  }

  /* ---------- Nav ---------- */
  const menuBtn = byId('menuBtn'), mobileMenu = byId('mobileMenu');
  const setMenu = open => { mobileMenu.classList.toggle('is-open', open); menuBtn.setAttribute('aria-expanded', open); menuBtn.innerHTML = open ? '<i class="fas fa-times"></i>' : '<i class="fas fa-bars"></i>'; };
  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener('click', e => { e.stopPropagation(); setMenu(!mobileMenu.classList.contains('is-open')); });
    mobileMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setMenu(false)));
    document.addEventListener('click', e => { if (!mobileMenu.contains(e.target)) setMenu(false); });
  }
  const nav = byId('nav');
  const spy = ['home', 'live-map', 'how', 'features', 'faq'].map(id => byId(id));
  const links = document.querySelectorAll('.nav-menu a, .mobile-menu > a');
  const onScroll = () => {
    if (nav) nav.classList.toggle('scrolled', scrollY > 20);
    let cur = 'home'; spy.forEach(s => { if (s && scrollY >= s.offsetTop - 220) cur = s.id; });
    links.forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + cur));
  };
  on(window, 'scroll', onScroll, { passive: true }); onScroll();
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } }), { threshold: .12, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));

  /* ---------- Live map trial: 3 free taps, then sign-in ---------- */
  const LIVE_MAP_URL = '/map';
  const FREE_TAPS = 3, TAP_KEY = 'mappingg_free_taps';
  const liveFrame = byId('liveFrame'), liveBrowser = byId('liveBrowser'), mapLock = byId('mapLock');
  if (liveBrowser && liveFrame) {
    new IntersectionObserver((es, obs) => es.forEach(e => { if (e.isIntersecting) { liveFrame.src = liveFrame.dataset.src; obs.disconnect(); } }), { rootMargin: '300px' }).observe(liveBrowser);
  }
  let taps = 0; try { taps = +localStorage.getItem(TAP_KEY) || 0; } catch (e) {}
  let lastTap = 0;
  function renderMapAccess() {
    if (!liveBrowser) return;
    const signedIn = typeof getUser === 'function' && getUser();
    const left = Math.max(0, FREE_TAPS - taps), locked = !signedIn && left === 0;
    liveBrowser.classList.toggle('unlocked', !!signedIn);
    liveBrowser.classList.toggle('locked', locked);
    if (mapLock) mapLock.hidden = !locked;
    if (byId('mapHint')) byId('mapHint').hidden = !!signedIn || locked;
    if (byId('tapLeft')) byId('tapLeft').textContent = left;
    if (byId('tapState')) byId('tapState').textContent = signedIn ? 'Full access' : locked ? 'Sign in to continue' : `${left} search${left === 1 ? '' : 'es'} left`;
  }
  function countTap() {
    if (typeof getUser === 'function' && getUser()) return;
    const now = Date.now(); if (now - lastTap < 400) return; lastTap = now;
    taps = Math.min(FREE_TAPS, taps + 1);
    try { localStorage.setItem(TAP_KEY, taps); } catch (e) {}
    renderMapAccess();
    if (taps >= FREE_TAPS) setTimeout(() => openModal('signup', null, 'No charge for buyers — takes under a minute.'), 450);
    else toast(`${FREE_TAPS - taps} search${FREE_TAPS - taps === 1 ? '' : 'es'} left on the live map`, 'fa-hand-pointer');
  }
  on(window, 'blur', () => {
    setTimeout(() => {
      if (document.activeElement !== liveFrame) return;
      countTap();
      if (liveFrame) liveFrame.blur(); window.focus();
    }, 0);
  });
  on(window, 'message', e => {
    if (!/^https:\/\/(www\.)?mappingg\.com$/.test(e.origin)) return;
    if (e.data && e.data.type === 'mappingg:pin-click') countTap();
  });
  if (mapLock) {
    mapLock.querySelectorAll('.lock-buyer, .lock-others button').forEach(b => b.addEventListener('click', () => openModal('signup', b.dataset.role, 'No charge for buyers — takes under a minute.')));
  }
  if (byId('lockSignin')) byId('lockSignin').addEventListener('click', () => openModal('signin', null, 'Sign in to keep exploring the live map.'));
  function openLiveMap() { window.open(LIVE_MAP_URL, '_blank', 'noopener'); }
  document.querySelectorAll('.live-link').forEach(a => a.addEventListener('click', e => {
    if (getUser()) return;
    e.preventDefault(); openModal('signup', null, 'Sign in to open the live map.');
  }));

  /* ---------- Hero search ---------- */
  if (byId('heroAskForm')) byId('heroAskForm').addEventListener('submit', e => {
    e.preventDefault();
    if (!getUser()) { openModal('signup', null, 'Sign in to search projects on the live map.'); return; }
    openLiveMap();
  });

  /* ---------- "See every project, differently" (illustrative area map) ---------- */
  (function () {
    const lv = byId('lv'), svg = byId('lvSvg'), card = byId('lvCard');
    if (!lv || !svg || !card) return;
    const river = 'M-30 255 C 120 205 250 300 400 262 S 650 172 790 222 S 950 300 1030 268';
    const roads = ['M235 -10 L 262 610', 'M520 -10 C 540 200 498 400 540 610', 'M770 -10 L 742 610', 'M-10 395 C 300 360 700 380 1010 335', 'M90 -10 C 120 200 60 400 110 610'];
    const hwys = ['M-20 92 C 300 122 600 58 1020 108', 'M-20 522 C 300 500 650 562 1020 518'];
    let s = `
      <defs>
        <pattern id="lvFields" width="90" height="90" patternUnits="userSpaceOnUse" patternTransform="rotate(14)">
          <rect width="90" height="90" fill="#5d6843"/><rect width="45" height="90" fill="#657048"/>
          <path d="M0 22H90M0 67H90" stroke="#545f3b" stroke-width="3"/>
          <circle cx="22" cy="45" r="8" fill="#4a5832"/><circle cx="70" cy="12" r="5" fill="#4a5832"/><circle cx="60" cy="78" r="6" fill="#4a5832"/>
        </pattern>
      </defs>
      <rect class="land" width="1000" height="600"/>
      <rect class="sat-tex" width="1000" height="600" fill="url(#lvFields)"/>`;
    for (let r = 0; r < 7; r++) for (let c = 0; c < 11; c++) {
      if ((r * 11 + c) % 5 === 2) continue;
      const x = 12 + c * 91 + (r % 2) * 18, y = 14 + r * 86;
      s += `<rect class="block" x="${x}" y="${y}" width="${62 + (c * 13 + r * 7) % 18}" height="${48 + (c * 7 + r * 11) % 16}" rx="7"/>`;
    }
    s += `<path class="park" d="M600 408h118v84H600z"/><path class="park" d="M300 150c40-26 110-18 128 20s-20 62-78 60-90-52-50-80z"/><rect class="park" x="868" y="400" width="110" height="80" rx="16"/><rect class="park" x="30" y="440" width="120" height="60" rx="16"/>
      <path class="river-edge" d="${river}"/><path class="river" d="${river}"/>
      ${roads.map(d => `<path class="rd-case" d="${d}"/>`).join('')}${roads.map(d => `<path class="rd" d="${d}"/>`).join('')}
      ${hwys.map(d => `<path class="hw-case" d="${d}"/>`).join('')}${hwys.map(d => `<path class="hw" d="${d}"/>`).join('')}
      <text class="road-lbl" x="300" y="98" transform="rotate(2 300 98)">NAGAR ROAD</text>
      <text class="road-lbl" x="640" y="545" transform="rotate(1.5 640 545)">SOLAPUR HIGHWAY</text>
      <text class="road-lbl water" x="560" y="222" transform="rotate(-12 560 222)">MULA-MUTHA RIVER</text>`;
    const AREAS = [['VIMAN NAGAR', 380, 48], ['KHARADI', 870, 168], ['KALYANI NAGAR', 170, 178], ['KOREGAON PARK', 130, 338], ['MUNDHWA', 560, 318], ['KESHAV NAGAR', 700, 272], ['MAGARPATTA', 400, 430], ['HADAPSAR', 765, 468], ['WAGHOLI', 860, 50]];
    s += AREAS.map(([n, x, y]) => `<text class="area-lbl" x="${x}" y="${y}" text-anchor="middle">${n}</text>`).join('');

    const P = [[120,140,'available'],[190,215,'construction'],[300,118,'sold'],[385,192,'available'],[455,130,'upcoming'],[600,150,'available'],[660,86,'construction'],[722,180,'sold'],[820,122,'available'],[900,205,'construction'],[955,112,'upcoming'],
               [70,402,'available'],[170,330,'sold'],[262,378,'construction'],[360,330,'available'],[470,392,'available'],[590,302,'construction'],[640,378,'sold'],[722,322,'available'],[822,362,'upcoming'],[925,382,'available'],
               [125,478,'construction'],[330,472,'available'],[430,545,'sold'],[560,462,'available'],[682,482,'construction'],[800,555,'available'],[905,470,'sold']];
    const CONF = ['2, 3 BHK', '1, 2 BHK', '3, 4 BHK', '2 BHK', 'Row houses', '3 BHK'];
    const POSS = ['Dec 2026', 'Jun 2027', 'Mar 2028', 'Dec 2028'];
    const nearestArea = (x, y) => AREAS.reduce((b, a) => { const d = (a[1] - x) ** 2 + (a[2] - y) ** 2; return d < b[1] ? [a[0], d] : b; }, ['', 1e9])[0];
    const title = t => t.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    const PLOTTED = new Set([6, 13, 19, 25]);
    const pins = P.map(([x, y, st], k) => ({ id: k + 1, x, y, st, area: title(nearestArea(x, y)), conf: PLOTTED.has(k + 1) ? '36 plots' : CONF[k % CONF.length], poss: POSS[k % POSS.length], plotted: PLOTTED.has(k + 1) }));
    s += `<g class="infra" aria-hidden="true">
        <path d="M740 -10 C 900 140 965 330 870 610" fill="none" stroke="#3f7fb3" stroke-width="9" stroke-dasharray="16 10" stroke-linecap="round" opacity=".85"/>
        <path d="M244 300 L 256 470" fill="none" stroke="#3f7fb3" stroke-width="18" stroke-dasharray="14 8" stroke-linecap="round" opacity=".55"/>
        <path d="M-10 182 C 200 172 380 122 560 140 S 850 118 1010 150" fill="none" stroke="#c9861f" stroke-width="7" stroke-linecap="round"/>
        <path d="M-10 182 C 200 172 380 122 560 140 S 850 118 1010 150" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="6 8"/>
        ${[[300,158],[560,140],[800,127]].map(([x,y]) => `<circle cx="${x}" cy="${y}" r="9" fill="#fff" stroke="#c9861f" stroke-width="4"/>`).join('')}
        <path d="M370 511 C 430 505 490 509 550 520" fill="none" stroke="#23291f" stroke-width="16" stroke-linecap="round" opacity=".25"/>
        <path d="M370 511 C 430 505 490 509 550 520" fill="none" stroke="#c9861f" stroke-width="9" stroke-linecap="round"/>
        <path d="M648 172 L 662 250" fill="none" stroke="#23291f" stroke-width="16" stroke-linecap="round" opacity=".25"/>
        <path d="M648 172 L 662 250" fill="none" stroke="#2f7a3c" stroke-width="10" stroke-linecap="round"/>
      </g>`;
    s += pins.map(p => `<g class="mpin ${p.st}" data-id="${p.id}" transform="translate(${p.x} ${p.y})" tabindex="0" role="button" aria-label="Sample project ${p.id}, ${p.st}${p.plotted ? ', plotted project' : ''}"><g class="body"><path d="M0 0 C -8 -11 -13 -17 -13 -25 A 13 13 0 1 1 13 -25 C 13 -17 8 -11 0 0Z"/>${p.plotted ? '<rect x="-6" y="-31" width="12" height="12" rx="2" fill="#fff"/><path class="grid" d="M-6 -25H6M0 -31V-19"/>' : '<circle cy="-25" r="5" fill="#fff"/>'}</g></g>`).join('');
    svg.innerHTML = s;

    const LABEL = { available: 'Available', construction: 'Under construction', sold: 'Sold', upcoming: 'Upcoming' };
    byId('lvCounts').textContent = '· 100+ projects';
    const hidden = new Set();
    document.querySelectorAll('#lvLegend button').forEach(b => {
      b.querySelector('b').textContent = pins.filter(p => p.st === b.dataset.st).length;
      b.setAttribute('aria-pressed', 'true');
      b.addEventListener('click', () => {
        const st = b.dataset.st; hidden.has(st) ? hidden.delete(st) : hidden.add(st);
        b.classList.toggle('off', hidden.has(st)); b.setAttribute('aria-pressed', !hidden.has(st));
        svg.querySelectorAll('.mpin').forEach(g => g.classList.toggle('off', hidden.has(g.classList[1])));
        const sel = svg.querySelector('.mpin.sel'); if (sel && sel.classList.contains('off')) clear();
      });
    });

    function select(p) {
      svg.querySelectorAll('.mpin').forEach(g => g.classList.toggle('sel', +g.dataset.id === p.id));
      const sel = svg.querySelector(`.mpin[data-id="${p.id}"]`); sel.parentNode.appendChild(sel);
      const up = p.st === 'upcoming', ready = p.st === 'available' && p.id % 3 === 0;
      card.innerHTML = `
        <div class="lv-card-head"><div><b>Sample Project ${p.id}</b><small>${p.area}, Pune</small></div><button class="lv-close" aria-label="Close project details"><i class="fas fa-xmark"></i></button></div>
        <span class="lv-status ${p.st}"><i class="fas fa-circle" style="font-size:7px"></i>${LABEL[p.st]}</span>${p.plotted ? '<span class="lv-plot-tag"><i class="fas fa-border-all"></i>Plotted project</span>' : ''}
        <div class="lv-grid">
          <div>Configuration<strong>${p.conf}</strong></div>
          <div>Possession<strong>${up ? 'To be announced' : p.st === 'sold' || ready ? 'Ready' : p.poss}</strong></div>
          <div>MahaRERA${up ? '' : ' <em class="rera-ok"><i class="fas fa-circle-check"></i></em>'}<strong>${up ? 'Not yet registered' : 'P5210XXXXXXX'}</strong></div>
          <div>Metro<strong>${(1 + (p.id * 7) % 40 / 10).toFixed(1)} km</strong></div>
        </div>
        <div class="lv-btns">${p.plotted ? '<button type="button" class="btn btn-primary btn-sm lv-layout"><i class="fas fa-border-all"></i> View plot layout</button>' : ''}<button type="button" class="btn ${p.plotted ? 'btn-outline' : 'btn-primary'} btn-sm lv-open"><i class="fas fa-map-location-dot"></i> Open the live map</button></div>
        ${up ? '' : '<a class="rera-link" href="https://maharera.maharashtra.gov.in/" target="_blank" rel="noopener"><i class="fas fa-shield-halved"></i> RERA no. verified on MahaRERA — check it yourself <i class="fas fa-arrow-up-right-from-square"></i></a>'}
        <p class="sample">Sample project for illustration.</p>`;
      card.classList.add('show');
      card.querySelector('.lv-close').addEventListener('click', clear);
      const lay = card.querySelector('.lv-layout'); if (lay) lay.addEventListener('click', () => showPlan(p));
      card.querySelector('.lv-open').addEventListener('click', () => {
        if (typeof getUser === 'function' && getUser()) window.open('/map', '_blank', 'noopener');
        else openModal('signup', null, 'Sign in to open the live map.');
      });
    }
    function clear() { card.classList.remove('show'); svg.querySelectorAll('.mpin.sel').forEach(g => g.classList.remove('sel')); }
    const pick = el => { const g = el.closest && el.closest('.mpin'); if (g) select(pins[+g.dataset.id - 1]); return !!g; };
    svg.addEventListener('click', e => { if (!pick(e.target)) clear(); });
    svg.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && pick(e.target)) e.preventDefault(); });

    const INFRA = [
      { name: 'Metro line extension', type: 'Metro', st: 'ongoing', when: 'Expected 2027', impact: 'Faster access to the city centre and airport' },
      { name: 'Outer ring road', type: 'Road', st: 'planned', when: 'Proposed', impact: 'Less traffic through local roads' },
      { name: 'Highway flyover', type: 'Flyover', st: 'ongoing', when: 'Expected 2026', impact: 'Non-stop, signal-less movement on the highway' },
      { name: 'New river bridge', type: 'Bridge', st: 'completed', when: 'Opened 2025', impact: 'Shorter trips across the river' },
      { name: 'Road widening to 24 m', type: 'Road', st: 'planned', when: 'Proposed', impact: 'Wider road outside nearby projects' }
    ];
    const IST = { completed: 'Completed', ongoing: 'Ongoing', planned: 'Planned' };
    function selectInfra(k) {
      const it = INFRA[k];
      document.querySelectorAll('.lv-ibtn').forEach(b => b.classList.toggle('sel', +b.dataset.i === k));
      card.innerHTML = `
        <div class="lv-card-head"><div><b>${it.name}</b><small>Pune East · Infrastructure</small></div><button class="lv-close" aria-label="Close details"><i class="fas fa-xmark"></i></button></div>
        <span class="lv-status i-${it.st}"><i class="fas fa-circle" style="font-size:7px"></i>${IST[it.st]}</span>
        <div class="lv-grid"><div>Type<strong>${it.type}</strong></div><div>Timeline<strong>${it.when}</strong></div></div>
        <p class="i-impact"><i class="fas fa-arrow-trend-up"></i>${it.impact}</p>
        <p class="sample">Sample infrastructure for illustration.</p>`;
      card.classList.add('show');
      card.querySelector('.lv-close').addEventListener('click', clearInfra);
    }
    function clearInfra() { card.classList.remove('show'); document.querySelectorAll('.lv-ibtn.sel').forEach(b => b.classList.remove('sel')); }
    document.querySelectorAll('.lv-ibtn').forEach(b => b.addEventListener('click', () => selectInfra(+b.dataset.i)));

    const plan = byId('lvPlan');
    const tree = (x, y, r) => `<g transform="translate(${x} ${y})"><circle r="${r}" class="tree-a"/><circle cx="${-r * .3}" cy="${-r * .3}" r="${r * .6}" class="tree-b"/></g>`;
    let ps = `
      <defs><linearGradient id="lvWater" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfe7f7"/><stop offset="1" stop-color="#8ec3ea"/></linearGradient></defs>
      <rect class="p-land" width="1000" height="600"/>
      <rect class="road-main" x="-4" y="566" width="1008" height="38"/><path class="road-main-line" d="M0 585H1000"/>
      <text class="map-lbl" x="650" y="590" text-anchor="middle">18 M MAIN ROAD</text>
      <rect class="site" x="40" y="40" width="920" height="518" rx="16"/>
      <rect class="road" x="40" y="280" width="920" height="40"/><rect class="road" x="480" y="40" width="40" height="526"/>
      <path class="road-line" d="M60 300H470M530 300H940M500 60V270M500 330V550"/>
      <rect class="garden" x="70" y="335" width="180" height="195" rx="24"/><rect class="track" x="88" y="353" width="144" height="159" rx="18"/>
      ${[[120, 395, 16], [175, 385, 13], [205, 440, 17], [130, 470, 14], [175, 488, 11], [115, 428, 9]].map(t => tree(...t)).join('')}
      <rect class="club" x="275" y="335" width="180" height="82" rx="12"/><text class="a-lbl" x="365" y="381" text-anchor="middle">Clubhouse</text>
      <rect class="pool" x="275" y="432" width="180" height="98" rx="20"/><path class="lane" d="M295 458H435M295 481H435M295 504H435"/>
      <rect class="gate" x="470" y="552" width="10" height="16" rx="2"/><rect class="gate" x="520" y="552" width="10" height="16" rx="2"/>
      ${[85, 115, 145, 175, 205, 235, 262].map(y => tree(470, y, 8)).join('')}
      ${[85, 118, 151, 184, 217, 250, 350, 390, 430, 470, 510].map(y => tree(941, y, 9)).join('')}`;
    const pmap = { A: 'available', B: 'booked', S: 'sold' };
    const plots = []; let n = 1;
    [[70, 70], [530, 70], [530, 336]].forEach(([x0, y0]) => {
      for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) {
        const x = x0 + c * 66, y = y0 + r * 102;
        plots.push({ n, x, y, road: r === 0 && y0 === 70 ? '9 m' : '12 m', st: 'available' });
        ps += `<rect class="plot" data-n="${n}" x="${x}" y="${y}" width="60" height="92" rx="6" tabindex="0" role="button"/><text class="p-num" x="${x + 30}" y="${y + 51}" text-anchor="middle">${n}</text>`;
        n++;
      }
    });
    plan.innerHTML = ps;
    const PLOT_LABEL = { available: 'Available', booked: 'Booked', sold: 'Sold' };
    let current = null; const plotHidden = new Set();
    function paintPlan(p) {
      const pat = 'AABASAAAABSAASAABAASABAAAASBAASAABAS';
      plots.forEach((pl, k) => { pl.st = pmap[pat[(k + p.id * 5) % pat.length]]; });
      plan.querySelectorAll('.plot').forEach(r => { const pl = plots[+r.dataset.n - 1]; r.setAttribute('class', `plot ${pl.st}${plotHidden.has(pl.st) ? ' off' : ''}`); r.setAttribute('aria-label', `Plot ${pl.n}, ${pl.st}`); });
      document.querySelectorAll('#lvPlotLegend button').forEach(b => { b.querySelector('b').textContent = plots.filter(pl => pl.st === b.dataset.st).length; });
      byId('planName').textContent = `Sample Project ${p.id}`;
      byId('planCount').textContent = `· ${plots.length} plots`;
    }
    function selectPlot(pl) {
      plan.querySelectorAll('.plot').forEach(r => r.classList.toggle('sel', +r.dataset.n === pl.n));
      const area = 1200 + (pl.n * 137 + current.id * 31) % 1300, facing = ['East', 'North', 'West', 'North-East', 'South'][(pl.n + current.id) % 5];
      card.innerHTML = `
        <div class="lv-card-head"><div><b>Plot ${pl.n}</b><small>Sample Project ${current.id} · ${current.area}</small></div><button class="lv-close" aria-label="Close plot details"><i class="fas fa-xmark"></i></button></div>
        <span class="lv-status ${pl.st}"><i class="fas fa-circle" style="font-size:7px"></i>${PLOT_LABEL[pl.st]}</span>
        <div class="lv-grid"><div>Plot area<strong>${area.toLocaleString('en-IN')} sq ft</strong></div><div>Facing<strong>${facing}</strong></div><div>Road width<strong>${pl.road}</strong></div><div>Corner plot<strong>${pl.n % 6 === 1 || pl.n % 6 === 0 ? 'Yes' : 'No'}</strong></div></div>
        <p class="sample">Sample plot for illustration.</p>`;
      card.classList.add('show');
      card.querySelector('.lv-close').addEventListener('click', clearPlot);
    }
    function clearPlot() { card.classList.remove('show'); plan.querySelectorAll('.plot.sel').forEach(r => r.classList.remove('sel')); }
    function setView(v) {
      lv.dataset.view = v;
      document.querySelectorAll('.lv-tab').forEach(x => { const on = x.dataset.view === v; x.classList.toggle('active', on); x.setAttribute('aria-selected', on); });
    }
    function showPlan(p) {
      current = p || pins.find(q => q.plotted);
      clear(); paintPlan(current); setView('plots');
    }
    const pickPlot = el => { const r = el.closest && el.closest('.plot'); if (r) selectPlot(plots[+r.dataset.n - 1]); return !!r; };
    plan.addEventListener('click', e => { if (!pickPlot(e.target)) clearPlot(); });
    plan.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && pickPlot(e.target)) e.preventDefault(); });
    document.querySelectorAll('#lvPlotLegend button').forEach(b => {
      b.setAttribute('aria-pressed', 'true');
      b.addEventListener('click', () => {
        const st = b.dataset.st; plotHidden.has(st) ? plotHidden.delete(st) : plotHidden.add(st);
        b.classList.toggle('off', plotHidden.has(st)); b.setAttribute('aria-pressed', !plotHidden.has(st));
        plan.querySelectorAll('.plot').forEach(r => r.classList.toggle('off', plotHidden.has(plots[+r.dataset.n - 1].st)));
        const sel = plan.querySelector('.plot.sel'); if (sel && sel.classList.contains('off')) clearPlot();
      });
    });
    byId('lvBack').addEventListener('click', () => { clearPlot(); setView('pins'); if (current) select(current); });

    document.querySelectorAll('.lv-tab').forEach(t => t.addEventListener('click', () => {
      const v = t.dataset.view;
      if (v === 'plots') { showPlan(current); return; }
      if (lv.dataset.view === 'plots') clearPlot();
      if (lv.dataset.view === 'infra') clearInfra();
      setView(v);
      if (v === 'infra') { clear(); return; }
      if (v === 'info') select(pins.find(p => p.st === 'construction' && p.id > 14) || pins[0]);
      else if (v === 'nearby') clear();
    }));
  })();

  /* ---------- Accounts (MongoDB + JWT via /api/auth/*; localStorage caches the profile) ---------- */
  const ROLE_LABEL = { buyer: 'Buyer / Investor', developer: 'Developer / Builder', agent: 'Channel Partner', admin: 'Super admin', employee: 'Team' };
  const ROLES = {
    buyer: { side: ['Find, check and compare every project', 'See live status, MahaRERA-verified RERA numbers and possession dates for projects across Pune.'],
      items: ['Full project details on the live map', 'Status, MahaRERA-verified RERA numbers and possession dates', 'What’s nearby: schools, hospitals, metro', 'Street View and directions to every site', 'Always complimentary for buyers'], cta: 'Create buyer account' },
    developer: { side: ['Put your projects on the map', 'Reach buyers and channel partners already comparing projects in your area.'],
      items: ['Your project live as a pin on the map', 'Plot-level availability and layouts', 'Share links and QR codes for hoardings', 'Buyer enquiries straight to your team', 'Verified badge once your RERA no. is checked on MahaRERA'], cta: 'Create developer account' },
    agent: { side: ['Close faster with verified data', 'Show clients exactly where a project is and what its RERA record says.'],
      items: ['Full details for every live project', 'Share project maps with clients on WhatsApp', 'Plan multi-project site visits', 'Stay current on new launches', 'Verified partner badge once your agent no. is checked on MahaRERA'], cta: 'Create partner account' }
  };
  const SESSION_KEY = 'mappingg_demo_user';
  const getUser = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; } };
  const setUser = u => { try { u ? localStorage.setItem(SESSION_KEY, JSON.stringify(u)) : localStorage.removeItem(SESSION_KEY); } catch (e) {} applySession(); };
  const initials = n => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  function applySession() {
    const u = getUser();
    if (byId('userChip')) byId('userChip').hidden = !u;
    document.querySelectorAll('.guest-only').forEach(el => { el.hidden = !!u; });
    renderMapAccess();
    // The chip only exists in older markup (the shared <SiteHeader/> replaced it), so set what's there.
    const set = (id, text) => { const el = byId(id); if (el) el.textContent = text; };
    if (u) { set('userAvatar', initials(u.name)); set('userName', u.name); set('userRole', (ROLE_LABEL[u.role] || '') + (u.verified ? '' : ' · pending')); }
  }

  const modal = byId('authModal'), tabs = document.querySelectorAll('.tab');
  const signinForm = byId('signinForm'), signupForm = byId('signupForm'), successView = byId('successView');
  let mode = 'signup';
  const currentRole = () => (document.querySelector('#roleTiles input:checked') || {}).value || 'buyer';
  function renderSide() {
    const role = currentRole(), r = ROLES[role], isIn = mode === 'signin';
    byId('sideTitle').textContent = isIn ? 'Welcome back to Mappingg' : r.side[0];
    byId('sideSub').textContent = isIn ? 'Sign in with the account type you registered with.' : r.side[1];
    byId('benefitsTitle').textContent = `${isIn ? 'Your' : 'What you get as a'} ${ROLE_LABEL[role]}${isIn ? ' access' : ''}`;
    byId('benefitsList').innerHTML = r.items.map((t, i) => `<li style="animation-delay:${i * 40}ms"><i class="fas fa-check"></i>${t}</li>`).join('');
    signupForm.querySelectorAll('.role-fields').forEach(fs => { const on = fs.dataset.for === role; fs.hidden = !on; fs.disabled = !on; });
    byId('signupBtn').textContent = r.cta;
    byId('signinBtn').textContent = `Sign in as ${ROLE_LABEL[role]}`;
    byId('verifyNote').hidden = role === 'buyer';
  }
  function openModal(which, role, reason) {
    mode = which;
    const pickRole = role || (which === 'signup' ? 'buyer' : null);
    if (pickRole) { const r = document.querySelector(`#roleTiles input[value="${pickRole}"]`); if (r) r.checked = true; }
    const isIn = which === 'signin';
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === which));
    signinForm.classList.toggle('is-active', isIn); signupForm.classList.toggle('is-active', !isIn);
    successView.classList.remove('is-active'); byId('roleBlock').hidden = false; byId('authTabs').hidden = false;
    byId('modalTitle').textContent = isIn ? 'Sign in' : (currentRole() === 'buyer' ? 'Explore every project' : 'Create your account');
    byId('modalSub').textContent = reason || (isIn ? 'Choose your account type, then sign in.' : 'Takes less than a minute.');
    renderSide();
    modal.classList.add('is-open'); document.body.style.overflow = 'hidden';
  }
  function closeModal() { modal.classList.remove('is-open'); document.body.style.overflow = ''; }
  document.querySelectorAll('#roleTiles input').forEach(r => r.addEventListener('change', renderSide));
  tabs.forEach(t => t.addEventListener('click', () => openModal(t.dataset.tab)));
  document.querySelectorAll('.pass-toggle').forEach(b => b.addEventListener('click', () => {
    const inp = b.previousElementSibling, show = inp.type === 'password';
    inp.type = show ? 'text' : 'password'; b.innerHTML = show ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
  }));
  function success(u, isNew) {
    setUser(u);
    signinForm.classList.remove('is-active'); signupForm.classList.remove('is-active'); successView.classList.add('is-active');
    byId('roleBlock').hidden = true; byId('authTabs').hidden = true;
    byId('modalTitle').textContent = isNew ? 'Account created' : 'Signed in';
    byId('modalSub').textContent = ROLE_LABEL[u.role];
    byId('successTitle').textContent = `${isNew ? 'Welcome' : 'Welcome back'}, ${u.name.split(' ')[0]}!`;
    byId('successSub').textContent = u.verified ? 'The live map is unlocked — tap any pin to explore.' : 'The live map is unlocked. We’ll verify your RERA number on MahaRERA shortly for full developer or partner access.';
  }
  if (signinForm) signinForm.addEventListener('submit', e => {
    e.preventDefault(); if (!signinForm.reportValidity()) return;
    const email = byId('si-email').value.trim().toLowerCase();
    const password = byId('si-pass').value;
    const btn = byId('signinBtn'); const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
    // Real authentication against the server (MongoDB + JWT). A valid account —
    // e.g. the super-admin — is sent to the admin dashboard.
    fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ email: email, password: password }),
    }).then(r => r.json().then(b => ({ ok: r.ok, b }))).then(({ ok, b }) => {
      if (btn) { btn.disabled = false; btn.textContent = label; }
      if (ok && b.user) {
        setUser({ name: b.user.name || b.user.email, email: b.user.email, role: b.user.role, verified: b.user.verified });
        toast(b.redirect === '/map' ? 'Signed in — opening the live map…' : 'Signed in — opening your dashboard…', 'fa-circle-check');
        // Staff → /s-admin, buyers → /map, developers and partners → /dashboard.
        window.location.href = b.redirect || '/dashboard';
      } else {
        toast((b.error && b.error.message) || 'Invalid login credentials', 'fa-triangle-exclamation');
      }
    }).catch(() => {
      if (btn) { btn.disabled = false; btn.textContent = label; }
      toast('Network error — please try again', 'fa-triangle-exclamation');
    });
  });
  if (signupForm) signupForm.addEventListener('submit', e => {
    e.preventDefault(); if (!signupForm.reportValidity()) return;
    const role = currentRole(), fd = Object.fromEntries(new FormData(signupForm));
    // Only the active role's fieldset is enabled, so fd holds just that role's extras.
    const { name, email, mobile, ...profile } = fd;
    const btn = byId('signupBtn'); const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Creating account…'; }
    fetch('/api/auth/signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ role, name: (name || '').trim(), email: (email || '').trim().toLowerCase(), mobile: (mobile || '').trim(), password: byId('su-pass').value, profile }),
    }).then(r => r.json().then(b => ({ ok: r.ok, b }))).then(({ ok, b }) => {
      if (btn) { btn.disabled = false; btn.textContent = label; }
      if (ok && b.user) {
        success({ name: b.user.name, email: b.user.email, role: b.user.role, verified: b.user.verified }, true);
        setTimeout(() => { window.location.href = b.redirect || '/dashboard'; }, 900);
      } else {
        toast((b.error && b.error.message) || 'Could not create your account', 'fa-triangle-exclamation');
      }
    }).catch(() => {
      if (btn) { btn.disabled = false; btn.textContent = label; }
      toast('Network error — please try again', 'fa-triangle-exclamation');
    });
  });
  document.querySelectorAll('.btn-google').forEach(b => b.addEventListener('click', () => toast('Google sign-in is coming soon', 'fa-circle-info')));
  document.querySelectorAll('.open-signin').forEach(b => b.addEventListener('click', e => { e.preventDefault(); openModal('signin'); }));
  document.querySelectorAll('.open-signup').forEach(b => b.addEventListener('click', e => {
    e.preventDefault();
    const u = getUser();
    if (u) { if (u.role === 'developer' || b.dataset.role !== 'developer') openLiveMap(); else toast('Listing projects needs a Developer / Builder account', 'fa-circle-info'); return; }
    openModal('signup', b.dataset.role);
  }));
  if (byId('successClose')) byId('successClose').addEventListener('click', closeModal);
  if (byId('successOpen')) byId('successOpen').addEventListener('click', () => { closeModal(); openLiveMap(); });
  if (byId('modalClose')) byId('modalClose').addEventListener('click', closeModal);
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal && modal.classList.contains('is-open')) closeModal(); });
  if (byId('userBtn')) byId('userBtn').addEventListener('click', e => { e.stopPropagation(); byId('userMenu').classList.toggle('open'); });
  document.addEventListener('click', e => { if (byId('userChip') && !byId('userChip').contains(e.target)) byId('userMenu').classList.remove('open'); });
  if (byId('signOutBtn')) byId('signOutBtn').addEventListener('click', () => {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    setUser(null); byId('userMenu').classList.remove('open'); toast('You’re signed out', 'fa-right-from-bracket');
  });
  applySession();
  // The server session is the source of truth; the localStorage copy only keeps
  // the map unlocked without a flash on load. Drop it if the session has expired.
  fetch('/api/auth/session', { credentials: 'same-origin' }).then(r => r.json()).then(b => {
    const s = b && b.session && b.session.user;
    setUser(s ? { name: s.name || s.email, email: s.email, role: s.role, verified: s.verified } : null);
  }).catch(() => {});

  // The shared <SiteHeader/> lives outside this markup; it asks us to open the
  // auth modal via a window event instead of a class handler.
  on(window, 'mpg:open-signin', function () { openModal('signin'); });
  on(window, 'mpg:open-signup', function (e) { openModal('signup', e && e.detail && e.detail.role); });

  // Deep-links: /?admin=1 (redirected from the gated admin) or /?signin=1 (Sign in
  // from another page's header) open the sign-in modal on load.
  try {
    var q = new URLSearchParams(location.search);
    if (q.get('admin') === '1') openModal('signin', null, 'Sign in to open the admin dashboard.');
    else if (q.get('signin') === '1') openModal('signin');
  } catch (e) {}

  /* ---------- Globe ---------- */
  // Builds the on-globe UI: zoom in/out buttons and a readable legend showing
  // which country has how many live projects (and the top areas within it).
  function buildGlobeOverlay(box, data) {
    if (!box) return;
    if (!document.getElementById('mpg-globe-css')) {
      const st = document.createElement('style');
      st.id = 'mpg-globe-css';
      st.textContent =
        '.globe-zoom{position:absolute;right:12px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:6px;z-index:3}' +
        '.globe-zoom button{width:34px;height:34px;border:0;border-radius:10px;font-size:20px;font-weight:700;line-height:1;cursor:pointer;' +
        'background:rgba(255,255,255,.85);color:#0f5c47;box-shadow:0 2px 8px rgba(0,0,0,.18);backdrop-filter:blur(6px)}' +
        '.globe-zoom button:hover{background:#fff}' +
        '.globe-legend{display:flex;flex-direction:column;gap:4px;text-align:left}' +
        '.globe-legend .gl-row{display:flex;align-items:center;gap:7px;font-size:13px}' +
        '.globe-legend .gl-row b{font-weight:700}' +
        '.globe-legend .gl-n{margin-left:auto;font-weight:700;font-variant-numeric:tabular-nums}' +
        '.globe-legend .gl-where{font-size:11px;opacity:.75;margin-top:1px}';
      document.head.appendChild(st);
    }

    // Zoom buttons (wired to the 3D camera below, if three.js is present).
    box.querySelectorAll('.globe-zoom').forEach(n => n.remove());
    const zc = document.createElement('div');
    zc.className = 'globe-zoom';
    zc.innerHTML = '<button type="button" data-z="in" aria-label="Zoom in">+</button>' +
      '<button type="button" data-z="out" aria-label="Zoom out">−</button>';
    box.appendChild(zc);

    // Counts legend — replaces the static "India · Dubai soon" pill.
    const bottom = box.querySelector('.globe-bottom');
    if (bottom && data && Array.isArray(data.countries) && data.countries.length) {
      const rows = data.countries.slice(0, 3).map(c => {
        const where = (c.areas || []).slice(0, 4).map(a => a.name).join(' · ');
        return '<div class="gl-row"><span>' + c.flag + '</span><b>' + c.name + '</b>' +
          '<span class="gl-n">' + c.count + '</span></div>' +
          (where ? '<div class="gl-where">' + where + '</div>' : '');
      }).join('');
      bottom.innerHTML = '<span class="glass"><span class="globe-legend">' +
        '<div class="gl-row" style="opacity:.8"><b>' + data.total + ' live projects</b></div>' +
        rows + '</span></span>';
    }
  }

  (function () {
    const canvas = document.getElementById('globe-canvas');
    if (!canvas) return;
    const box = canvas.parentElement;

    // Real project counts injected by the server (app/page.tsx → #mpg-globe-data).
    // Shown as a readable legend + used to place markers. Falls back to a
    // decorative set of cities when there is no data.
    let GLOBE = null;
    try {
      const el = document.getElementById('mpg-globe-data');
      if (el) GLOBE = JSON.parse(el.textContent || 'null');
    } catch (e) { /* ignore malformed data */ }
    buildGlobeOverlay(box, GLOBE);

    if (!window.THREE) return; // counts still show above; only the 3D globe needs three.js
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, box.clientWidth / box.clientHeight, 0.1, 1000);
    const ZMIN = 1.5, ZMAX = 6;
    let zTarget = 3.2;
    camera.position.set(0, 0, zTarget);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    const size = () => {
      camera.aspect = box.clientWidth / box.clientHeight; camera.updateProjectionMatrix();
      renderer.setSize(box.clientWidth, box.clientHeight, false);
    };
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); size();

    const L = new THREE.TextureLoader();
    const base = 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/';
    const group = new THREE.Group(); scene.add(group);
    group.add(new THREE.Mesh(new THREE.SphereGeometry(1, 128, 128), new THREE.MeshPhongMaterial({
      map: L.load(base + 'earth_atmos_2048.jpg'), specularMap: L.load(base + 'earth_specular_2048.jpg'),
      normalMap: L.load(base + 'earth_normal_2048.jpg'), specular: new THREE.Color(0x3a6a5a), shininess: 22
    })));
    const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.008, 96, 96),
      new THREE.MeshPhongMaterial({ map: L.load(base + 'earth_clouds_1024.png'), transparent: true, opacity: .35, depthWrite: false }));
    group.add(clouds);
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.16, 96, 96), new THREE.ShaderMaterial({
      vertexShader: 'varying vec3 n; void main(){ n=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying vec3 n; void main(){ float i=pow(0.62-dot(n,vec3(0,0,1)),2.6); vec3 c=mix(vec3(.55,.75,.95),vec3(.80,.90,1.0),i); gl_FragColor=vec4(c,1.)*i*1.1; }',
      blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true, depthWrite: false
    })));
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xfff3dc, 1.9); sun.position.set(5, 3, 5); scene.add(sun);

    const v3 = (lat, lon, r) => {
      const p = (90 - lat) * Math.PI / 180, t = (lon + 180) * Math.PI / 180;
      return new THREE.Vector3(-(r * Math.sin(p) * Math.cos(t)), r * Math.cos(p), r * Math.sin(p) * Math.sin(t));
    };
    // Marker per country, sized bigger for the country with the most projects.
    // Falls back to a decorative spread of Indian metros + Dubai when no data.
    let places;
    if (GLOBE && Array.isArray(GLOBE.countries) && GLOBE.countries.length) {
      const max = Math.max.apply(null, GLOBE.countries.map(c => c.count));
      places = GLOBE.countries.map(c => ({ lat: c.lat, lon: c.lon, f: c.count >= max }));
    } else {
      places = [
        { lat: 18.5204, lon: 73.8567, f: true },
        { lat: 19.076, lon: 72.8777, f: true },
        { lat: 25.2048, lon: 55.2708, f: true },
        { lat: 28.6139, lon: 77.209 }, { lat: 12.9716, lon: 77.5946 },
        { lat: 13.0827, lon: 80.2707 }, { lat: 17.385, lon: 78.4867 }, { lat: 22.5726, lon: 88.3639 }
      ];
    }
    const rings = [];
    places.forEach(c => {
      const pos = v3(c.lat, c.lon, 1.008), col = c.f ? 0xd0613b : 0x0f5c47;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(c.f ? .022 : .013, 20, 20), new THREE.MeshBasicMaterial({ color: col }));
      dot.position.copy(pos); group.add(dot);
      const ring = new THREE.Mesh(new THREE.RingGeometry(c.f ? .038 : .024, c.f ? .055 : .035, 40),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .6, side: THREE.DoubleSide }));
      ring.position.copy(pos); ring.lookAt(0, 0, 0); group.add(ring); rings.push(ring);
    });
    // Arc between the two biggest locations (decorative "reach" line).
    if (places.length >= 2) {
      const a = v3(places[0].lat, places[0].lon, 1.01), b = v3(places[1].lat, places[1].lon, 1.01);
      const mid = a.clone().add(b).multiplyScalar(.5).normalize().multiplyScalar(1.28);
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(60)),
        new THREE.LineBasicMaterial({ color: 0x0f5c47, transparent: true, opacity: .9 })));
    }

    let ty = (70 + 180) * Math.PI / 180, tx = .3, cy = ty, cx = tx;
    let drag = false, prev = { x: 0, y: 0 }, vel = { x: 0, y: 0 }, auto = true, idle;
    const start = (x, y) => { drag = true; auto = false; clearTimeout(idle); prev = { x, y }; };
    const move = (x, y) => { if (!drag) return; vel.y = (x - prev.x) * .005; vel.x = (y - prev.y) * .005; prev = { x, y }; };
    const end = () => { if (!drag) return; drag = false; idle = setTimeout(() => auto = true, 2000); };
    canvas.addEventListener('mousedown', e => start(e.clientX, e.clientY));
    on(window, 'mousemove', e => move(e.clientX, e.clientY));
    on(window, 'mouseup', end);
    canvas.addEventListener('touchstart', e => start(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    on(window, 'touchmove', e => move(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    on(window, 'touchend', end);

    /* ---------- Zoom (wheel + on-screen buttons), like a real map ---------- */
    const clampZ = z => Math.max(ZMIN, Math.min(ZMAX, z));
    const zoomBy = d => { zTarget = clampZ(zTarget + d); auto = false; clearTimeout(idle); idle = setTimeout(() => auto = true, 2500); };
    canvas.addEventListener('wheel', e => { e.preventDefault(); zoomBy(e.deltaY > 0 ? 0.3 : -0.3); }, { passive: false });
    // Pinch-to-zoom on touch devices.
    let pinch = 0;
    canvas.addEventListener('touchmove', e => {
      if (e.touches.length !== 2) return;
      const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (pinch) zoomBy((pinch - dist) * 0.01);
      pinch = dist;
    }, { passive: true });
    canvas.addEventListener('touchend', () => { pinch = 0; }, { passive: true });
    const zc = box.querySelector('.globe-zoom');
    if (zc) {
      zc.querySelector('[data-z="in"]').addEventListener('click', () => zoomBy(-0.6));
      zc.querySelector('[data-z="out"]').addEventListener('click', () => zoomBy(0.6));
    }

    // The loop stops when this run is torn down (next navigation) or when the
    // canvas is detached from the DOM — otherwise old loops would pile up and
    // keep rendering to orphaned canvases, degrading performance.
    let __globeStop = false;
    __cleanups.push(() => { __globeStop = true; });
    (function loop() {
      if (__globeStop || !canvas.isConnected) return;
      requestAnimationFrame(loop);
      if (drag) { cy += vel.y; cx = Math.max(-1.2, Math.min(1.2, cx + vel.x)); vel.x *= .93; vel.y *= .93; ty = cy; tx = cx; }
      else if (auto) { cy += .0011; cx += (tx - cx) * .02; }
      else { cx += (tx - cx) * .05; cy += (ty - cy) * .05; }
      group.rotation.set(cx, cy, 0); clouds.rotation.y += .0004;
      const t = Date.now() * .001;
      rings.forEach((r, i) => { const s = 1 + Math.sin(t * 2 + i * .9) * .28; r.scale.set(s, s, s); r.material.opacity = .6 * (2 - s); });
      camera.position.z += (zTarget - camera.position.z) * 0.1; // smooth zoom toward target
      renderer.render(scene, camera);
    })();
    on(window, 'resize', size);
  })();
})();

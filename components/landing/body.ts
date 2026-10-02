// Server-rendered landing markup for the Mappingg home page. Kept as a raw HTML
// string (injected with dangerouslySetInnerHTML) so the exact hand-tuned design
// ships verbatim and is fully server-rendered for SEO. All behaviour lives in
// LandingClient.tsx. "Open live map" links point at the in-app /map route.
// NOTE: the top navigation is now the shared <SiteHeader/> React component
// (rendered by the home page), so the landing markup below starts at the hero.
export const LANDING_BODY = `
<header class="hero" id="home">
  <div class="hero-pins" aria-hidden="true">
    <span class="hpin s-available" style="left:4%;top:190px"><span class="pdot"></span>Available</span>
    <span class="hpin s-construction" style="left:9%;top:300px"><span class="pdot"></span>₹1.35 Cr</span>
    <span class="hpin s-upcoming up" style="left:3%;top:410px"><span class="pdot"></span>Upcoming</span>
    <span class="hpin s-sold" style="right:4%;top:175px"><span class="pdot"></span>Sold out</span>
    <span class="hpin s-available" style="right:9%;top:285px"><span class="pdot"></span>₹62 L</span>
    <span class="hpin s-construction" style="right:3%;top:395px"><span class="pdot"></span>Under construction</span>
  </div>
  <div class="container">
    <div class="hero-center">
      <span class="eyebrow"><span class="dot"></span>Live real estate map · Pune</span>
      <h1>Every property project, <span class="accent">mapped</span> and verified.</h1>
      <p class="hero-desc">Mappingg puts projects, RERA, possession, infrastructure and nearby details on one map — so you can shortlist properties in minutes.</p>
      <form class="ask" id="heroAskForm" role="search">
        <span class="ask-badge"><span class="m">M</span>Agent M</span>
        <label for="heroAskInput" class="sr-only">Search projects</label>
        <input id="heroAskInput" type="text" placeholder="Search by area, project or budget…" autocomplete="off">
        <button type="submit" class="btn btn-primary">Explore the map <i class="fas fa-arrow-right"></i></button>
      </form>
      <div class="hero-actions">
        <a href="#" class="btn btn-earth open-signup" data-role="buyer"><i class="fas fa-house-chimney"></i> Start exploring now</a>
        <a href="#live-map" class="btn btn-outline"><i class="fas fa-map-location-dot"></i> See the live map</a>
      </div>
      <p class="dev-note">Developer or channel partner? <a href="#" class="open-signup" data-role="developer">List your project</a> · <a href="#" class="open-signup" data-role="agent">Join as partner</a></p>
      <div class="hero-trust">
        <span><i class="fas fa-shield-halved"></i>RERA numbers verified on MahaRERA</span>
        <span><i class="fas fa-street-view"></i>Street View & navigation</span>
        <span><i class="fas fa-leaf"></i>Green-certified filter</span>
      </div>
    </div>
  </div>
</header>


<section class="live-sec" id="live-map">
  <div class="container">
<div class="sec-head reveal">
  <span class="eyebrow"><span class="dot"></span>Live project map</span>
  <h2>Explore the <span class="accent">live project map</span></h2>
  <p>Every pin is a real project. Tap around — your first 3 taps are on us, then sign in to keep exploring.</p>
</div>
<div class="browser reveal trial" id="liveBrowser" aria-label="Mappingg live map — try it">
  <div class="browser-bar">
    <div class="dots" aria-hidden="true"><span></span><span></span><span></span></div>
    <div class="url"><i class="fas fa-lock"></i><span>mappingg.com</span><em class="url-state" id="tapState">3 searches left</em></div>
    <span class="bar-space" aria-hidden="true"></span>
  </div>
  <div class="browser-body">
    <div class="map-fallback" aria-hidden="true"></div>
    
    <iframe id="liveFrame" title="Mappingg live map" data-src="/map" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="geolocation"></iframe>
    <div class="map-hint" id="mapHint"><i class="fas fa-hand-pointer"></i><span>Tap any pin to explore — <b id="tapLeft">3</b> searches left</span></div>
    <div class="map-lock" id="mapLock" hidden>
      <div class="lock-card" role="dialog" aria-labelledby="lockTitle">
        <div class="lock-ic"><i class="fas fa-lock"></i></div>
        <h3 id="lockTitle">Sign in to keep exploring</h3>
        <p>You've used your 3 complimentary searches. Create a buyer account to open every pin, price and possession date.</p>
        <ul class="lock-perks">
          <li><i class="fas fa-check"></i>Full details for every project</li>
          <li><i class="fas fa-check"></i>MahaRERA-verified RERA numbers</li>
          <li><i class="fas fa-check"></i>Nearby schools, metro & new roads</li>
        </ul>
        <button type="button" class="btn btn-primary btn-lg lock-buyer" data-role="buyer"><i class="fas fa-house-chimney"></i> Continue as a buyer</button>
        <button type="button" class="lock-signin" id="lockSignin">Already have an account? <b>Sign in</b></button>
        <p class="lock-others">Developer? <button type="button" data-role="developer">List your project</button> · Partner? <button type="button" data-role="agent">Join here</button></p>
      </div>
    </div>
  </div>
</div>
<div class="map-features reveal">
  <span class="s-available"><i class="dot"></i>Available</span>
  <span class="s-sold"><i class="dot"></i>Sold</span>
  <span class="s-construction"><i class="dot"></i>Under construction</span>
  <span class="s-upcoming"><i class="dot"></i>Upcoming</span>
  <span><i class="fas fa-road"></i>Infrastructure</span>
  <span><i class="fas fa-satellite"></i>Satellite view</span>
  <span><i class="fas fa-location-crosshairs"></i>Near me</span>
</div>
  </div>
</section>


<section class="showcase-sec">
  <div class="container">
    <div class="showcase">
      <div class="stack">
        <div class="card reveal d1">
          <div class="card-label">Project card <span class="pill park"><i class="fas fa-circle-check"></i> MahaRERA verified</span></div>
          <div class="rera-row"><div class="qr" aria-hidden="true"></div><div><div class="rera-title">Sample Residences</div><div class="rera-no">P5210000XXXX · Mundhwa</div></div></div>
          <div class="timeline"><div><span>Original possession</span><strong>Dec 2026</strong></div><div><span>Revised possession</span><strong class="late">Jun 2027</strong></div></div>
        </div>
        <div class="card reveal d2">
          <div class="card-label">Avg. price · Pune East <span class="pill road">Sample</span></div>
          <div class="big-num">₹9,850<small>/sq ft</small></div>
          <div class="bars"><span style="height:38%"></span><span style="height:50%"></span><span style="height:44%"></span><span style="height:62%"></span><span style="height:58%"></span><span style="height:78%"></span><span style="height:100%"></span></div>
        </div>
      </div>
      <div class="globe-panel reveal">
        <canvas id="globe-canvas" aria-label="Interactive globe"></canvas>
        <div class="globe-top"><span class="glass"><span class="live-dot"></span>Live project map</span><span class="glass"><i class="fas fa-hand-pointer"></i>Drag</span></div>
        <div class="globe-bottom"><span class="glass">🇮🇳 India · 🇦🇪 Dubai soon</span></div>
      </div>
      <div class="stack">
        <div class="card agent-card reveal d2">
          <div class="card-label">Agent M <span class="pill road">Coming soon</span></div>
          <div class="bubble user">Show ready projects near Magarpatta</div>
          <div class="bubble bot">Found <b>ready-to-move</b> projects within 3 km. Opening the map…</div>
          <div class="waveform" aria-hidden="true"><span style="animation-delay:-.1s"></span><span style="animation-delay:-.5s"></span><span style="animation-delay:-.3s"></span><span style="animation-delay:-.8s"></span><span style="animation-delay:-.2s"></span><span style="animation-delay:-.6s"></span><span style="animation-delay:-.4s"></span><span style="animation-delay:-.9s"></span><span style="animation-delay:-.15s"></span><span style="animation-delay:-.7s"></span></div>
        </div>
        <div class="card reveal d3">
          <div class="card-label">Project status</div>
          <div class="leaf-row"><div class="leaf"><i class="fas fa-layer-group"></i></div><div><div class="big-num" style="font-size:22px">4 status layers</div><div style="font-size:13px;color:var(--muted)">Available · Sold · Under construction · Upcoming</div></div></div>
        </div>
      </div>
    </div>
  </div>
</section>

<div class="strip" aria-hidden="true">
  <div class="strip-track">
    <div class="strip-item"><i class="fas fa-location-dot"></i>Live project pins</div>
    <div class="strip-item"><i class="fas fa-shield-halved"></i>MahaRERA verified</div>
    <div class="strip-item"><i class="fas fa-road"></i>Infrastructure updates</div>
    <div class="strip-item"><i class="fas fa-satellite"></i>Satellite view</div>
    <div class="strip-item"><i class="fas fa-location-crosshairs"></i>Near me</div>
    <div class="strip-item"><i class="fas fa-street-view"></i>Street View</div>
    <div class="strip-item"><i class="fab fa-whatsapp"></i>WhatsApp enquiries</div>
    <div class="strip-item"><i class="fas fa-location-dot"></i>Live project pins</div>
    <div class="strip-item"><i class="fas fa-shield-halved"></i>MahaRERA verified</div>
    <div class="strip-item"><i class="fas fa-road"></i>Infrastructure updates</div>
    <div class="strip-item"><i class="fas fa-satellite"></i>Satellite view</div>
    <div class="strip-item"><i class="fas fa-location-crosshairs"></i>Near me</div>
    <div class="strip-item"><i class="fas fa-street-view"></i>Street View</div>
    <div class="strip-item"><i class="fab fa-whatsapp"></i>WhatsApp enquiries</div>
  </div>
</div>








<section class="bg-land" id="features">
  <div class="container">
    <div class="sec-head reveal">
      <span class="eyebrow road"><span class="dot"></span>Try it</span>
      <h2>See every project, <span class="accent">differently</span></h2>
      <p>Every pin is a project — plotted projects open into a plot-by-plot layout, and the infrastructure view shows what's being built around them.</p>
    </div>
    <div class="lv reveal" id="lv" data-view="pins">
      <div class="lv-side" role="tablist" aria-label="Map views">
        <p class="lv-side-title">Choose a view</p>
        <button class="lv-tab active" role="tab" aria-selected="true" data-view="pins"><span class="ic"><i class="fas fa-location-dot"></i></span><span><b>Project pins</b><small>Every project by status</small></span></button>
       
        <button class="lv-tab" role="tab" aria-selected="false" data-view="map"><span class="ic"><i class="fas fa-map"></i></span><span><b>Map view</b><small>Clean, simple base map</small></span></button>
        <button class="lv-tab" role="tab" aria-selected="false" data-view="satellite"><span class="ic"><i class="fas fa-satellite"></i></span><span><b>Satellite view</b><small>Real ground context</small></span></button>
        <button class="lv-tab" role="tab" aria-selected="false" data-view="labels"><span class="ic"><i class="fas fa-tags"></i></span><span><b>Area labels</b><small>Localities & main roads</small></span></button>
        <button class="lv-tab" role="tab" aria-selected="false" data-view="nearby"><span class="ic"><i class="fas fa-school"></i></span><span><b>Nearby places</b><small>Schools, hospitals, metro</small></span></button>
        <button class="lv-tab" role="tab" aria-selected="false" data-view="infra"><span class="ic"><i class="fas fa-road"></i></span><span><b>Infrastructure</b><small>Metro, roads & bridges</small></span></button>
        <button class="lv-tab" role="tab" aria-selected="false" data-view="info"><span class="ic"><i class="fas fa-circle-info"></i></span><span><b>Project info</b><small>Status, RERA & possession</small></span></button>
         <button class="lv-tab" role="tab" aria-selected="false" data-view="plots"><span class="ic"><i class="fas fa-border-all"></i></span><span><b>Plot layouts</b><small>Plot-by-plot availability</small></span></button>
        <p class="lv-note"><i class="fas fa-circle-info"></i><span>Sample projects, for illustration.</span></p>
      </div>
      <div class="lv-main">
        <div class="lv-stage" id="lvStage">
          <svg id="lvSvg" class="area" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Illustrative area map with project pins"></svg>
          <svg id="lvPlan" class="plan" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Sample plotted project layout"></svg>
          <div class="lv-over lv-proj area-only"><span class="dot"></span>Pune East <small id="lvCounts"></small></div>
          <div class="lv-over lv-proj plan-only"><button type="button" class="lv-back" id="lvBack" aria-label="Back to area map"><i class="fas fa-arrow-left"></i></button><span id="planName">Sample Project</span> <small id="planCount"></small></div>
          <div class="lv-over lv-compass" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2l3.5 10H8.5z" fill="#a9532d"/><path d="M12 22l-3.5-10h7z" fill="#cfccc2"/></svg></div>
          <button type="button" class="lv-ibtn infra-only" data-i="0" style="left:56%;top:23%"><i class="fas fa-train-subway" style="background:#c9861f"></i>Metro extension</button>
          <button type="button" class="lv-ibtn infra-only" data-i="1" style="left:90%;top:52%"><i class="fas fa-road" style="background:#3f7fb3"></i>Ring road</button>
          <button type="button" class="lv-ibtn infra-only" data-i="2" style="left:45%;top:86%"><i class="fas fa-bridge" style="background:#c9861f"></i>Flyover</button>
          <button type="button" class="lv-ibtn infra-only" data-i="3" style="left:67%;top:37%"><i class="fas fa-bridge-water" style="background:#2f7a3c"></i>River bridge</button>
          <button type="button" class="lv-ibtn infra-only" data-i="4" style="left:25%;top:66%"><i class="fas fa-road-circle-check" style="background:#3f7fb3"></i>Road widening</button>
          <div class="lv-over lv-scale area-only" aria-hidden="true">0 — 1 km<span></span></div>
          <div class="lv-over lv-scale plan-only" aria-hidden="true">0 — 20 m<span></span></div>
          <div class="lv-chip" style="left:41%;top:19%"><i style="background:#2d6fa3" class="fas fa-train-subway"></i>Metro station</div>
          <div class="lv-chip" style="left:87%;top:30%"><i style="background:#0f5c47" class="fas fa-building"></i>IT park</div>
          <div class="lv-chip" style="left:21%;top:62%"><i style="background:#a9532d" class="fas fa-hospital"></i>Hospital</div>
          <div class="lv-chip" style="left:62%;top:57%"><i style="background:#2f7a3c" class="fas fa-school"></i>School</div>
          <div class="lv-chip" style="left:50%;top:84%"><i style="background:#c9861f" class="fas fa-bag-shopping"></i>Mall</div>
        </div>
        <div class="lv-legends">
          <div class="lv-over lv-legend area-only" id="lvLegend">
            <button type="button" data-st="available"><i style="background:#2f7a3c"></i>Available <b></b></button>
            <button type="button" data-st="construction"><i style="background:#c9861f"></i>Under construction <b></b></button>
            <button type="button" data-st="sold"><i style="background:#a9532d"></i>Sold <b></b></button>
            <button type="button" data-st="upcoming"><i style="background:#fff;border:2px dashed #7d837f"></i>Upcoming <b></b></button>
            <span class="ptype"><i></i>Plotted project</span>
          </div>
          <div class="lv-over lv-legend infra-only">
            <span class="il"><i style="background:#2f7a3c"></i>Completed</span>
            <span class="il"><i style="background:#c9861f"></i>Ongoing</span>
            <span class="il"><i style="background:#fff;border:2px dashed #3f7fb3"></i>Planned</span>
          </div>
          <div class="lv-over lv-legend plan-only" id="lvPlotLegend">
            <button type="button" data-st="available"><i style="background:#cfe7c4;border:2px solid #2f7a3c;border-radius:3px"></i>Available <b></b></button>
            <button type="button" data-st="booked"><i style="background:#f8e2b0;border:2px solid #c9861f;border-radius:3px"></i>Booked <b></b></button>
            <button type="button" data-st="sold"><i style="background:#f0c7b5;border:2px solid #a9532d;border-radius:3px"></i>Sold <b></b></button>
          </div>
        </div>
        <div class="lv-card" id="lvCard" aria-live="polite"></div>
      </div>
    </div>
  </div>
</section>


<section>
  <div class="container">
    <div class="frow reveal">
      <div class="fcopy">
        <span class="eyebrow"><span class="dot"></span>Clarity</span>
        <h2>Make every property <span class="accent">easy to understand</span></h2>
        <p>Every project card answers the questions buyers ask first — no calls, no digging.</p>
        <ul class="flist">
          <li><i class="fas fa-signal"></i><div><b>Project status</b><span>Available, sold, under construction or upcoming.</span></div></li>
          <li><i class="fas fa-shield-halved"></i><div><b>MahaRERA-verified RERA number</b><span>Checked on the official MahaRERA website, with a link to verify it yourself.</span></div></li>
          <li><i class="fas fa-calendar-check"></i><div><b>Possession dates</b><span>Original and revised dates, side by side.</span></div></li>
        </ul>
      </div>
      <div class="fvisual">
        <div class="blob tr"></div>
        <div class="mock">
          <div class="pc-media" style="background-image:url('https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=900&auto=format&fit=crop&q=75')"><div class="pc-badges"><span class="badge st s-construction">Under construction</span><span class="badge">Sample</span></div></div>
          <div class="pc-body">
            <h4>Sample Residences</h4><p>Mundhwa, Pune · 2 & 3 BHK</p>
            <div class="kv"><div><span>Starting from</span><strong>₹1.05 Cr</strong></div><div><span>Configuration</span><strong>2, 3 BHK</strong></div></div>
            <div class="pc-rera"><span class="qr"></span><div><span>MahaRERA no. <em class="rera-ok"><i class="fas fa-circle-check"></i> Verified</em></span><strong>P5210000XXXX</strong><a class="rera-link" href="https://maharera.maharashtra.gov.in/" target="_blank" rel="noopener">Verify on MahaRERA <i class="fas fa-arrow-up-right-from-square"></i></a></div></div>
            <div class="pc-actions"><span class="btn btn-primary btn-sm"><i class="fas fa-diamond-turn-right"></i>Navigate</span><span class="btn btn-outline btn-sm"><i class="fas fa-street-view"></i>Street View</span></div>
          </div>
        </div>
      </div>
    </div>

    <div class="frow flip reveal">
      <div class="fcopy">
        <span class="eyebrow water"><span class="dot"></span>Context</span>
        <h2>Put the information that matters <span class="accent">directly on the map</span></h2>
        <p>Location sells. Show buyers what's around a project and how far it really is.</p>
        <ul class="flist">
          <li><i class="fas fa-school"></i><div><b>Schools, hospitals & metro</b><span>Nearby places marked around each project.</span></div></li>
          <li><i class="fas fa-route"></i><div><b>Real distances</b><span>Drive times to IT parks, airport and stations.</span></div></li>
          <li><i class="fas fa-road"></i><div><b>Upcoming infrastructure</b><span>Metro lines, ring roads, flyovers and bridges — built, ongoing or planned.</span></div></li>
          <li><i class="fas fa-location-crosshairs"></i><div><b>Near me</b><span>Buyers see projects closest to where they stand.</span></div></li>
        </ul>
      </div>
      <div class="fvisual">
        <div class="blob bl"></div>
        <div class="mock nearby">
          <svg viewBox="0 0 560 330" role="img" aria-label="Map showing a project and nearby places">
            <rect width="560" height="330" fill="#f6f4ee"/>
            <g fill="#ece8de"><rect x="20" y="20" width="120" height="80" rx="8"/><rect x="170" y="30" width="90" height="70" rx="8"/><rect x="400" y="20" width="140" height="90" rx="8"/><rect x="30" y="220" width="130" height="90" rx="8"/><rect x="380" y="220" width="160" height="90" rx="8"/></g>
            <rect x="280" y="20" width="100" height="80" rx="14" fill="#d6ebce"/>
            <path d="M-10 190 C 120 150 240 230 360 180 S 520 150 580 170" stroke="#a9d0ef" stroke-width="26" fill="none" stroke-linecap="round"/>
            <g stroke-linecap="round" fill="none"><path d="M0 130H560M200 0V330M460 0V330" stroke="#e2ded3" stroke-width="12"/><path d="M0 130H560M200 0V330M460 0V330" stroke="#fff" stroke-width="8"/><path d="M0 300 C 200 280 360 320 560 290" stroke="#eab95e" stroke-width="12"/><path d="M0 300 C 200 280 360 320 560 290" stroke="#f6d58f" stroke-width="8"/></g>
            <g stroke="#2d6fa3" stroke-width="2" stroke-dasharray="5 5" fill="none"><path d="M280 160 L 110 60"/><path d="M280 160 L 470 60"/><path d="M280 160 L 450 260"/><path d="M280 160 L 95 255"/></g>
            <circle cx="280" cy="160" r="46" fill="rgba(15,92,71,.08)" stroke="rgba(15,92,71,.35)" stroke-dasharray="4 4"/>
            <g font-family="Inter, sans-serif" font-size="11" font-weight="700">
              <g transform="translate(110 60)"><circle r="14" fill="#fff" stroke="#2d6fa3" stroke-width="2"/><text y="4" text-anchor="middle" fill="#2d6fa3">🏫</text><text x="18" y="-8" fill="#1d2b26">School · 1.2 km</text></g>
              <g transform="translate(470 60)"><circle r="14" fill="#fff" stroke="#a9532d" stroke-width="2"/><text y="4" text-anchor="middle">🏥</text><text x="-18" y="-18" text-anchor="end" fill="#1d2b26">Hospital · 2.0 km</text></g>
              <g transform="translate(450 260)"><circle r="14" fill="#fff" stroke="#c9861f" stroke-width="2"/><text y="4" text-anchor="middle">🚇</text><text x="-18" y="30" text-anchor="end" fill="#1d2b26">Metro · 3.4 km</text></g>
              <g transform="translate(95 255)"><circle r="14" fill="#fff" stroke="#2f7a3c" stroke-width="2"/><text y="4" text-anchor="middle">🏢</text><text x="18" y="30" fill="#1d2b26">IT park · 4.1 km</text></g>
            </g>
            <g transform="translate(280 160)"><path d="M0 0 C -14 -18 -20 -26 -20 -36 A 20 20 0 1 1 20 -36 C 20 -26 14 -18 0 0Z" fill="#0f5c47"/><circle cy="-36" r="8" fill="#fff"/></g>
          </svg>
          <div class="near-list"><div><b>1.2 km</b><span>Nearest school</span></div><div><b>3.4 km</b><span>Metro station</span></div><div><b>12 min</b><span>Drive to IT park</span></div></div>
        </div>
      </div>
    </div>

  </div>
</section>


<section id="how">
  <div class="container">
    <div class="sec-head reveal">
      <span class="eyebrow"><span class="dot"></span>How it works</span>
      <h2>From project data to an <span class="accent">intelligent map</span></h2>
      <p>Three simple steps to put your project in front of the right people.</p>
    </div>
    <div class="steps">
      <div class="step-card reveal d1"><span class="step-num">01</span><div class="step-ic"><i class="fas fa-plug"></i></div><h3>Connect your data</h3><p>Share your RERA number, location, plans and prices. We verify the RERA number on the MahaRERA website.</p><div class="step-tags"><span>RERA</span><span>Location</span><span>Plans</span></div></div>
      <div class="step-card reveal d2"><span class="step-num">02</span><div class="step-ic"><i class="fas fa-map-location-dot"></i></div><h3>Map your project</h3><p>Your project goes live as a pin with status, photos, possession dates and nearby places.</p><div class="step-tags"><span>Pin</span><span>Status</span><span>Layers</span></div></div>
      <div class="step-card reveal d3"><span class="step-num">03</span><div class="step-ic"><i class="fas fa-share-nodes"></i></div><h3>Visualise & share</h3><p>Share one link on WhatsApp, ads and hoardings — and receive enquiries straight from the map.</p><div class="step-tags"><span>Link</span><span>QR code</span><span>Enquiries</span></div></div>
    </div>
  </div>
</section>


<section class="bg-land">
  <div class="container">
    <div class="sec-head reveal">
      <span class="eyebrow water"><span class="dot"></span>Always up to date</span>
      <h2>Keep project information <span class="accent">connected</span></h2>
      <p>Update once — every map, link and QR code shows the latest details.</p>
    </div>
    <div class="connected">
      <div class="conn reveal d1"><i class="fas fa-database"></i><h3>One source of truth</h3><p>Prices, status and dates live in one place instead of ten documents.</p></div>
      <div class="conn reveal d1"><i class="fas fa-arrows-rotate"></i><h3>Updates everywhere</h3><p>Change a price or mark a plot sold — it reflects instantly on every link.</p></div>
      <div class="conn reveal d2"><i class="fab fa-whatsapp"></i><h3>Enquiries on WhatsApp</h3><p>Leads from the map reach your team with the project they viewed.</p></div>
      <div class="conn reveal d3"><i class="fas fa-chart-simple"></i><h3>See what works</h3><p>Know which projects and areas buyers are looking at most.</p></div>
    </div>
  </div>
</section>





<section class="bg-land">
  <div class="container">
    <div class="sec-head reveal">
      <span class="eyebrow water"><span class="dot"></span>Your journey</span>
      <h2>The Mappingg <span class="accent">project journey</span></h2>
      <p>From sign-up to site visits — here's how a project goes live.</p>
    </div>
    <div class="journey reveal">
      <div class="jstep"><i class="fas fa-user-plus"></i><small>STEP 1</small><b>Sign up</b><span>Create a developer account.</span></div>
      <div class="jstep"><i class="fas fa-shield-halved"></i><small>STEP 2</small><b>We verify</b><span>We check the RERA no. on MahaRERA.</span></div>
      <div class="jstep"><i class="fas fa-location-dot"></i><small>STEP 3</small><b>Go live</b><span>Your pin appears on the map.</span></div>
      <div class="jstep"><i class="fas fa-share-nodes"></i><small>STEP 4</small><b>Share</b><span>Link, QR code and WhatsApp.</span></div>
      <div class="jstep"><i class="fas fa-comments"></i><small>STEP 5</small><b>Get enquiries</b><span>Serious buyers reach your team.</span></div>
    </div>
  </div>
</section>


<section id="faq">
  <div class="container faq-grid">
    <div class="sec-head reveal">
      <span class="eyebrow"><span class="dot"></span>FAQ</span>
      <h2>Questions, <span class="accent">answered</span></h2>
      <p>Can't find what you're looking for? Message us on WhatsApp.</p>
      <a href="/map" class="btn btn-primary live-link">Open the live map <i class="fas fa-arrow-right"></i></a>
    </div>
    <div class="faq-list reveal d1">
      <details class="faq-item" open><summary>What is Mappingg?<span class="faq-plus"><i class="fas fa-plus"></i></span></summary><p>Mappingg is a live map of real estate projects. Each project is a pin with its status, MahaRERA-verified RERA number, possession dates and what's nearby, so you can understand it in seconds.</p></details>
      <details class="faq-item"><summary>What is in it for buyers and investors?<span class="faq-plus"><i class="fas fa-plus"></i></span></summary><p>Buyers and investors can explore the map, view project details, compare locations, understand nearby infrastructure and discover upcoming developments — all in one place.</p></details>
      <details class="faq-item"><summary>What infrastructure do you show?<span class="faq-plus"><i class="fas fa-plus"></i></span></summary><p>Metro lines, ring roads, flyovers, bridges and road widening around each area — marked as completed, ongoing or planned — so you can see how a location is set to change.</p></details>
      <details class="faq-item"><summary>Which areas are covered?<span class="faq-plus"><i class="fas fa-plus"></i></span></summary><p>We're starting with projects in Pune and Mumbai, with more metro cities coming soon. Dubai projects are planned next.</p></details>
      <details class="faq-item"><summary>How do you verify projects?<span class="faq-plus"><i class="fas fa-plus"></i></span></summary><p>Every RERA number is checked on the official <a href="https://maharera.maharashtra.gov.in/" target="_blank" rel="noopener">MahaRERA website</a> before the project goes live. Each project card also links to MahaRERA, so you can verify it yourself in one tap.</p></details>
      <details class="faq-item"><summary>How can I list my project?<span class="faq-plus"><i class="fas fa-plus"></i></span></summary><p>Create a developer account and share your RERA number, location and project details. Once we verify your RERA number on the MahaRERA website, your project goes live on the map.</p></details>
      
    </div>
  </div>
</section>


<section>
  <div class="container">
    <div class="final-box reveal">
      <div class="inner">
        <span class="eyebrow"><span class="dot"></span>Get started</span>
        <h2>Find your next home <span class="accent">on the map.</span></h2>
        <p>Every project, its RERA record and what's around it — for buyers and investors.</p>
        <div class="final-btns">
          <a href="#" class="btn btn-primary btn-lg open-signup" data-role="buyer">Start exploring <i class="fas fa-arrow-right"></i></a>
          <a href="/map" class="btn btn-outline btn-lg live-link"><i class="fas fa-map-location-dot"></i> Explore the live map</a>
        </div>
        <p class="dev-note">Developer? <a href="#" class="open-signup" data-role="developer">List your project</a> · Channel partner? <a href="#" class="open-signup" data-role="agent">Join here</a></p>
      </div>
    </div>
  </div>
</section>


<footer class="footer">
  <div class="container">
    <div class="footer-top">
      <div class="footer-brand">
        <a href="#home" class="brand"><span class="brand-mark" aria-hidden="true"></span><span class="brand-name">Mappingg<em>.com</em></span></a>
        <p>Every property project, mapped and verified. A product by Associatte.</p>
        <div class="socials">
           <a href="#" aria-label="Facebook"><i class="fab fa-facebook-f"></i></a>
          <a href="#" aria-label="Instagram"><i class="fab fa-instagram"></i></a>
          <a href="#" aria-label="LinkedIn"><i class="fab fa-linkedin-in"></i></a>
          <a href="#" aria-label="YouTube"><i class="fab fa-youtube"></i></a>
          <a href="#" aria-label="WhatsApp"><i class="fab fa-whatsapp"></i></a>
        </div>
      </div>
      <div><h4>Explore</h4><ul><li><a href="/map" class="live-link">Live map</a></li><li><a href="/features">Features</a></li><li><a href="/how-it-works">How it works</a></li><li><a href="/faq">FAQ</a></li></ul></div>
      <div><h4>For business</h4><ul><li><a href="#" class="open-signup" data-role="developer">Developers</a></li><li><a href="#" class="open-signup" data-role="agent">Channel partners</a></li><li><a href="/advertise">Advertise</a></li><li><a href="/contact">Contact</a></li></ul></div>
      <div><h4>Company</h4><ul><li><a href="/about">About</a></li><li><a href="/blog">Blog</a></li><li><a href="/careers">Careers</a></li><li><a href="/privacy">Privacy policy</a></li></ul></div>
    </div>
    <div class="footer-bottom"><div>© 2026 Mappingg.com. All rights reserved.</div><div class="legal"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/disclaimer">Disclaimer</a><a href="/map-data">Map data</a></div></div>
    <p class="disclaimer">RERA numbers are verified on the <a href="https://maharera.maharashtra.gov.in/" target="_blank" rel="noopener">MahaRERA website</a>. Other project information comes from developers and is shown for reference only. Please confirm all details with the developer and MahaRERA before making a decision.</p>
  </div>
</footer>


<div class="mpg-modal-overlay" id="authModal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
  <div class="modal-card">
    <button class="modal-close" id="modalClose" aria-label="Close"><i class="fas fa-times"></i></button>
    <aside class="auth-side">
      <a class="brand" href="#home"><span class="brand-mark" aria-hidden="true"></span><span class="brand-name">Mappingg<em>.com</em></span></a>
      <h3 id="sideTitle">Find, check and compare every project</h3>
      <p id="sideSub">See live status, MahaRERA-verified RERA numbers and possession dates for projects across Pune.</p>
      <div class="side-map" aria-hidden="true">
        <span class="pinlabel s-available" style="left:28%;top:48%"><span class="pdot"></span>Available</span>
        <span class="pinlabel s-construction" style="left:66%;top:40%"><span class="pdot"></span>₹1.05 Cr</span>
        <span class="pinlabel s-sold" style="left:52%;top:86%"><span class="pdot"></span>Sold</span>
      </div>
      <div class="benefits"><h5 id="benefitsTitle">What you get as a Buyer</h5><ul id="benefitsList"></ul></div>
      <div class="trust"><span><i class="fas fa-shield-halved"></i>RERA verified on MahaRERA</span><span><i class="fas fa-lock"></i>Your details stay private</span></div>
    </aside>
    <div class="auth-main">
      <div class="modal-head"><h2 id="modalTitle">Create your account</h2><p id="modalSub">Takes less than a minute.</p></div>
      <div class="tabs" role="tablist" id="authTabs"><button class="tab" data-tab="signin">Sign in</button><button class="tab active" data-tab="signup">Create account</button></div>
      <div class="field" id="roleBlock"><label>I am a</label>
        <div class="roles" id="roleTiles">
          <label class="role"><input type="radio" name="role" value="buyer" checked><span><i class="fas fa-house-chimney"></i>Buyer / Investor</span></label>
          <label class="role"><input type="radio" name="role" value="developer"><span><i class="fas fa-building"></i>Developer / Builder</span></label>
          <label class="role"><input type="radio" name="role" value="agent"><span><i class="fas fa-handshake"></i>Agent / Broker / Channel Partner</span></label>
        </div>
      </div>

      <form class="auth-form" id="signinForm" novalidate>
        <div class="field"><label for="si-email">Email</label><input type="email" id="si-email" placeholder="you@example.com" autocomplete="username" required></div>
        <div class="field"><label for="si-pass">Password</label><div class="pass-wrap"><input type="password" id="si-pass" placeholder="••••••••" autocomplete="current-password" required><button type="button" class="pass-toggle" aria-label="Show password"><i class="fas fa-eye"></i></button></div></div>
        <div class="opts"><label><input type="checkbox"> Remember me</label><a href="#">Forgot password?</a></div>
        <button type="submit" class="btn btn-primary" id="signinBtn">Sign in</button>
        <div class="divider">or</div>
        <button type="button" class="btn-google"><svg viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> Continue with Google</button>
      </form>

      <form class="auth-form is-active" id="signupForm" novalidate>
        <div class="field-row">
          <div class="field"><label for="su-name">Full name</label><input type="text" id="su-name" name="name" placeholder="Your name" autocomplete="name" required></div>
          <div class="field"><label for="su-phone">WhatsApp number</label><input type="tel" id="su-phone" name="mobile" placeholder="+91 98XXX XXXXX" autocomplete="tel" pattern="[+0-9 ]{10,16}" required></div>
        </div>
        <div class="field"><label for="su-email">Email</label><input type="email" id="su-email" name="email" placeholder="you@example.com" autocomplete="email" required></div>
        <fieldset class="role-fields" data-for="buyer">
          <details class="opt-details">
            <summary><span><b>Tell us what you're looking for</b><small>Optional — get matching projects first</small></span><i class="fas fa-chevron-down"></i></summary>
            <div class="opt-body">
          <div class="field-row">
            <div class="field"><label for="b-area">Preferred area</label><input id="b-area" name="area" placeholder="e.g. Mundhwa, Kharadi"></div>
            <div class="field"><label for="b-config">Configuration</label><select id="b-config" name="configuration"><option>1 BHK</option><option selected>2 BHK</option><option>3 BHK</option><option>4+ BHK</option><option>Plot / Villa</option></select></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="b-budget">Budget</label><select id="b-budget" name="budget"><option>Under ₹50 L</option><option selected>₹50 L – ₹1 Cr</option><option>₹1 – 2 Cr</option><option>₹2 Cr +</option></select></div>
            <div class="field"><label for="b-time">Planning to buy</label><select id="b-time" name="timeline"><option>Within 3 months</option><option selected>3–6 months</option><option>6–12 months</option><option>Just exploring</option></select></div>
          </div>
          <div class="field"><label>Buying for</label><div class="pills"><label><input type="radio" name="purpose" value="Self use" checked><span>Self use</span></label><label><input type="radio" name="purpose" value="Investment"><span>Investment</span></label><label><input type="radio" name="purpose" value="Both"><span>Both</span></label></div></div>
            </div>
          </details>
        </fieldset>
        <fieldset class="role-fields" data-for="developer" hidden disabled>
          <legend>Company details</legend>
          <div class="field"><label for="d-company">Company / developer name</label><input id="d-company" name="company" placeholder="e.g. ABC Developers Pvt Ltd" required></div>
          <div class="field-row">
            <div class="field"><label for="d-role">Your role</label><select id="d-role" name="designation"><option>Owner / Director</option><option>Sales head</option><option>Marketing head</option><option>Other</option></select></div>
            <div class="field"><label for="d-count">Active projects</label><select id="d-count" name="activeProjects"><option>1</option><option>2–5</option><option>6–10</option><option>10+</option></select></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="d-rera">A MahaRERA project no.</label><input id="d-rera" name="reraProject" placeholder="P52100012345" required></div>
            <div class="field"><label for="d-web">Website <small>(optional)</small></label><input id="d-web" name="website" type="url" placeholder="https://"></div>
          </div>
        </fieldset>
        <fieldset class="role-fields" data-for="agent" hidden disabled>
          <legend>Agency details</legend>
          <div class="field"><label for="a-firm">Agency / firm name <small>(or “Individual”)</small></label><input id="a-firm" name="agency" placeholder="e.g. Prime Realty Advisors" required></div>
          <div class="field-row">
            <div class="field"><label for="a-rera">MahaRERA agent no.</label><input id="a-rera" name="reraAgent" placeholder="A5XXXXXXXXXX" required></div>
            <div class="field"><label for="a-areas">Areas you work in</label><input id="a-areas" name="areas" placeholder="Mundhwa, Kharadi" required></div>
          </div>
        </fieldset>
        <div class="field"><label for="su-pass">Password</label><div class="pass-wrap"><input type="password" id="su-pass" placeholder="At least 8 characters" autocomplete="new-password" minlength="8" required><button type="button" class="pass-toggle" aria-label="Show password"><i class="fas fa-eye"></i></button></div></div>
        <p class="verify-note" id="verifyNote" hidden><i class="fas fa-shield-halved"></i><span>We verify your RERA number on the MahaRERA website before your account gets full access, usually within one working day.</span></p>
        <div class="opts"><label><input type="checkbox" id="su-terms" required> I agree to the <a href="/terms" target="_blank" rel="noopener">Terms</a> & <a href="/privacy" target="_blank" rel="noopener">Privacy</a> and to be contacted on WhatsApp.</label></div>
        <button type="submit" class="btn btn-primary" id="signupBtn">Create account</button>
        <div class="divider">or</div>
        <button type="button" class="btn-google"><svg viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> Continue with Google</button>
      </form>

      <div class="success" id="successView">
        <div class="tick"><i class="fas fa-check"></i></div>
        <h3 id="successTitle">You're all set!</h3>
        <p id="successSub">Your account is ready.</p>
        <button type="button" class="btn btn-primary" id="successOpen"><i class="fas fa-map-location-dot"></i> Open the live map</button>
        <button type="button" class="btn btn-outline" id="successClose">Back to overview</button>
      </div>
    </div>
  </div>
</div>
<div class="mpg-toast" id="toast" role="status" aria-live="polite"></div>
`;

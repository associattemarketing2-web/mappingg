// Server-rendered landing markup for the Mappingg home page. Kept as a raw HTML
// string (injected with dangerouslySetInnerHTML) so the exact hand-tuned design
// ships verbatim and is fully server-rendered for SEO. All behaviour lives in
// LandingClient.tsx. "Open live map" links point at the in-app /map route.
// NOTE: the top navigation is now the shared <SiteHeader/> React component
// (rendered by the home page), so the landing markup below starts at the hero.
// Markers filled in by app/page.tsx: <!--HERO_CHIPS--> (popular localities),
// <!--MAP_PREVIEW--> (real map + locality counts shown until the live map loads),
// <!--BUYER_JOURNEY--> ("Built for every home buyer": features, photo panel, live counts),
// <!--STATS_STRIP--> (counts + quick links under the hero) / <!--STATS_BAND--> (live counts), <!--DEV_LOGOS-->, and
// <!--SPLIT--> where the React "Projects near you" goes. The <!--M_…--> markers are
// phone-only sections (components/landing/mobile-sections.ts, hidden above 720 px).
// Styles: app/home.css (sections) + app/landing.css (modal, live-map trial).
import { COUNTRY_CODES } from '@/lib/country-codes';
import { BHK_OPTIONS, BUDGET_OPTIONS } from '@/lib/home/finder';

// Hero search filters (same values as the /projects filters).
const BHK_SELECT = BHK_OPTIONS.map((o) => `<option value="${o.slug}">${o.label}</option>`).join('');
const BUDGET_SELECT = BUDGET_OPTIONS.map((o) => `<option value="${o.slug}">${o.label}</option>`).join('');

// Country-code options for phone fields (India +91 selected). Only +91 is in
// the live DOM; the full ~220-option list sits in an inert <template> (no style
// or layout cost on page load) and landing.js swaps it in when the dropdown is
// first opened.
const PHONE_CODE_OPTIONS = COUNTRY_CODES
  .map(([c, f]) => `<option value="${c}"${c === '+91' ? ' selected' : ''}>${f} ${c}</option>`)
  .join('');
const PHONE_CODE_DEFAULT = '<option value="+91" selected>🇮🇳 +91</option>';

export const LANDING_BODY = `
<header class="hm-hero" id="home">
  <div class="hm-hero-bg" aria-hidden="true"></div>
  <div class="hm-wrap hm-hero-grid">
    <div class="hm-hero-copy">
      <span class="hm-kicker"><span class="dot"></span>India's real estate project map</span>
      <h1><span class="hm-h1-d">Find your next home <span>by location.</span></span> <span class="hm-h1-m">Discover, Compare &amp; Find Your Next Home on an <em>Interactive Map</em></span></h1>
      <p class="hm-lead"><span class="hm-h1-d">Explore verified residential projects with real locations, prices, RERA details, nearby infrastructure and amenities — all in one interactive map.</span><span class="hm-h1-m">Explore verified projects, real prices, RERA details, nearby infrastructure and more — all in one place.</span></p>
      <!--M_TRUST-->

      <div class="hm-search">
        <div class="hm-tabs" aria-label="What are you looking for">
          <a href="/projects" class="hm-tab active" aria-current="page"><i class="fas fa-house"></i>Buy</a>
          <a href="/property/plotted-development" class="hm-tab"><i class="fas fa-border-all"></i>Plots</a>
          <a href="/property/commercial" class="hm-tab"><i class="fas fa-building"></i>Commercial</a>
        </div>
        <div class="mh-only mh-modes" role="group" aria-label="How to search">
          <button type="button" class="on" data-mode="map" aria-pressed="true"><i class="far fa-map" aria-hidden="true"></i>Explore on Map</button>
          <button type="button" data-mode="list" aria-pressed="false"><i class="fas fa-list-ul" aria-hidden="true"></i>Search Projects</button>
        </div>
        <form class="hm-form" id="heroAskForm" role="search" action="/projects" method="get" aria-label="Search projects">
          <label class="hm-field hm-field-q"><i class="fas fa-location-dot" aria-hidden="true"></i><span class="sr-only">Locality, project or developer</span>
            <input id="heroAskInput" name="q" type="search" placeholder="Locality" autocomplete="off" enterkeyhint="search" maxlength="80"><button type="button" class="hm-mic" id="heroMic" aria-label="Search by voice" hidden><i class="fas fa-microphone" aria-hidden="true"></i></button></label>
          <label class="hm-field"><span class="sr-only">BHK</span><select id="heroBhk" name="bhk"><option value="">Any BHK</option>${BHK_SELECT}</select></label>
          <label class="hm-field"><span class="sr-only">Budget</span><select id="heroBudget" name="budget"><option value="">Any budget</option>${BUDGET_SELECT}</select></label>
          <label class="hm-field hm-field-city"><span class="sr-only">City</span><select id="heroCity" name="city"><option value="">Any city</option><option value="pune" selected>Pune</option><option value="mumbai">Mumbai</option></select></label>
          <button type="submit" class="hm-btn hm-btn-solid"><i class="fas fa-magnifying-glass hm-d" aria-hidden="true"></i><i class="fas fa-map-location-dot hm-m" aria-hidden="true"></i> <span class="hm-d">Search Projects</span><span class="hm-m" id="heroBtnLabel">Explore Projects on Map</span><i class="fas fa-arrow-right hm-m" aria-hidden="true"></i></button>
        </form>
        <!--HERO_CHIPS-->
      </div>
      <!--M_CATS-->
    </div>
  </div>

  <div class="hm-hero-map" id="live-map">
      <div class="browser trial hm-map" id="liveBrowser" aria-label="Mappingg live map — try it">
        <div class="browser-body">
          <div class="map-fallback" aria-hidden="true"></div>
          <!--MAP_PREVIEW-->
          <iframe id="liveFrame" title="Mappingg live map" data-src="/map?embed=home" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="geolocation"></iframe>
          <button type="button" class="hm-full" id="mapFull" aria-label="Open the live map full screen" title="Open full screen map"><i class="fas fa-expand"></i><span>Full screen</span></button>
          <div class="map-hint" id="mapHint"><i class="fas fa-hand-pointer"></i><span>Tap any pin to explore — <b id="tapLeft">3</b> free projects left</span></div>
          <div class="map-lock" id="mapLock" hidden>
            <div class="lock-card" role="dialog" aria-labelledby="lockTitle">
              <div class="lock-ic"><i class="fas fa-lock"></i></div>
              <h3 id="lockTitle">Sign in to keep exploring</h3>
              <p>You've used your 3 complimentary searches. Create a buyer account to open every pin, price and possession date.</p>
              <ul class="lock-perks">
                <li><i class="fas fa-check"></i>Full details for every project</li>
                <li><i class="fas fa-check"></i>RERA numbers from official registries</li>
                <li><i class="fas fa-check"></i>Nearby schools, metro & new roads</li>
              </ul>
              <button type="button" class="btn btn-primary btn-lg lock-buyer" data-role="buyer"><i class="fas fa-house-chimney"></i> Continue as a buyer</button>
              <button type="button" class="lock-signin" id="lockSignin">Already have an account? <b>Sign in</b></button>
            </div>
          </div>
        </div>
      </div>
    </div>
</header>
<!--STATS_STRIP-->

<!--SPLIT-->

<!--M_DISCOVER-->

<section class="hm-sec hm-around" id="features">
  <div class="hm-wrap hm-around-grid">
    <div class="hm-around-copy">
      <h2>See what's around <span>every project.</span></h2>
      <p class="hm-sub">Understand the real context — schools, hospitals, IT parks, metro, malls and more with actual distances.</p>
      <ul class="hm-poi-list" id="hmPoiList">
        <li><button type="button" data-poi="school"><span class="ic c-school"><i class="fas fa-school"></i></span><span><b>Schools</b><small>Nearby schools around each project.</small></span></button></li>
        <li><button type="button" data-poi="hospital"><span class="ic c-hospital"><i class="fas fa-hospital"></i></span><span><b>Hospitals</b><small>Multi-speciality and nearest hospitals.</small></span></button></li>
        <li><button type="button" data-poi="metro"><span class="ic c-metro"><i class="fas fa-train-subway"></i></span><span><b>Metro &amp; transport</b><small>Metro stations, bus stops and highways.</small></span></button></li>
        <li><button type="button" data-poi="it"><span class="ic c-it"><i class="fas fa-building"></i></span><span><b>IT parks &amp; offices</b><small>Major employment hubs with drive time.</small></span></button></li>
        <li><button type="button" data-poi="mall"><span class="ic c-mall"><i class="fas fa-bag-shopping"></i></span><span><b>Malls &amp; shopping</b><small>Malls, restaurants and entertainment.</small></span></button></li>
      </ul>
      <a href="/map" class="hm-btn hm-btn-line trial-link">Explore location insights <i class="fas fa-arrow-right"></i></a>
    </div>
    <div class="hm-aerial" id="hmAerial" data-poi="all" data-view="satellite">
      <div class="hm-aerial-tabs" role="tablist" aria-label="Map style">
        <button type="button" role="tab" data-view="map" aria-selected="false">Map</button>
        <button type="button" role="tab" data-view="satellite" aria-selected="true" class="on">Satellite</button>
      </div>
      <div class="hm-aerial-stage">
        <svg class="hm-aerial-map" viewBox="0 0 600 380" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <rect width="600" height="380" fill="#f3efe6"/>
          <g fill="#e9e3d6"><rect x="18" y="18" width="150" height="96" rx="10"/><rect x="198" y="26" width="76" height="80" rx="10"/><rect x="440" y="18" width="142" height="104" rx="10"/><rect x="24" y="250" width="150" height="110" rx="10"/><rect x="410" y="262" width="172" height="100" rx="10"/><rect x="214" y="268" width="140" height="70" rx="10"/></g>
          <rect x="300" y="24" width="112" height="84" rx="16" fill="#d6ebce"/>
          <path d="M-20 214 C 110 168 230 252 360 204 S 540 170 620 192" stroke="#a9d0ef" stroke-width="30" fill="none" stroke-linecap="round"/>
          <g stroke-linecap="round" fill="none">
            <path d="M0 140H600M188 0V380M428 0V380" stroke="#e2dacb" stroke-width="14"/>
            <path d="M0 140H600M188 0V380M428 0V380" stroke="#fff" stroke-width="9"/>
            <path d="M0 352 C 210 328 380 372 600 338" stroke="#e8b45a" stroke-width="14"/>
            <path d="M0 352 C 210 328 380 372 600 338" stroke="#f7d89a" stroke-width="9"/>
          </g>
        </svg>
        <div class="hm-aerial-photo" aria-hidden="true"></div>
        <div class="hm-aerial-center"><span class="hm-pulse"></span><b>Your project</b><small>Distances from here</small></div>
        <div class="hm-chip c-it" data-poi="it" style="left:22%;top:16%"><span class="ic"><i class="fas fa-building"></i></span><span><b>IT park</b><small>12 min</small></span></div>
        <div class="hm-chip c-mall" data-poi="mall" style="left:20%;top:44%"><span class="ic"><i class="fas fa-bag-shopping"></i></span><span><b>Mall</b><small>8 min</small></span></div>
        <div class="hm-chip c-hospital" data-poi="hospital" style="left:18%;top:74%"><span class="ic"><i class="fas fa-hospital"></i></span><span><b>Hospital</b><small>6 min</small></span></div>
        <div class="hm-chip c-school" data-poi="school" style="left:80%;top:20%"><span class="ic"><i class="fas fa-school"></i></span><span><b>School</b><small>1.2 km</small></span></div>
        <div class="hm-chip c-metro" data-poi="metro" style="left:80%;top:70%"><span class="ic"><i class="fas fa-train-subway"></i></span><span><b>Metro station</b><small>5 min</small></span></div>
        <p class="hm-aerial-note">Illustration — open any project on the live map for its real distances.</p>
      </div>
      <div class="hm-thumbs" id="hmThumbs">
        <button type="button" data-poi="all" class="on"><i class="fas fa-map"></i>Overview</button>
        <button type="button" data-poi="school"><i class="fas fa-school"></i>Schools</button>
        <button type="button" data-poi="hospital"><i class="fas fa-hospital"></i>Hospitals</button>
        <button type="button" data-poi="it"><i class="fas fa-building"></i>IT Parks</button>
        <button type="button" data-poi="metro"><i class="fas fa-train-subway"></i>Metro</button>
        <button type="button" data-poi="mall"><i class="fas fa-bag-shopping"></i>Malls</button>
      </div>
    </div>
  </div>
</section>

<!--DEV_LOGOS-->

<section class="hm-sec hm-how" id="how">
  <div class="hm-wrap">
    <div class="hm-head hm-center">
      <span class="hm-eyebrow">How it works</span>
      <h2>Find the right project in <span class="accent">3 simple steps</span></h2>
      <p class="hm-sub">See the facts on the map first, then enquire only about the projects you like.</p>
    </div>
    <ol class="hm-flow">
      <li class="hm-fstep">
        <div class="hm-fvis hm-fvis-1" aria-hidden="true">
          <div class="v-search"><i class="fas fa-location-dot"></i><span>Kharadi</span><b>2 BHK</b><b>₹1–2 Cr</b></div>
          <span class="v-pin p1"><i class="fas fa-location-dot"></i></span>
          <span class="v-pin p2"><i class="fas fa-location-dot"></i></span>
          <span class="v-pin p3"><i class="fas fa-location-dot"></i></span>
          <span class="v-road r1"></span><span class="v-road r2"></span><span class="v-river"></span>
        </div>
        <div class="hm-ftext">
          <span class="hm-fnum">1</span>
          <h3>Search &amp; explore</h3>
          <p>Pick a locality, BHK and budget — every matching project shows up as a pin on the map.</p>
        </div>
      </li>
      <li class="hm-fstep">
        <div class="hm-fvis hm-fvis-2" aria-hidden="true">
          <div class="v-card">
            <div class="v-row"><span><i class="fas fa-shield-halved"></i>RERA</span><b class="ok">Registered <i class="fas fa-circle-check"></i></b></div>
            <div class="v-row"><span><i class="fas fa-indian-rupee-sign"></i>Price</span><b>₹1.25 Cr onwards</b></div>
            <div class="v-row"><span><i class="fas fa-calendar-check"></i>Possession</span><b>Dec 2029</b></div>
            <div class="v-row"><span><i class="fas fa-school"></i>Nearby</span><b>School · 1.2 km</b></div>
          </div>
        </div>
        <div class="hm-ftext">
          <span class="hm-fnum">2</span>
          <h3>Check the real facts</h3>
          <p>RERA number from the official registry, price, possession date and what's nearby — on one card.</p>
        </div>
      </li>
      <li class="hm-fstep">
        <div class="hm-fvis hm-fvis-3" aria-hidden="true">
          <div class="v-compare">
            <div><small>Project A</small><b>₹1.25 Cr</b><em>Dec 2029</em></div>
            <div class="vs">vs</div>
            <div><small>Project B</small><b>₹1.10 Cr</b><em>Ready</em></div>
          </div>
          <span class="v-wa"><i class="fab fa-whatsapp"></i>Enquire on WhatsApp</span>
        </div>
        <div class="hm-ftext">
          <span class="hm-fnum">3</span>
          <h3>Compare &amp; enquire</h3>
          <p>Shortlist, compare side by side and enquire directly with the developer in one tap.</p>
        </div>
      </li>
    </ol>
    <div class="hm-flow-cta">
      <a href="/map" class="hm-btn hm-btn-solid trial-link"><i class="fas fa-map-location-dot"></i> Try the live map free</a>
      <span>3 projects free · no sign-up needed</span>
    </div>
  </div>
</section>

<!--BUYER_JOURNEY-->

<!--M_INSIGHTS-->

<section class="hm-band" aria-label="Mappingg in numbers">
  <div class="hm-wrap"><!--STATS_BAND--></div>
</section>

<section class="hm-cta">
  <div class="hm-wrap hm-cta-row">
    <div>
      <h2>Ready to find your next home?</h2>
      <p>Create a free buyer account in under a minute — just your WhatsApp number.</p>
      <ul class="hm-cta-perks">
        <li><i class="fas fa-check"></i>Open every project on the map</li>
        <li><i class="fas fa-check"></i>Prices, BHK &amp; possession dates</li>
        <li><i class="fas fa-check"></i>Compare projects &amp; enquire directly</li>
      </ul>
    </div>
    <div class="hm-cta-btns">
      <a href="#" class="hm-btn hm-btn-white open-signup" data-role="buyer">Sign Up for Free <i class="fas fa-arrow-right"></i></a>
      <a href="/map" class="hm-btn hm-btn-ghost trial-link">Explore Live Map</a>
    </div>
  </div>
</section>

<div class="hm-sticky guest-only" id="hmSticky" aria-label="Get started">
  <a href="/map" class="hm-btn hm-btn-line trial-link"><i class="fas fa-map-location-dot"></i> Live Map</a>
  <a href="#" class="hm-btn hm-btn-solid open-signup" data-role="buyer">Sign Up Free</a>
</div>

<footer class="hm-footer">
  <div class="hm-wrap">
    <div class="hm-foot-grid">
      <div class="hm-foot-brand">
        <a href="#home" class="hm-brand"><span class="brand-mark" aria-hidden="true"></span><span class="brand-name">Mappingg<em>.com</em></span></a>
        <p>India's real estate project map. A product by Associatte.</p>
        <div class="hm-socials">
          <a href="https://www.linkedin.com/company/mappingg-com/" target="_blank" rel="noopener" aria-label="LinkedIn" class="li"><i class="fab fa-linkedin-in"></i></a>
          <a href="https://www.facebook.com/share/1CH5PwZUsM/?mibextid=wwXIfr" target="_blank" rel="noopener" aria-label="Facebook" class="fb"><i class="fab fa-facebook-f"></i></a>
          <a href="https://www.instagram.com/mappingg.associatte/" target="_blank" rel="noopener" aria-label="Instagram" class="ig"><i class="fab fa-instagram"></i></a>
          <a href="https://www.youtube.com/@mappingg-official" target="_blank" rel="noopener" aria-label="YouTube" class="yt"><i class="fab fa-youtube"></i></a>
          <a href="https://wa.me/918228828200" target="_blank" rel="noopener" aria-label="WhatsApp" class="wa"><i class="fab fa-whatsapp"></i></a>
        </div>
      </div>
      <div><h3>Product</h3><ul><li><a href="/map" class="trial-link">Live Map</a></li><li><a href="/how-it-works">How it works</a></li><li><a href="/features">Features</a></li><li><a href="/faq">FAQ</a></li></ul></div>
      <div><h3>Company</h3><ul><li><a href="/about">About Us</a></li><li><a href="/blog">Blog</a></li><li><a href="/advertise">Advertise</a></li><li><a href="/contact">Contact</a></li></ul></div>
      <div><h3>Legal</h3><ul><li><a href="/privacy">Privacy Policy</a></li><li><a href="/terms">Terms &amp; Conditions</a></li><li><a href="/disclaimer">Disclaimer</a></li><li><a href="/cookies">Cookies</a></li><li><a href="/map-data">Map data</a></li></ul></div>
      <div><h3>Contact</h3><ul class="hm-contact"><li><a href="mailto:mappingg.associatte@gmail.com"><i class="fas fa-envelope"></i>mappingg.associatte@gmail.com</a></li><li><a href="https://wa.me/918228828200" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i>+91 82288 28200</a></li><li><span><i class="fas fa-location-dot"></i>Pune, Maharashtra, India</span></li></ul></div>
    </div>
    <p class="hm-disclaimer">RERA numbers come from the official state RERA registries (for Maharashtra, the <a href="https://maharera.maharashtra.gov.in/" target="_blank" rel="noopener">MahaRERA website</a>). Other project information comes from developers and is shown for reference only. Please confirm all details with the developer and the state RERA authority before making a decision.</p>
    <div class="hm-foot-bottom"><span>© 2026 Mappingg.com. All rights reserved.</span></div>
  </div>
</footer>


<div class="mpg-modal-overlay" id="authModal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
  <div class="modal-card">
    <button class="modal-close" id="modalClose" aria-label="Close"><i class="fas fa-times"></i></button>
    <aside class="auth-side">
      <a class="brand" href="#home"><span class="brand-mark" aria-hidden="true"></span><span class="brand-name">Mappingg<em>.com</em></span></a>
      <h3 id="sideTitle">Find, check and compare every project</h3>
      <p id="sideSub">See live status, verified RERA numbers and possession dates for projects across India and Dubai.</p>
      <figure class="side-video">
        <video id="authVideo" src="/video/how-mappingg-works-v1.mp4" poster="/video/how-mappingg-works-v1.jpg" muted playsinline loop controls preload="none" aria-label="How to use Mappingg: a 40-second walkthrough of the live map"></video>
        <figcaption><i class="fas fa-circle-play"></i> How to use Mappingg <span>· 40 sec</span></figcaption>
      </figure>
      <div class="benefits"><h5 id="benefitsTitle">What you get as a Buyer</h5><ul id="benefitsList"></ul></div>
      <div class="trust"><span><i class="fas fa-shield-halved"></i>RERA numbers from official registries</span><span><i class="fas fa-lock"></i>Your details stay private</span></div>
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
        <div class="opts"><label><input type="checkbox"> Remember me</label><a href="#" id="forgotLink">Forgot password?</a></div>
        <button type="submit" class="btn btn-primary" id="signinBtn">Sign in</button>
        <div class="divider">or</div>
        <button type="button" class="btn-wa" id="waLoginLink"><i class="fab fa-whatsapp"></i> Sign in with WhatsApp OTP</button>
        <button type="button" class="btn-google"><svg viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> Continue with Google</button>
      </form>

      <form class="auth-form is-active" id="signupForm" novalidate>
        <div class="su-quick" id="su-quick">
          <button type="button" class="btn btn-primary btn-wa-cta" id="quickWaBtn"><i class="fab fa-whatsapp" aria-hidden="true"></i> Create account with WhatsApp OTP</button>
          <small>Just your WhatsApp number and a 6-digit code — nothing else to fill in.</small>
          <div class="divider">or sign up with email</div>
        </div>
        <p class="req-note" id="su-req-note">Your name, WhatsApp number, email and a password — we’ll send a 6-digit code on WhatsApp to verify your number.</p>
        <div class="field-row">
          <div class="field"><label for="su-name">Full name</label><input type="text" id="su-name" name="name" placeholder="Your name" autocomplete="name" required></div>
          <div class="field"><label for="su-phone">WhatsApp number</label><div class="phone-in is-empty"><span class="phone-cc"><img alt="" width="22" height="16"><span class="phone-iso"></span><span class="phone-cc-code">+91</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg><select id="su-phone-code" aria-label="Country code">${PHONE_CODE_DEFAULT}</select></span><input type="tel" id="su-phone" name="mobile" placeholder="10-digit number" autocomplete="tel-national" inputmode="numeric" maxlength="10" pattern="\\d{10}" title="Enter a 10-digit mobile number" required><span class="phone-count" aria-hidden="true"></span></div></div>
        </div>
        <div class="field"><label for="su-email">Email</label><input type="email" id="su-email" name="email" placeholder="you@example.com" autocomplete="email" required></div>
        <fieldset class="role-fields" data-for="developer" hidden disabled>
          <legend>Company details</legend>
          <div class="field"><label for="d-company">Company / developer name</label><input id="d-company" name="company" placeholder="e.g. ABC Developers Pvt Ltd" required></div>
          <div class="field-row">
            <div class="field"><label for="d-role">Your role</label><select id="d-role" name="designation" required><option value="" disabled selected>Select…</option><option>Owner / Director</option><option>Sales head</option><option>Marketing head</option><option>Other</option></select></div>
            <div class="field"><label for="d-count">Active projects</label><select id="d-count" name="activeProjects" required><option value="" disabled selected>Select…</option><option>1</option><option>2–5</option><option>6–10</option><option>10+</option></select></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="d-rera">A MahaRERA project no.</label><input id="d-rera" name="reraProject" placeholder="P52100012345" required></div>
            <div class="field"><label for="d-web" class="opt">Website <small>(optional)</small></label><input id="d-web" name="website" type="url" placeholder="https://"></div>
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
        <div class="field"><label for="su-pass">Password</label><div class="pass-wrap"><input type="password" id="su-pass" name="password" placeholder="At least 8 characters" autocomplete="new-password" minlength="8" required aria-describedby="su-pass-hint"><button type="button" class="pass-toggle" aria-label="Show password"><i class="fas fa-eye"></i></button></div><small class="loc-note" id="su-pass-hint">Forgot it later? Reset it with a code on your WhatsApp.</small></div>
        <p class="verify-note" id="verifyNote" hidden><i class="fas fa-shield-halved"></i><span>We verify your RERA number on the MahaRERA website before your account gets full access, usually within one working day.</span></p>
        <div class="opts"><label><input type="checkbox" id="su-terms" required> I agree to the <a href="/terms" target="_blank" rel="noopener">Terms</a> & <a href="/privacy" target="_blank" rel="noopener">Privacy</a> and to be contacted on WhatsApp.</label></div>
        <div class="field otp-block" id="su-otp-block" hidden>
          <label for="su-otp">Verification code</label>
          <input id="su-otp" inputmode="numeric" maxlength="6" placeholder="6-digit code" autocomplete="one-time-code">
          <div class="otp-meta"><small id="su-otp-hint">We sent a code to your WhatsApp.</small><a href="#" id="su-otp-resend">Resend code</a></div>
        </div>
        <button type="submit" class="btn btn-primary" id="signupBtn">Create account</button>
        <div class="divider">or</div>
        <button type="button" class="btn-google"><svg viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> Continue with Google</button>
      </form>

      <form class="auth-form" id="waLoginForm" novalidate>
        <p class="otp-intro" id="wa-intro">Enter the WhatsApp number on your account — we’ll send you a 6-digit code to sign in.</p>
        <div class="field"><label for="wa-phone">WhatsApp number</label><div class="phone-in is-empty"><span class="phone-cc"><img alt="" width="22" height="16"><span class="phone-iso"></span><span class="phone-cc-code">+91</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg><select id="wa-phone-code" aria-label="Country code">${PHONE_CODE_DEFAULT}</select></span><input type="tel" id="wa-phone" placeholder="10-digit number" autocomplete="tel-national" inputmode="numeric" maxlength="10" pattern="\\d{10}" title="Enter a 10-digit mobile number" required><span class="phone-count" aria-hidden="true"></span></div></div>
        <div class="field otp-block" id="wa-otp-block" hidden>
          <label for="wa-otp">Verification code</label>
          <input id="wa-otp" inputmode="numeric" maxlength="6" placeholder="6-digit code" autocomplete="one-time-code">
          <div class="otp-meta"><small id="wa-otp-hint"></small><a href="#" id="wa-resend">Resend code</a></div>
        </div>
        <button type="submit" class="btn btn-primary" id="waLoginBtn">Send code on WhatsApp</button>
        <div class="opts"><a href="#" id="wa-back"><i class="fas fa-arrow-left"></i> <span id="wa-back-label">Sign in with password</span></a></div>
      </form>

      <form class="auth-form" id="forgotForm" novalidate>
        <p class="otp-intro">Enter the WhatsApp number on your account — we’ll send a 6-digit code to it so you can set a new password.</p>
        <div class="field"><label for="fp-phone">WhatsApp number</label><div class="phone-in is-empty"><span class="phone-cc"><img alt="" width="22" height="16"><span class="phone-iso"></span><span class="phone-cc-code">+91</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg><select id="fp-phone-code" aria-label="Country code">${PHONE_CODE_DEFAULT}</select></span><input type="tel" id="fp-phone" placeholder="10-digit number" autocomplete="tel-national" inputmode="numeric" maxlength="10" pattern="\\d{10}" title="Enter a 10-digit mobile number" required><span class="phone-count" aria-hidden="true"></span></div></div>
        <div id="fp-step2" hidden>
          <div class="field otp-block"><label for="fp-otp">Verification code</label><input id="fp-otp" inputmode="numeric" maxlength="6" placeholder="6-digit code" autocomplete="one-time-code"><div class="otp-meta"><small id="fp-otp-hint"></small><a href="#" id="fp-resend">Resend code</a></div></div>
          <div class="field"><label for="fp-pass">New password</label><div class="pass-wrap"><input type="password" id="fp-pass" placeholder="At least 8 characters" autocomplete="new-password" minlength="8"><button type="button" class="pass-toggle" aria-label="Show password"><i class="fas fa-eye"></i></button></div></div>
        </div>
        <button type="submit" class="btn btn-primary" id="forgotBtn">Send code</button>
        <div class="opts"><a href="#" id="fp-back"><i class="fas fa-arrow-left"></i> Back to sign in</a></div>
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
<template id="mpg-cc-options">${PHONE_CODE_OPTIONS}</template>
`;

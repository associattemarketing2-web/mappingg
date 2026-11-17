// One-off, idempotent patch of the live map bundle (public/legacy/public-map.json)
// for the subscription system:
//   1. "Enquire now" / project details answered 402 (plan limit, CP city): show
//      an upgrade dialog instead of falling back to the guest enquiry form.
//   2. Site visit on a developer project whose plan doesn't include booking:
//      the enquiry is still saved — say so instead of "Site visit booked".
//   3. Buyers get the ♥ favourites button too (Buyer Free plan feature).
// Run:  node migration/patch-map-subscriptions.mjs        (writes the file)
//       node migration/patch-map-subscriptions.mjs --check (exit 1 if not patched)
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../public/legacy/public-map.json', import.meta.url);
const raw = readFileSync(FILE, 'utf8');
const j = JSON.parse(raw);
const MARK = '/* mg-subscriptions v1 */';

const idx = j.scripts.findIndex((s) => typeof s.code === 'string' && s.code.includes('async function autoEnquire(pin, visit)'));
if (idx < 0) throw new Error('autoEnquire not found');
let code = j.scripts[idx].code;
for (const need of ['function escapeHtml(', 'function trackEvent(', 'favEnabled', 'function refreshFavUI(']) {
  if (!code.includes(need)) throw new Error(`expected ${need} in the same script`);
}

if (process.argv.includes('--check')) {
  console.log(code.includes(MARK) ? 'patched' : 'NOT patched');
  process.exit(code.includes(MARK) ? 0 : 1);
}
if (code.includes(MARK)) {
  console.log('Already patched — nothing to do.');
  process.exit(0);
}

function replaceOnce(from, to) {
  const at = code.indexOf(from);
  if (at < 0 || code.indexOf(from, at + 1) >= 0) throw new Error(`anchor not unique / missing: ${from.slice(0, 60)}`);
  code = code.slice(0, at) + to + code.slice(at + from.length);
}

// 1) the upgrade dialog + 402 handling
const GATE = `${MARK}
  // A signed-in channel partner / buyer over their plan's limit (or outside a
  // one-city plan): the server answers 402 — explain and offer the upgrade.
  // The project's public card stays as it is.
  function showPlanGate(pin, err){
    let box = document.getElementById('mg-plan-gate');
    if(!box){
      box = document.createElement('div');
      box.id = 'mg-plan-gate';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', 'Plan limit');
      box.style.cssText = 'position:fixed;inset:0;z-index:4000;display:none;place-items:center;padding:16px;background:rgba(10,30,24,.55)';
      document.body.appendChild(box);
      box.addEventListener('click', (e)=>{ if(e.target === box || e.target.closest('[data-close]')) box.style.display = 'none'; });
      document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape' && box.style.display !== 'none') box.style.display = 'none'; });
    }
    const manage = typeof err.manage === 'string' && err.manage.startsWith('/') ? err.manage : '/pricing';
    const href = err.upgrade && err.upgrade.code ? manage + '?plan=' + encodeURIComponent(err.upgrade.code) : manage;
    const u = err.usage;
    const usage = u && u.limit != null
      ? '<p style="margin:0;color:#66716b;font-size:13px">' + u.used + ' of ' + u.limit + ' used' + (u.resetsAt ? ' · resets ' + new Date(u.resetsAt).toLocaleDateString('en-IN', { day:'numeric', month:'short' }) : '') + '</p>'
      : '';
    box.innerHTML = '<div style="background:#fff;border-radius:18px;max-width:420px;width:100%;padding:22px;box-shadow:0 30px 80px -30px rgba(0,0,0,.5);font-family:Inter,system-ui,sans-serif;color:#16261f">'
      + '<div style="width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:#f7f0df;color:#7a5f1f;font-size:20px">&#128274;</div>'
      + '<h2 style="margin:12px 0 6px;font-size:19px;letter-spacing:-.02em">' + escapeHtml(pin.title || 'This project') + '</h2>'
      + '<p style="margin:0 0 8px;color:#4a5568;line-height:1.55;font-size:14px">' + escapeHtml(err.message || 'Upgrade your plan to open more projects.') + '</p>' + usage
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">'
      + '<a href="' + escapeHtml(href) + '" style="background:#0f5c47;color:#fff;padding:10px 16px;border-radius:11px;text-decoration:none;font-weight:600;font-size:14px">' + (err.upgrade && err.upgrade.name ? 'Upgrade to ' + escapeHtml(err.upgrade.name) : 'See plans') + '</a>'
      + '<a href="/pricing" style="background:#fff;border:1px solid #e6e2d8;color:#16261f;padding:10px 16px;border-radius:11px;text-decoration:none;font-weight:600;font-size:14px">Compare plans</a>'
      + '<button type="button" data-close style="background:none;border:0;color:#66716b;padding:10px 6px;font-weight:600;font-size:14px;cursor:pointer">Not now</button></div></div>';
    box.style.display = 'grid';
    const first = box.querySelector('a');
    if(first) first.focus();
    trackEvent('lead', 'plan_gate', pin.title || ('#' + pin.number));
  }

  let autoEnquireBusy = false;`;
replaceOnce('  let autoEnquireBusy = false;', GATE);

replaceOnce(
  "      const b = await r.json().catch(()=>null);\n      if(!r.ok || !b || !b.data || !b.data.ok) throw new Error('enquire failed');",
  "      const b = await r.json().catch(()=>null);\n      if(r.status === 402 && b && b.error){ showPlanGate(pin, b.error); return; }\n      if(!r.ok || !b || !b.data || !b.data.ok) throw new Error('enquire failed');",
);

// 2) site visit not offered on this developer's plan
replaceOnce(
  '      if(d.lead && visit){',
  "      if(d.lead && visit && d.site_visit_unavailable){\n        detailNote('Enquiry sent', 'Online site-visit booking isn\\u2019t available for this project — our team will contact you to arrange a visit.');\n      } else if(d.lead && visit){",
);

// 3) favourites for buyers (alongside their compare cart)
replaceOnce(
  "      if(!u || u.role !== 'buyer') return;\n      compareEnabled = true;",
  "      if(!u || u.role !== 'buyer') return;\n      favEnabled = true;\n      fetch('/api/my/favorites', { credentials:'same-origin' })\n        .then(r => r.ok ? r.json() : null)\n        .then(d=>{ if(d && Array.isArray(d.pins)) favIds = d.pins; refreshFavUI(); })\n        .catch(()=>{});\n      compareEnabled = true;",
);

j.scripts[idx].code = code;
writeFileSync(FILE, JSON.stringify(j));
console.log('Patched public/legacy/public-map.json');

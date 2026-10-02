// Admin panel shell: sign-in, navigation and routing.
import { createClient, $, h, esc, toast, friendlyError, getConfig } from '../shared/lib.js';
import { renderQueue } from './views/queue.js';
import { renderReview, createManualSubmission } from './views/review.js';
import { renderBuilders, renderBuilderDetail } from './views/builders.js';
import { renderImport } from './views/import.js';
import { renderLive } from './views/live.js';

import { ctx, refreshCounts } from './context.js';

const cfg = getConfig();
const root = $('#root');

start();

async function start() {
  try {
    ctx.client = createClient();
  } catch (e) {
    root.innerHTML = `<div class="login"><div class="card"><div class="logo">Mappingg</div><p>${esc(e.message)}</p></div></div>`;
    return;
  }
  const { data } = await ctx.client.auth.getSession();
  if (data.session) await enter(data.session.user); else showLogin();
  ctx.client.auth.onAuthStateChange((evt, session) => {
    if (evt === 'SIGNED_OUT') showLogin();
    if (evt === 'PASSWORD_RECOVERY') showSetPassword();
    if (session) ctx.user = session.user;
  });
}

function showLogin(message = '') {
  root.innerHTML = '';
  const el = h(`<div class="login"><form class="card" autocomplete="on">
    <div class="logo">Mappingg</div>
    <div><h1 style="font-size:18px">Project Intake — Admin</h1>
      <p class="muted" style="margin:4px 0 0">${cfg.environment ? `${esc(cfg.environment)} environment` : ''}</p></div>
    ${message ? `<p style="color:var(--bad);margin:0">${esc(message)}</p>` : ''}
    <label>Email <input class="input" type="email" name="email" required autocomplete="username"></label>
    <label>Password <input class="input" type="password" name="password" required autocomplete="current-password"></label>
    <button class="btn primary" type="submit">Sign in</button>
    <button class="linkish" type="button" id="forgot">Forgot password?</button>
  </form></div>`);
  const form = $('form', el);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    btn.disabled = true; btn.textContent = 'Signing in…';
    const { data, error } = await ctx.client.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value });
    if (error) { btn.disabled = false; btn.textContent = 'Sign in'; toast(error.message, 'bad'); return; }
    await enter(data.user);
  });
  $('#forgot', el).addEventListener('click', async () => {
    const email = form.email.value.trim();
    if (!email) { toast('Type your email first, then tap Forgot password.', 'bad'); return; }
    const { error } = await ctx.client.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
    toast(error ? error.message : 'Check your email for a reset link.', error ? 'bad' : 'ok');
  });
  root.appendChild(el);
}

function showSetPassword() {
  root.innerHTML = '';
  const el = h(`<div class="login"><form class="card">
    <div class="logo">Mappingg</div><h1 style="font-size:18px">Set a new password</h1>
    <label>New password <input class="input" type="password" name="pw" minlength="8" required autocomplete="new-password"></label>
    <button class="btn primary" type="submit">Save password</button></form></div>`);
  $('form', el).addEventListener('submit', async e => {
    e.preventDefault();
    const { error } = await ctx.client.auth.updateUser({ password: e.target.pw.value });
    if (error) return toast(error.message, 'bad');
    toast('Password updated');
    location.hash = '#/queue';
    const { data } = await ctx.client.auth.getUser();
    await enter(data.user);
  });
  root.appendChild(el);
}

async function enter(user) {
  ctx.user = user;
  const { data: isAdmin, error } = await ctx.client.rpc('is_admin');
  if (error || !isAdmin) {
    await ctx.client.auth.signOut();
    showLogin('This account is not set up as a Mappingg admin. Ask the owner to add you.');
    return;
  }
  drawShell();
  window.addEventListener('hashchange', route);
  route();
}

// Sidebar sections: icon (inline SVG — no icon font to download), name and a
// one-line explanation. `count` maps to refreshCounts()' data-count keys.
const NAV = [
  { key: 'queue', label: 'Review queue', hint: 'Check & approve builder submissions', count: 'review',
    icon: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>' },
  { key: 'builders', label: 'Builders & links', hint: 'Builders and their secure upload links', count: 'builders',
    icon: '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/><path d="M9 10h.01M15 10h.01"/>' },
  { key: 'import', label: 'Bulk upload', hint: 'Import many projects from CSV / Excel', count: '',
    icon: '<path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>' },
  { key: 'live', label: 'Live projects', hint: 'Published projects now on the map', count: 'live',
    icon: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>' },
];
const svg = (paths, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const SIDE_KEY = 'mg_intake_side'; // 'docked' = open; anything else = icon strip

function drawShell() {
  // Inside the super-admin (iframe) the admin header owns the account & sign-out,
  // so no email or sign-out is shown here; standalone keeps a Sign out link only.
  let embedded = false;
  try { embedded = window.self !== window.top; } catch { embedded = true; }
  root.innerHTML = '';
  root.appendChild(h(`<div class="shell">
    <aside class="side" id="side" aria-label="Project intake sections">
      <div class="side-head">
        <span class="side-mark" aria-hidden="true">${svg('<path d="M4 6h16M4 12h16M4 18h10"/>')}</span>
        <div class="side-title"><b>Project Intake</b>${cfg.environment && cfg.environment !== 'production' ? ` <span class="env">${esc(cfg.environment)}</span>` : ''}<small>Mappingg admin</small></div>
      </div>
      <nav class="nav">
        ${NAV.map(n => `<a href="#/${n.key}" data-nav="${n.key}" title="${esc(n.label)}">
          <span class="ni">${svg(n.icon)}${n.count ? `<span class="count" data-count="${n.count}"></span>` : ''}</span>
          <span class="nt"><b>${esc(n.label)}</b><small>${esc(n.hint)}</small></span>
        </a>`).join('')}
      </nav>
      ${embedded ? '' : `<div class="foot"><button class="linkish" id="signout">${svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>')}<span>Sign out</span></button></div>`}
    </aside>
    <main class="main"><div class="page" id="page"></div></main>
  </div>`));
  const so = $('#signout');
  if (so) so.addEventListener('click', async () => { await ctx.client.auth.signOut(); location.hash = ''; });
  setupSide();
}

// Icon strip by default; a small round button on the sidebar's edge opens /
// closes it (no hover). The choice is remembered on this device.
function setupSide() {
  const body = document.body, side = $('#side');
  let open = false;
  try { open = localStorage.getItem(SIDE_KEY) === 'docked'; } catch {}
  const edge = document.createElement('button');
  edge.type = 'button';
  edge.className = 'side-edge';
  edge.setAttribute('aria-controls', 'side');
  side.after(edge);
  const apply = () => {
    body.classList.toggle('side-docked', open);
    body.classList.toggle('side-rail', !open);
    edge.innerHTML = svg(open ? '<path d="M15 18l-6-6 6-6"/>' : '<path d="M9 18l6-6-6-6"/>');
    edge.title = open ? 'Close sidebar' : 'Open sidebar';
    edge.setAttribute('aria-label', edge.title);
    edge.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  apply();
  edge.addEventListener('click', () => {
    open = !open;
    try { localStorage.setItem(SIDE_KEY, open ? 'docked' : 'rail'); } catch {}
    apply();
  });
}

let lastHash = '';
async function route() {
  if (ctx.leaveGuard && location.hash !== lastHash) {
    const ok = await ctx.leaveGuard();
    if (!ok) { history.replaceState(null, '', lastHash || '#/queue'); return; }
  }
  ctx.leaveGuard = null;
  lastHash = location.hash;
  const [path, query] = (location.hash.replace(/^#/, '') || '/queue').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query || '');
  const page = $('#page');
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === (parts[0] === 'review' ? 'queue' : parts[0])));
  page.innerHTML = '<div class="muted pad">Loading…</div>';
  window.scrollTo(0, 0);
  try {
    await refreshCounts(); // keep sidebar numbers fresh on every page change
    switch (parts[0]) {
      case 'review': return await renderReview(page, parts[1]);
      case 'new': {
        const id = await createManualSubmission(params.get('builder'));
        location.replace(`#/review/${id}`);
        return;
      }
      case 'builders': return parts[1] ? await renderBuilderDetail(page, parts[1]) : await renderBuilders(page);
      case 'import': return await renderImport(page);
      case 'live': return await renderLive(page);
      default: return await renderQueue(page, params);
    }
  } catch (e) {
    console.error(e);
    page.innerHTML = `<div class="card pad"><h2>Something went wrong</h2><p class="muted">${esc(friendlyError(e))}</p></div>`;
  }
}

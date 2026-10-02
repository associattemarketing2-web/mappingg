// Shared helpers for the admin panel and builder page.
const cfg = window.MAPPINGG_CONFIG || {};

export function getConfig() { return cfg; }

export function createClient() {
  if (!window.supabase || !window.supabase.createClient) {
    throw new Error('Supabase library failed to load. Check your internet connection.');
  }
  if (!cfg.supabaseUrl || cfg.supabaseUrl.includes('YOUR-')) {
    throw new Error('config.js is not filled in yet. Add the staging Supabase URL and anon key.');
  }
  return window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatMonth(v) {
  const m = /^(\d{4})-(\d{2})$/.exec(v || '');
  return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : (v || '');
}

// Accepts "Dec 2027", "Dec-2027", "12/2027", "2027-12", Excel dates, JS Dates
export function normaliseMonth(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}`;
  if (typeof v === 'number' && v > 20000 && v < 80000) { // Excel serial date
    const d = new Date(Math.round((v - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  let m;
  if ((m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s))) return `${m[1]}-${m[2].padStart(2, '0')}`;
  if ((m = /^(\d{1,2})[\/\-.](\d{4})$/.exec(s))) return `${m[2]}-${m[1].padStart(2, '0')}`;
  if ((m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s))) return `${m[3]}-${m[2].padStart(2, '0')}`;
  if ((m = /^([A-Za-z]{3,9})[\s\-.,']*(\d{2,4})$/.exec(s))) {
    const idx = MONTHS.findIndex(x => x.toLowerCase() === m[1].slice(0, 3).toLowerCase());
    if (idx >= 0) {
      const y = m[2].length === 2 ? `20${m[2]}` : m[2];
      return `${y}-${String(idx + 1).padStart(2, '0')}`;
    }
  }
  return s; // keep as typed; reviewer will fix
}

export function formatDateTime(v) {
  if (!v) return '';
  const d = new Date(v);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatDate(v) {
  if (!v) return '';
  return new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function timeAgo(v) {
  if (!v) return '';
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return formatDate(v);
}

export function formatPrice(sub) {
  if (sub.price_on_request) return 'Price on request';
  const sym = { INR: '₹', AED: 'AED', USD: '$', GBP: '£', EUR: '€' }[sub.currency || 'INR'] || (sub.currency || '');
  const u = { Crore: 'Cr', Lakh: 'L', Million: 'M', Thousand: 'K' }[sub.price_unit] || (sub.price_unit || '');
  const a = sub.price_min, b = sub.price_max;
  if (a == null && b == null) return '—';
  if (a != null && b != null && +a !== +b) return `${sym} ${+a} – ${+b} ${u}`.trim();
  return `${sym} ${+(a ?? b)} ${u}${b == null ? ' onwards' : ''}`.trim();
}

// Pull coordinates out of a Google Maps (or plain "lat, lng") text
export function parseLatLng(text) {
  if (!text) return null;
  let s = String(text);
  try { s = decodeURIComponent(s); } catch { /* keep raw */ }
  const valid = (lat, lng) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  const place = [...s.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)].pop();
  if (place && valid(+place[1], +place[2])) return { lat: +place[1], lng: +place[2] };
  const pats = [
    /[?&](?:q|query|ll|destination|center|daddr)=(-?\d+(?:\.\d+)?),\s*\+?(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/
  ];
  for (const p of pats) {
    const m = s.match(p);
    if (m && valid(+m[1], +m[2])) return { lat: +m[1], lng: +m[2] };
  }
  return null;
}

export function isShortMapsLink(text) {
  return /(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)/i.test(text || '');
}

// Uses the optional Edge Function to open short links like maps.app.goo.gl/…
export async function resolveMapsLink(client, url) {
  const direct = parseLatLng(url);
  if (direct) return direct;
  if (!cfg.mapsResolverFunction || !client) return null;
  try {
    const { data, error } = await client.functions.invoke(cfg.mapsResolverFunction, { body: { url } });
    if (error || !data || data.lat == null) return null;
    return { lat: +data.lat, lng: +data.lng };
  } catch {
    return null;
  }
}

export function safeFileName(name) {
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'file';
  const ext = (dot > 0 ? name.slice(dot + 1) : '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${base}${ext ? '.' + ext : ''}`;
}

export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 8);
}

export function fileNameFromPath(p) {
  if (!p) return '';
  const last = p.split('/').pop();
  return last.replace(/^[a-z0-9]{8}-/, '');
}

export function friendlyError(e) {
  const msg = (e && (e.message || e.error_description || e.msg)) || String(e);
  return msg.replace(/^LINK_INVALID:\s*/, '');
}

let toastTimer;
export function toast(message, tone = 'ok') {
  let el = $('#toast');
  if (!el) {
    el = h('<div id="toast" role="status" aria-live="polite"></div>');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `show ${tone}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, tone === 'bad' ? 6000 : 3200);
}

export function statusBadge(status, STATUS) {
  const s = STATUS[status] || { label: status, tone: 'muted' };
  return `<span class="badge ${s.tone}">${esc(s.label)}</span>`;
}

export function confirmDialog({ title, body = '', confirmText = 'Confirm', tone = 'primary', input = null }) {
  return new Promise(resolve => {
    const dlg = h(`<dialog class="dialog">
      <form method="dialog">
        <h3>${esc(title)}</h3>
        ${body ? `<div class="dialog-body">${body}</div>` : ''}
        ${input ? `<label class="field-label">${esc(input.label)}</label><textarea class="input" rows="3" name="note" placeholder="${esc(input.placeholder || '')}"></textarea>` : ''}
        <div class="dialog-actions">
          <button value="cancel" class="btn ghost" type="submit">Cancel</button>
          <button value="ok" class="btn ${tone}" type="submit">${esc(confirmText)}</button>
        </div>
      </form></dialog>`);
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => {
      const ok = dlg.returnValue === 'ok';
      const note = input ? dlg.querySelector('textarea').value.trim() : null;
      dlg.remove();
      resolve(ok ? (input ? { note } : true) : false);
    });
    dlg.showModal();
  });
}

export function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select();
  document.execCommand('copy'); ta.remove();
  return Promise.resolve();
}

export function linkUrl(token) {
  const base = cfg.submitPageUrl || `${location.origin}/submit/`;
  return `${base}${base.includes('?') ? '&' : '?'}t=${encodeURIComponent(token)}`;
}

export function whatsappUrl(phone, text) {
  const digits = String(phone || '').replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

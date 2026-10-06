// Phone fields for the intake pages: country code (default +91) + exactly 10
// digits, stored as "+91 9876543210". Same rule as lib/phone.ts on the server.
import { COUNTRY_CODES } from './country-codes.js';

export const DEFAULT_CODE = '+91';
const KNOWN = new Set(COUNTRY_CODES.map(([c]) => c));

/** { code, number } from a stored / typed value. */
export function splitPhone(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { code: DEFAULT_CODE, number: '' };
  if (raw.startsWith('+')) {
    const sep = /^\+(\d{1,4})[\s-]+(.*)$/.exec(raw);
    if (sep) return { code: '+' + sep[1], number: sep[2].replace(/\D/g, '') };
    const all = raw.replace(/\D/g, '');
    const byLength = '+' + all.slice(0, Math.max(1, all.length - 10));
    if (all.length > 10 && KNOWN.has(byLength)) return { code: byLength, number: all.slice(byLength.length - 1) };
    for (let len = 4; len >= 1; len--) { const c = '+' + all.slice(0, len); if (KNOWN.has(c)) return { code: c, number: all.slice(len) }; }
    return { code: DEFAULT_CODE, number: all };
  }
  const d = raw.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return { code: '+91', number: d.slice(2) };
  return { code: DEFAULT_CODE, number: d };
}

export const joinPhone = (code, number) => (String(number || '').replace(/\D/g, '') ? `${code || DEFAULT_CODE} ${String(number).replace(/\D/g, '')}` : '');
export const isValidPhone = (value) => { const { number } = splitPhone(value); return !number || /^\d{10}$/.test(number); };

const isoOf = (f) => Array.from(f || '').map((ch) => ch.codePointAt(0) - 0x1F1E6).filter((n) => n >= 0 && n < 26).map((n) => String.fromCharCode(97 + n)).join('');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Markup for a phone field. `name` goes on a hidden input holding the combined
 * value, so plain <form> / FormData code keeps working unchanged.
 */
export function phoneFieldHtml(name, value, { id = '', disabled = false } = {}) {
  const { code, number } = splitPhone(value);
  const opts = COUNTRY_CODES.map(([c, f]) => `<option value="${c}"${c === code ? ' selected' : ''}>${f} ${c}</option>`).join('');
  const iso = isoOf((COUNTRY_CODES.find(([c]) => c === code) || [])[1]);
  const n = number.length;
  const state = !n ? 'is-empty' : n === 10 ? 'is-ok' : 'is-partial';
  return `<span class="phone-in ${state}${disabled ? ' is-disabled' : ''}${iso ? '' : ' no-flag'}" data-phone>
    <span class="phone-cc">${iso ? `<img alt="" width="22" height="16" src="https://flagcdn.com/${iso}.svg" data-iso="${iso}">` : '<img alt="" width="22" height="16">'}<span class="phone-iso">${iso.toUpperCase() || '—'}</span><span class="phone-cc-code">${esc(code)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
    <select aria-label="Country code" ${disabled ? 'disabled' : ''}>${opts}</select></span>
    <input class="input" type="tel" ${id ? `id="${esc(id)}"` : ''} inputmode="numeric" maxlength="10" placeholder="10-digit number" pattern="\\d{10}" title="Enter a 10-digit number" value="${esc(number)}" ${disabled ? 'disabled' : ''}>
    <span class="phone-count" aria-hidden="true">${n === 10 ? '✓' : `${n}/10`}</span>
    <input type="hidden" ${name ? `name="${esc(name)}"` : ''} value="${esc(joinPhone(code, number))}">
  </span>`;
}

/** Wire a rendered phone field: digits only, keep the hidden value in sync, report changes. */
export function wirePhoneField(el, onChange) {
  const sel = el.querySelector('select');
  const inp = el.querySelector('input[type=tel]');
  const hid = el.querySelector('input[type=hidden]');
  const img = el.querySelector('.phone-cc img'), codeEl = el.querySelector('.phone-cc-code');
  const isoEl = el.querySelector('.phone-iso'), cnt = el.querySelector('.phone-count');
  if (img) img.addEventListener('error', () => el.classList.add('no-flag'));
  const sync = () => {
    const d = inp.value.replace(/\D/g, '').slice(0, 10);
    if (d !== inp.value) inp.value = d;
    const v = joinPhone(sel.value, d);
    hid.value = v;
    const iso = isoOf((COUNTRY_CODES.find(([c]) => c === sel.value) || [])[1]);
    if (codeEl) codeEl.textContent = sel.value;
    if (isoEl) isoEl.textContent = iso.toUpperCase() || '—';
    if (img && iso && img.dataset.iso !== iso) { img.dataset.iso = iso; el.classList.remove('no-flag'); img.src = `https://flagcdn.com/${iso}.svg`; }
    if (!iso) el.classList.add('no-flag');
    const n = d.length;
    el.classList.toggle('is-empty', !n);
    el.classList.toggle('is-ok', n === 10);
    el.classList.toggle('is-partial', n > 0 && n < 10);
    if (cnt) cnt.textContent = n === 10 ? '✓' : `${n}/10`;
    if (onChange) onChange(v);
  };
  inp.addEventListener('input', sync);
  sel.addEventListener('change', sync);
  return sync;
}

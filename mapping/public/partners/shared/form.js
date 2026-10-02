// Renders project fields as a form. Used by the builder page and the admin review screen.
import { FIELDS, GROUPS, optionsFor } from './fields.js';
import { esc, h, $, $$, parseLatLng, isShortMapsLink, resolveMapsLink, fileNameFromPath, getConfig, toast } from './lib.js';

/**
 * @param {HTMLElement} root
 * @param {object} opts
 *   values        submission object
 *   audience      'builder' | 'admin'   (admin shows builder + admin fields)
 *   readOnly      boolean
 *   flags         {key: {note}}  shown to the builder as "needs a fix"
 *   flaggable     boolean (admin) — show Flag buttons
 *   previousFlags {key: {note}}  (admin) fields flagged in the last round
 *   upload        async (file, key) => storage path
 *   preview       async (path) => url | null
 *   client        supabase client (for short maps links)
 *   onChange      () => void
 */
export function createForm(root, opts) {
  const state = {
    values: structuredClone(opts.values || {}),
    flags: structuredClone(opts.flags || {}),
    localPreviews: {},
    map: null,
    marker: null
  };
  const fields = FIELDS.filter(f => opts.audience === 'admin' || f.audience === 'builder');
  const groupKeys = [...new Set(fields.map(f => f.group))];

  root.innerHTML = '';
  root.classList.add('pform');
  if (opts.readOnly) root.classList.add('readonly');

  for (const g of groupKeys) {
    const meta = GROUPS[g];
    const sec = h(`<section class="card form-section" data-group="${g}">
      <header class="section-head">
        <h2>${esc(meta.title)}</h2>
        ${opts.audience === 'admin' && meta.audience === 'admin' ? '<span class="pill">Mappingg team only</span>' : ''}
      </header>
      <div class="grid"></div></section>`);
    const grid = $('.grid', sec);
    for (const f of fields.filter(x => x.group === g)) grid.appendChild(renderField(f));
    root.appendChild(sec);
  }

  function changed() { opts.onChange && opts.onChange(); }

  function wrap(f, inner, wide = false) {
    const flag = state.flags[f.key];
    const prev = opts.previousFlags && opts.previousFlags[f.key];
    const req = f.required ? '<span class="req" title="Required">*</span>' : '';
    const el = h(`<div class="field ${wide ? 'wide' : ''} ${flag ? 'flagged' : ''}" data-key="${f.key}">
      <div class="field-top">
        <label class="field-label" for="f_${f.key}">${esc(f.label)} ${req}</label>
        ${opts.flaggable && f.audience === 'builder' ? `<button type="button" class="flag-btn" title="Flag this field for the builder" aria-pressed="${flag ? 'true' : 'false'}">⚑ ${flag ? 'Flagged' : 'Flag'}</button>` : ''}
      </div>
      <div class="field-body"></div>
      ${f.help && !opts.readOnly ? `<p class="help">${esc(f.help)}</p>` : ''}
      <div class="flag-note-wrap"></div>
      ${prev && !flag ? `<p class="prev-flag">Flagged last round: “${esc(prev.note)}” — check the fix</p>` : ''}
    </div>`);
    $('.field-body', el).appendChild(inner);
    renderFlagNote(el, f);
    const btn = $('.flag-btn', el);
    if (btn) btn.addEventListener('click', () => {
      if (state.flags[f.key]) delete state.flags[f.key];
      else state.flags[f.key] = { note: '', at: new Date().toISOString() };
      el.classList.toggle('flagged', !!state.flags[f.key]);
      btn.setAttribute('aria-pressed', state.flags[f.key] ? 'true' : 'false');
      btn.textContent = state.flags[f.key] ? '⚑ Flagged' : '⚑ Flag';
      renderFlagNote(el, f);
      if (state.flags[f.key]) $('.flag-note', el)?.focus();
      changed();
    });
    return el;
  }

  function renderFlagNote(el, f) {
    const box = $('.flag-note-wrap', el);
    box.innerHTML = '';
    const flag = state.flags[f.key];
    if (!flag) return;
    if (opts.flaggable) {
      const inp = h(`<input class="input flag-note" placeholder="What should the builder fix?" value="${esc(flag.note)}">`);
      inp.addEventListener('input', () => { flag.note = inp.value; changed(); });
      box.appendChild(inp);
    } else {
      box.appendChild(h(`<p class="flag-msg"><strong>Please fix:</strong> ${esc(flag.note || 'The Mappingg team flagged this field.')}</p>`));
    }
  }

  function renderField(f) {
    const v = state.values[f.key];
    const dis = opts.readOnly ? 'disabled' : '';
    switch (f.type) {
      case 'text': case 'url': case 'date': case 'month': {
        const type = f.type === 'text' ? 'text' : f.type;
        const inp = h(`<input class="input" id="f_${f.key}" type="${type}" ${dis} value="${esc(v ?? '')}" ${f.type === 'month' ? 'placeholder="YYYY-MM"' : ''} ${f.type === 'url' ? 'placeholder="https://"' : ''}>`);
        inp.addEventListener('input', () => { state.values[f.key] = inp.value; changed(); });
        if (f.key === 'google_maps_link') inp.addEventListener('change', () => fillPinFromLink(inp.value, true));
        return wrap(f, inp, f.type === 'url');
      }
      case 'number': {
        const inp = h(`<input class="input" id="f_${f.key}" type="text" inputmode="decimal" ${dis} value="${esc(v ?? '')}">`);
        inp.addEventListener('input', () => {
          state.values[f.key] = inp.value;
          inp.classList.toggle('invalid', inp.value.trim() !== '' && isNaN(Number(inp.value.replace(/,/g, ''))));
          changed();
        });
        return wrap(f, inp);
      }
      case 'textarea': {
        const inp = h(`<textarea class="input" id="f_${f.key}" rows="${f.maxLines || 3}" ${dis}>${esc(v ?? '')}</textarea>`);
        inp.addEventListener('input', () => { state.values[f.key] = inp.value; changed(); });
        return wrap(f, inp, true);
      }
      case 'select': {
        const opts2 = optionsFor(f);
        const cur = v ?? '';
        const extra = cur && !opts2.includes(cur) ? `<option selected>${esc(cur)}</option>` : '';
        const sel = h(`<select class="input" id="f_${f.key}" ${dis}><option value="">Select…</option>${extra}${opts2.map(o => `<option ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`);
        sel.addEventListener('change', () => { state.values[f.key] = sel.value; changed(); });
        return wrap(f, sel);
      }
      case 'checkbox': {
        const lab = h(`<label class="check"><input type="checkbox" id="f_${f.key}" ${v ? 'checked' : ''} ${dis}><span>Yes</span></label>`);
        $('input', lab).addEventListener('change', e => { state.values[f.key] = e.target.checked; changed(); });
        return wrap(f, lab);
      }
      case 'multiselect': {
        const cur = new Set(v || []);
        const all = [...new Set([...optionsFor(f), ...cur])];
        const box = h(`<div class="chips" id="f_${f.key}" role="group"></div>`);
        for (const o of all) {
          const c = h(`<button type="button" class="chip ${cur.has(o) ? 'on' : ''}" aria-pressed="${cur.has(o)}" ${dis}>${esc(o)}</button>`);
          c.addEventListener('click', () => {
            const set = new Set(state.values[f.key] || []);
            set.has(o) ? set.delete(o) : set.add(o);
            state.values[f.key] = all.filter(x => set.has(x));
            c.classList.toggle('on'); c.setAttribute('aria-pressed', set.has(o));
            changed();
          });
          box.appendChild(c);
        }
        return wrap(f, box, true);
      }
      case 'tags': {
        const box = h(`<div class="tags"><div class="tag-list"></div>${opts.readOnly ? '' : `<div class="tag-add"><input class="input" id="f_${f.key}" placeholder="e.g. P52100012345"><button type="button" class="btn ghost sm">Add</button></div>`}</div>`);
        const list = $('.tag-list', box);
        const draw = () => {
          list.innerHTML = '';
          (state.values[f.key] || []).forEach((t, i) => {
            const chip = h(`<span class="tag">${esc(t)}${opts.readOnly ? '' : '<button type="button" aria-label="Remove">×</button>'}</span>`);
            $('button', chip)?.addEventListener('click', () => { state.values[f.key].splice(i, 1); draw(); changed(); });
            list.appendChild(chip);
          });
          if (!(state.values[f.key] || []).length && opts.readOnly) list.innerHTML = '<span class="muted">—</span>';
        };
        const inp = $('input', box);
        const add = () => {
          const parts = inp.value.split(/[,;\n]/).map(x => x.trim().toUpperCase()).filter(Boolean);
          if (!parts.length) return;
          state.values[f.key] = [...new Set([...(state.values[f.key] || []), ...parts])];
          inp.value = ''; draw(); changed();
        };
        if (inp) {
          $('button', box.querySelector('.tag-add')).addEventListener('click', add);
          inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
          inp.addEventListener('blur', add);
        }
        draw();
        return wrap(f, box, true);
      }
      case 'pin': return wrap(f, renderPin(), true);
      case 'file': case 'files': return wrap(f, renderFiles(f), true);
      case 'kv': {
        const box = h(`<div class="kv"><div class="kv-rows"></div>${opts.readOnly ? '' : '<button type="button" class="btn ghost sm">+ Add a detail</button>'}</div>`);
        const rows = $('.kv-rows', box);
        if (!Array.isArray(state.values[f.key])) state.values[f.key] = [];
        const draw = () => {
          rows.innerHTML = '';
          state.values[f.key].forEach((r, i) => {
            const row = h(`<div class="kv-row">
              <input class="input" placeholder="Label, e.g. Clubhouse size" value="${esc(r.label)}" ${dis}>
              <input class="input" placeholder="Value, e.g. 30,000 sq ft" value="${esc(r.value)}" ${dis}>
              ${opts.readOnly ? '' : '<button type="button" class="icon-btn" aria-label="Remove">×</button>'}</div>`);
            const [a, b] = $$('input', row);
            a.addEventListener('input', () => { r.label = a.value; changed(); });
            b.addEventListener('input', () => { r.value = b.value; changed(); });
            $('button', row)?.addEventListener('click', () => { state.values[f.key].splice(i, 1); draw(); changed(); });
            rows.appendChild(row);
          });
          if (!state.values[f.key].length && opts.readOnly) rows.innerHTML = '<span class="muted">—</span>';
        };
        $(':scope > button', box)?.addEventListener('click', () => { state.values[f.key].push({ label: '', value: '' }); draw(); changed(); });
        draw();
        return wrap(f, box, true);
      }
      default:
        return wrap(f, h('<span class="muted">Unsupported field</span>'));
    }
  }

  // ---------- Map pin ----------
  function renderPin() {
    const v = state.values;
    const box = h(`<div class="pin">
      <div class="pin-row">
        <label>Latitude <input class="input" data-pin="lat" inputmode="decimal" value="${esc(v.lat ?? '')}" ${opts.readOnly ? 'disabled' : ''}></label>
        <label>Longitude <input class="input" data-pin="lng" inputmode="decimal" value="${esc(v.lng ?? '')}" ${opts.readOnly ? 'disabled' : ''}></label>
        ${opts.readOnly ? '' : '<button type="button" class="btn ghost sm" data-pin="read">Read pin from Maps link</button>'}
        ${v.lat != null && v.lng != null ? `<a class="btn ghost sm" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${v.lat},${v.lng}">Open in Google Maps ↗</a>` : ''}
      </div>
      <p class="pin-status muted"></p>
      <div class="pin-map" aria-label="Map. Tap to place the project pin."></div>
    </div>`);
    const lat = $('[data-pin=lat]', box), lng = $('[data-pin=lng]', box);
    const upd = () => {
      const a = parseFloat(lat.value), b = parseFloat(lng.value);
      state.values.lat = isNaN(a) ? null : a;
      state.values.lng = isNaN(b) ? null : b;
      placeMarker(); changed();
    };
    lat.addEventListener('change', upd); lng.addEventListener('change', upd);
    $('[data-pin=read]', box)?.addEventListener('click', () => fillPinFromLink(state.values.google_maps_link, false));
    // Map is created once visible (Leaflet needs a sized container)
    requestAnimationFrame(() => initMap($('.pin-map', box)));
    return box;
  }

  function initMap(el) {
    if (!window.L || !el) { if (el) el.innerHTML = '<p class="muted pad">Map could not load. Type the latitude and longitude instead.</p>'; return; }
    const c = getConfig();
    const has = state.values.lat != null && state.values.lng != null;
    const map = window.L.map(el, { scrollWheelZoom: false }).setView(
      has ? [state.values.lat, state.values.lng] : (c.defaultMapCenter || [20.59, 78.96]),
      has ? 15 : (c.defaultMapZoom || 5)
    );
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    state.map = map;
    if (!opts.readOnly) {
      map.on('click', e => setPin(e.latlng.lat, e.latlng.lng, 'Pin placed on the map.'));
    }
    placeMarker();
    setTimeout(() => map.invalidateSize(), 200);
  }

  function placeMarker() {
    if (!state.map || !window.L) return;
    const { lat, lng } = state.values;
    if (lat == null || lng == null) { if (state.marker) { state.marker.remove(); state.marker = null; } return; }
    if (!state.marker) {
      state.marker = window.L.marker([lat, lng], { draggable: !opts.readOnly }).addTo(state.map);
      state.marker.on('dragend', () => { const p = state.marker.getLatLng(); setPin(p.lat, p.lng, 'Pin moved.'); });
    } else state.marker.setLatLng([lat, lng]);
    state.map.setView([lat, lng], Math.max(state.map.getZoom(), 15));
  }

  function setPin(lat, lng, msg) {
    state.values.lat = +(+lat).toFixed(6);
    state.values.lng = +(+lng).toFixed(6);
    const box = $('.pin', root);
    if (box) {
      $('[data-pin=lat]', box).value = state.values.lat;
      $('[data-pin=lng]', box).value = state.values.lng;
      $('.pin-status', box).textContent = msg || '';
    }
    placeMarker(); changed();
  }

  async function fillPinFromLink(url, quiet) {
    const status = $('.pin-status', root);
    if (!url) { if (!quiet && status) status.textContent = 'Paste a Google Maps link first.'; return; }
    const direct = parseLatLng(url);
    if (direct) return setPin(direct.lat, direct.lng, 'Pin read from the Google Maps link. Check it on the map.');
    if (status) status.textContent = 'Reading the link…';
    const r = isShortMapsLink(url) ? await resolveMapsLink(opts.client, url) : null;
    if (r) return setPin(r.lat, r.lng, 'Pin read from the Google Maps link. Check it on the map.');
    if (status) status.textContent = 'We could not read a pin from this link. Please tap the map to place it — or leave it, our team will set it.';
  }

  // ---------- Files ----------
  function renderFiles(f) {
    const multi = f.type === 'files';
    const box = h(`<div class="files">
      <div class="file-list"></div>
      ${opts.readOnly ? '' : `<label class="btn ghost sm file-pick">
        <input type="file" accept="${f.accept}" ${multi ? 'multiple' : ''} hidden>
        ${multi ? '+ Add images' : 'Choose file'}</label>`}
      <span class="file-progress muted"></span>
    </div>`);
    const list = $('.file-list', box);
    const paths = () => multi ? (state.values[f.key] || []) : (state.values[f.key] ? [state.values[f.key]] : []);
    const draw = () => {
      list.innerHTML = '';
      const ps = paths();
      if (!ps.length) list.appendChild(h(`<span class="muted">${opts.readOnly ? '—' : 'No file yet'}</span>`));
      ps.forEach(p => {
        const isPdf = /\.pdf$/i.test(p);
        const item = h(`<div class="file-item" title="${esc(fileNameFromPath(p))}">
          <div class="thumb">${isPdf ? '<span class="pdf">PDF</span>' : '<span class="muted">…</span>'}</div>
          <span class="fname">${esc(fileNameFromPath(p))}</span>
          ${opts.readOnly ? '' : '<button type="button" class="icon-btn" aria-label="Remove file">×</button>'}
        </div>`);
        $('button', item)?.addEventListener('click', () => {
          if (multi) state.values[f.key] = paths().filter(x => x !== p); else state.values[f.key] = null;
          draw(); changed();
        });
        list.appendChild(item);
        showPreview(item, p, isPdf);
      });
    };
    const input = $('input[type=file]', box);
    input?.addEventListener('change', async () => {
      const files = Array.from(input.files || []);
      input.value = '';
      if (!files.length) return;
      if (multi && paths().length + files.length > (f.max || 10)) { toast(`You can add up to ${f.max || 10} images.`, 'bad'); return; }
      const prog = $('.file-progress', box);
      for (const [i, file] of files.entries()) {
        if (file.size > 25 * 1024 * 1024) { toast(`${file.name} is larger than 25 MB.`, 'bad'); continue; }
        prog.textContent = `Uploading ${i + 1} of ${files.length}…`;
        try {
          const path = await opts.upload(file, f.key);
          state.localPreviews[path] = URL.createObjectURL(file);
          if (multi) state.values[f.key] = [...paths(), path]; else state.values[f.key] = path;
          draw(); changed();
        } catch (e) {
          toast(`Upload failed: ${e.message || e}`, 'bad');
        }
      }
      prog.textContent = '';
    });
    draw();
    return box;
  }

  async function showPreview(item, path, isPdf) {
    let url = state.localPreviews[path];
    if (!url && opts.preview) url = await opts.preview(path);
    const thumb = $('.thumb', item);
    if (!url) { if (!isPdf) thumb.innerHTML = '<span class="ok-tick">✓</span>'; return; }
    if (isPdf) thumb.innerHTML = `<a href="${esc(url)}" target="_blank" rel="noopener" class="pdf">PDF</a>`;
    else thumb.innerHTML = `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="" loading="lazy"></a>`;
  }

  // ---------- Output ----------
  function getValues() {
    const out = {};
    for (const f of fields) {
      if (f.type === 'pin') { out.lat = state.values.lat ?? null; out.lng = state.values.lng ?? null; continue; }
      let v = state.values[f.key];
      if (f.type === 'number') {
        const t = String(v ?? '').replace(/,/g, '').trim();
        v = t === '' ? null : (isNaN(Number(t)) ? t : Number(t));
      } else if (['multiselect', 'tags', 'files'].includes(f.type)) v = Array.isArray(v) ? v : [];
      else if (f.type === 'kv') v = (Array.isArray(v) ? v : []).filter(r => (r.label || '').trim() || (r.value || '').trim());
      else if (f.type === 'checkbox') v = !!v;
      else if (typeof v === 'string') v = v.trim() === '' ? null : v.trim();
      else if (v === undefined) v = null;
      out[f.key] = v;
    }
    return out;
  }

  function getFlags() {
    const out = {};
    for (const [k, v] of Object.entries(state.flags)) out[k] = { note: (v.note || '').trim(), at: v.at || new Date().toISOString() };
    return out;
  }

  function invalidNumbers() {
    return fields.filter(f => f.type === 'number').filter(f => {
      const t = String(state.values[f.key] ?? '').replace(/,/g, '').trim();
      return t !== '' && isNaN(Number(t));
    }).map(f => f.label);
  }

  function focusField(key) {
    const el = $(`.field[data-key="${key}"]`, root);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('input,select,textarea', el)?.focus({ preventScroll: true }); }
  }

  // Set a simple (text/date/select/checkbox) field from outside the form
  function setValue(key, v) {
    state.values[key] = v;
    const el = $(`#f_${key}`, root);
    if (el) { if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? ''; }
    changed();
  }

  return { getValues, getFlags, invalidNumbers, focusField, setValue, state };
}

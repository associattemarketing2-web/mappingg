// Parsers for official RERA registry pages (used by the research and apply scripts).
// Pages are stored as "cells": the text of each table cell, one per line.

/** HTML → trimmed text cells (the page is a deep table layout; cells are the useful unit). */
export function cells(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '|')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#039;|&#39;/g, "'").replace(/&quot;/g, '"')
    .split('|').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// ---- RERA Karnataka -----------------------------------------------------------------------
const num = (s) => (s == null || s === '' || isNaN(Number(String(s).replace(/,/g, ''))) ? null : Number(String(s).replace(/,/g, '')));
const ddmmyyyy = (s) => { const m = String(s || '').match(/^(\d{2})-(\d{2})-(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

// The detail page comes in two layouts (registrations before ~2020, and later). Both are
// "label | : | value" cells, so the parser reads label/value pairs; a value that is itself
// followed by ":" is the next label, i.e. the field is blank.
const GENERIC_DESC = /^(construction (&|and) development activities|residential|apartments?|na|nil|-)$/i;
const inKarnataka = (lat, lng) => lat != null && lng != null && lat > 11.5 && lat < 18.5 && lng > 74 && lng < 78.6;

export function parseKa(t) {
  const regNo = t[t.indexOf('Registration Number :') + 1] || null;
  const projName = t[t.indexOf('Project Name :') + 1] || null;
  const P = t.indexOf('Registration/Extensions');
  if (P < 0) return { ok: false, reason: 'project section not found', reg_no: regNo };
  const kv = [];
  for (let i = 0; i < t.length - 1; i++) if (t[i + 1] === ':' && t[i] !== ':') kv.push([i, t[i], t[i + 3] === ':' || t[i + 2] === ':' ? null : t[i + 2] ?? null]);
  const get = (labels, from = P, to = Infinity) => {
    for (const [i, k, v] of kv) if (i > from && i < to && labels.includes(k)) return v;
    return null;
  };
  const n = (labels) => num(String(get(labels) ?? '').replace(/\s*sq\.?\s*mtrs?\.?$/i, ''));
  // Promoter: new layout "Promoter Name", old layout "Name" in the Promoter block.
  const promoter_name = get(['Promoter Name'], 0, P) ?? get(['Name'], t.indexOf('Promoter'), P);
  const web = get(['Promoter Website'], 0, P);
  const desc = get(['Project Description']);
  const lat = num(get(['Latitude'])), lng = num(get(['Longitude']));
  const r = {
    ok: true,
    reg_no: regNo,
    registry_project_name: projName,
    promoter_name,
    promoter_website: web && /^(https?:\/\/|www\.)\S+\.\S+/i.test(web) ? web : null,
    project_description: desc && desc.length >= 15 && !GENERIC_DESC.test(desc.trim()) ? desc : null,
    project_type: get(['Project Type']),
    project_sub_type: get(['Project Sub Type']),
    project_status: get(['Project Status']),
    start_date: ddmmyyyy(get(['Project Start Date'])),
    proposed_completion: ddmmyyyy(get(['Proposed Completion Date', 'Proposed Project Completion Date'])),
    address: get(['Project Address']),
    taluk: get(['Taluk']),
    pincode: (get(['Pin Code']) || '').match(/^5\d{5}$/)?.[0] || null,
    latitude: inKarnataka(lat, lng) ? lat : null,
    longitude: inKarnataka(lat, lng) ? lng : null,
    approving_authority: get(['Approving Authority']),
    approved_plan_number: get(['Approved Plan Number']),
    plan_approval_date: ddmmyyyy(get(['Plan Approval Date'])),
    total_units: n(['Total Number of Inventories/Flats/Villas']),
    total_plots: null,
    land_area_sqm: n(['Total Area Of Land (Sq Mtr) (A1+A2)', 'Total Area Of Land (Sq Mtr)']),
    total_carpet_sqm: n(['Total Carpet Area of all the Floors (Sq Mtr)']),
    total_builtup_sqm: n(['Total Built-up Area of all the Floors (Sq Mtr)']),
    project_cost_inr: n(['Total Project Cost (INR) (C1+C2)', 'Total Project Cost (INR)']),
    water_source: (get(['Source of Water']) || '').replace(/,\s*$/, '') || null,
    towers: n(['Number of Towers']),
    unit_mix: [], plot_sizes: [], amenities: [],
  };
  if (r.address && r.address.length < 8) r.address = null;
  const sites = t.indexOf('Total Number of Sites/Plots', P);
  if (sites > 0) r.total_plots = num(t[sites + 1]);
  if (r.land_area_sqm == null) { const i = t.indexOf('Total Area Land', P); if (i > 0) r.land_area_sqm = num(t[i + 2]); }

  // Unit mix. New layout: a table "Sl | Type of Inventory | No. | Carpet Area | balcony | terrace" until TOTAL.
  // Old layout: repeated "Type of Inventory : X | No of Inventory : N | Carpet Area (Sq Mtr) : A".
  const um = t.indexOf('Type of Inventory', P);
  if (um > 0 && t[um + 1] !== ':') {
    const end = t.indexOf('TOTAL', um);
    for (let i = um; i < (end > 0 ? end : um + 200); i++) {
      if (/^\d+$/.test(t[i]) && /[A-Za-z]/.test(t[i + 1] || '') && /^\d+$/.test(t[i + 2] || '')) {
        r.unit_mix.push({ type: t[i + 1], count: num(t[i + 2]), carpet_sqm: num(t[i + 3]) });
        i += 3;
      }
    }
  } else if (um > 0) {
    for (const [i, k, v] of kv) {
      if (i < P || k !== 'Type of Inventory' || !v) continue;
      const count = num(get(['No of Inventory'], i, i + 12));
      const carpet = num(String(get(['Carpet Area (Sq Mtr)'], i, i + 16) || '').replace(/sq\.?\s*mtrs?\.?/i, '').trim());
      if (count) r.unit_mix.push({ type: v, count, carpet_sqm: carpet });
    }
  }
  // carpet_sqm is the total for the type; plot dimension rows ("15.24x9.14") belong to plot_sizes.
  r.unit_mix = r.unit_mix
    .filter((u) => u.type !== 'TOTAL' && !/^\d+(\.\d+)?\s*x\s*\d/i.test(u.type))
    .map((u) => ({ ...u, avg_carpet_sqm: u.carpet_sqm && u.count ? Math.round((u.carpet_sqm / u.count) * 10) / 10 : null }));
  // Plot sizes (plotted developments): "Plot Type (Site Dimension in Mtr) | Number of Sites | Total Area".
  const ps = t.indexOf('Total Area (in Sq.Mtr)', P);
  if (ps > 0) {
    const end = t.indexOf('TOTAL', ps);
    for (let i = ps + 1; i < (end > 0 ? end : ps + 200); i++) {
      if (/^\d+$/.test(t[i]) && /x/i.test(t[i + 1] || '') && /^\d+$/.test(t[i + 2] || '')) {
        const count = num(t[i + 2]), area = num(t[i + 3]);
        if (count && area) r.plot_sizes.push({ dimension: t[i + 1], count, area_sqm: Math.round((area / count) * 10) / 10 });
        i += 3;
      }
    }
  }
  // Amenities: the first "Amenities" table in the project section; keep the ones marked "Yes".
  const am = t.indexOf('Amenities', P);
  if (am > 0) {
    const end = t.indexOf('Common Areas', am);
    const seg = t.slice(am, end > 0 ? end : am + 120);
    for (let i = 0; i < seg.length - 2; i++) {
      if (/^\d+$/.test(seg[i]) && seg[i + 2] === 'Yes' && !/^(Electricity|Water and Sanitation)$/.test(seg[i + 1])) r.amenities.push(seg[i + 1]);
    }
    r.amenities = [...new Set(r.amenities)];
  }
  return r;
}

// ---- HARERA Gurugram ----------------------------------------------------------------------
// Two pages per project: the public detail page (searchprojectDetail/<id>) and the promoter's
// registration application, Form REP-I Parts A–H (project_preview_open/<id>). Only Parts A–C
// describe THIS project; Part G lists the promoter's earlier projects and is never read.
const isAnnex = (s) => /^\(Annex/i.test(s || '');
const lakhs = (s) => { const m = String(s || '').match(/^([\d.]+)\s*Lakhs?$/i); return m ? Math.round(Number(m[1]) * 100000) : null; };

export function parseHr(detail, form) {
  const r = { ok: false };
  // Detail page: five labels then five values.
  const d = detail.indexOf('Project Name');
  if (d >= 0 && detail[d + 3] === 'Project Tehsil') {
    r.registry_project_name = detail[d + 5] || null;
    r.address = detail[d + 6] || null;
    r.tehsil = detail[d + 8] || null;
    r.promoter_name = detail[d + 9] || null;
  }
  const st = detail.indexOf('Details of Project(Form A-H)');
  if (st >= 0) {
    // Older registrations show a "View Certificate" link before the number ("353 OF 2017 DATED …").
    const cell = detail.slice(st + 1, st + 4).find((x) => x !== 'View Certificate') || '';
    r.reg_no = cell.replace(/\s+DATED.*$/i, '').trim() || null;
    r.registry_status = detail.slice(st + 1, st + 8).find((x) => /APPROVED|REJECT|LAPSE|REVOK|WITHDRAW|CERTIFICATE|PENDING/i.test(x)) || null;
  }
  if (!form || !form.length) return { ...r, ok: !!r.registry_project_name, form: false };

  const end = form.indexOf('Part - D');
  const t = end > 0 ? form.slice(0, end) : form;
  const next = (label, skipAnnex = true) => {
    const i = t.findIndex((x) => x === label || x.startsWith(label));
    if (i < 0) return null;
    let j = i + 1;
    while (skipAnnex && isAnnex(t[j])) j++;
    return t[j] ?? null;
  };
  const web = next('Website', false);
  r.promoter_website = web && /^(https?:\/\/|www\.)\S+\.\S+/i.test(web) ? web : null;
  r.form_project_name = next('1. Name of the project');
  r.form_address = next('2. Address of the site of the project');
  const land = next('1. Land area of the project');
  r.land_area_acres = land && /Acre/i.test(land) ? num(land.replace(/\(?Acres?\)?/i, '').trim()) : null;
  r.license = next('5. License number granted');
  r.project_cost_inr = lakhs(next('1. Estimated cost of the project'));
  r.land_area_sqm = num(next('2. The total land of the project measuring'));
  r.layout_plan_approval_date = ddmmyyyy(next('5. (a) Date of approval of latest layout plans'));
  r.building_plan_approval_date = ddmmyyyy(next('6. Date of approval of Building Plans'));
  r.start_date = ddmmyyyy(next('i) Likely date of starting the construction work'));
  r.proposed_completion = ddmmyyyy(next('ii) Likely date of completing the project'));
  // Plots: "Plot Area (sq m) | Number of plots" rows until "Total".
  r.plot_sizes = [];
  const pi = t.indexOf('Number of plots in the project');
  if (pi > 0) {
    for (let i = pi + 1; i < t.length - 2 && t[i] !== 'Total'; i += 3) {
      if (!/^\d+$/.test(t[i])) break;
      const area = num(t[i + 1]), count = num(t[i + 2]);
      if (area && count) r.plot_sizes.push({ area_sqm: area, count });
    }
  }
  // Apartments: "Type | Carpet area (sq m) | Number of apartments | Number of towers".
  r.unit_mix = [];
  const ai = t.indexOf('Number of towers');
  if (ai > 0) {
    for (let i = ai + 1; i < t.length - 3; i += 4) {
      const carpet = num(t[i + 1]), count = num(t[i + 2]);
      if (!t[i] || /^\(|^\d/.test(t[i]) || carpet == null || count == null) break;
      if (carpet > 0 && count > 0) r.unit_mix.push({ type: t[i], carpet_sqm: carpet, count, towers: num(t[i + 3]) });
    }
  }
  r.form = true;
  r.ok = !!(r.registry_project_name || r.form_project_name);
  return r;
}


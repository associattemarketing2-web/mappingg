'use client';

import { useState } from 'react';

// Shared by the channel partner's "My land" page and the super admin's Land tab.

export const LAND_TYPES = ['Agricultural', 'NA (Non-agricultural)', 'Residential', 'Commercial', 'Industrial', 'Mixed use'];
export const AREA_UNITS = ['acre', 'guntha', 'hectare', 'sq ft', 'sq m'];
export const DEAL_TYPES = ['Outright sale', 'Joint development (JD)', 'Joint venture (JV)', 'Lease'];
export const TITLE_STATUS = ['Clear title', 'Under process', 'Not known'];

export interface LandRow {
  id: string; title: string; location: string; city: string; land_type: string; area: string; area_unit: string;
  price: string; deal_type: string; survey_no: string; title_status: string; zone: string; road_access: string;
  maps_link: string; lat: number | null; lng: number | null; description: string;
  status: 'pending' | 'approved' | 'rejected'; review_note?: string; reviewed_at?: string; reviewed_by?: string;
  cp_id?: string; cp_name: string; cp_email?: string; cp_mobile: string; cp_agency: string;
  created_at: string; updated_at: string;
}

export type LandFields = Pick<LandRow, 'title' | 'location' | 'city' | 'land_type' | 'area' | 'area_unit' | 'price' | 'deal_type'
  | 'survey_no' | 'title_status' | 'zone' | 'road_access' | 'maps_link' | 'description'>;

export const EMPTY_LAND: LandFields = {
  title: '', location: '', city: '', land_type: '', area: '', area_unit: 'acre', price: '', deal_type: '',
  survey_no: '', title_status: '', zone: '', road_access: '', maps_link: '', description: '',
};

export const fieldsOf = (l: LandRow): LandFields => ({
  title: l.title || '', location: l.location || '', city: l.city || '', land_type: l.land_type || '', area: l.area || '',
  area_unit: l.area_unit || 'acre', price: l.price || '', deal_type: l.deal_type || '', survey_no: l.survey_no || '',
  title_status: l.title_status || '', zone: l.zone || '', road_access: l.road_access || '', maps_link: l.maps_link || '',
  description: l.description || '',
});

export const areaText = (l: Pick<LandRow, 'area' | 'area_unit'>) => (l.area ? `${l.area} ${l.area_unit || ''}`.trim() : '');
export const landDate = (d?: string) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const mapsHref = (l: Pick<LandRow, 'maps_link' | 'lat' | 'lng'>) =>
  l.maps_link && /^https?:\/\//i.test(l.maps_link) ? l.maps_link
    : l.lat != null && l.lng != null ? `https://www.google.com/maps?q=${l.lat},${l.lng}` : '';

export function LandStatusPill({ status }: { status: LandRow['status'] }) {
  const m = {
    pending: ['new', 'fa-hourglass-half', 'Waiting approval'],
    approved: ['won', 'fa-circle-check', 'Approved'],
    rejected: ['lost', 'fa-circle-xmark', 'Not approved'],
  }[status] || ['new', 'fa-circle', status];
  return <span className={`crm-pill ${m[0]}`}><i className={`fas ${m[1]}`} /> {m[2]}</span>;
}

export default function LandForm({ initial, saving, submitLabel, note, onSubmit, onCancel }: {
  initial?: LandFields;
  saving: boolean;
  submitLabel: string;
  note?: string;
  onSubmit: (f: LandFields) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<LandFields>(initial || EMPTY_LAND);
  const set = (k: keyof LandFields) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const sel = (k: keyof LandFields, opts: string[], placeholder: string) => (
    <select value={f[k]} onChange={set(k)}>
      <option value="">{placeholder}</option>
      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      {f[k] && !opts.includes(f[k]) && <option value={f[k]}>{f[k]}</option>}
    </select>
  );
  const ok = f.title.trim().length >= 3 && f.location.trim().length >= 2;

  return (
    <form className="land-form" onSubmit={(e) => { e.preventDefault(); if (ok && !saving) onSubmit(f); }}>
      <div className="adm-field"><label>Title *</label><input value={f.title} onChange={set('title')} maxLength={160} placeholder="e.g. 5 acre NA plot near Hinjewadi Phase 3" /></div>
      <div className="adm-grid2">
        <div className="adm-field"><label>Location / village *</label><input value={f.location} onChange={set('location')} maxLength={200} placeholder="e.g. Maan, Hinjewadi" /></div>
        <div className="adm-field"><label>City</label><input value={f.city} onChange={set('city')} maxLength={80} placeholder="e.g. Pune" /></div>
      </div>
      <div className="adm-grid2">
        <div className="adm-field"><label>Land type</label>{sel('land_type', LAND_TYPES, 'Choose…')}</div>
        <div className="adm-field"><label>Deal type</label>{sel('deal_type', DEAL_TYPES, 'Choose…')}</div>
      </div>
      <div className="adm-grid2">
        <div className="adm-field">
          <label>Area</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={f.area} onChange={set('area')} maxLength={40} placeholder="e.g. 5" style={{ flex: 1, minWidth: 0 }} />
            <select value={f.area_unit} onChange={set('area_unit')} style={{ width: 120 }}>
              {AREA_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <div className="adm-field"><label>Price / expectation</label><input value={f.price} onChange={set('price')} maxLength={80} placeholder="e.g. ₹4.5 Cr total or ₹90 L per acre" /></div>
      </div>
      <div className="adm-grid2">
        <div className="adm-field"><label>Survey / Gat no. <small>(7/12)</small></label><input value={f.survey_no} onChange={set('survey_no')} maxLength={120} placeholder="e.g. Gat no. 123/2" /></div>
        <div className="adm-field"><label>Title status</label>{sel('title_status', TITLE_STATUS, 'Choose…')}</div>
      </div>
      <div className="adm-grid2">
        <div className="adm-field"><label>Zone <small>(DP / RP)</small></label><input value={f.zone} onChange={set('zone')} maxLength={120} placeholder="e.g. Residential zone, R-zone" /></div>
        <div className="adm-field"><label>Road access / frontage</label><input value={f.road_access} onChange={set('road_access')} maxLength={200} placeholder="e.g. 60 ft road, 200 ft frontage" /></div>
      </div>
      <div className="adm-field"><label>Google Maps link</label><input value={f.maps_link} onChange={set('maps_link')} maxLength={600} placeholder="Paste the location link or lat, lng" /></div>
      <div className="adm-field"><label>Description</label><textarea value={f.description} onChange={set('description')} maxLength={3000} rows={4} placeholder="Anything a developer should know — water, electricity, nearby projects, owner details…" /></div>
      {note && <p className="adm-note"><i className="fas fa-circle-info" /><span>{note}</span></p>}
      <div className="adm-actions" style={{ marginTop: 12 }}>
        <button type="submit" className="adm-btn primary" disabled={!ok || saving}><i className="fas fa-floppy-disk" /> {saving ? 'Saving…' : submitLabel}</button>
        <button type="button" className="adm-btn ghost" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}

/** One land listing's details as label/value rows. */
export function LandDetails({ l, showContact }: { l: LandRow; showContact?: boolean }) {
  const rows: [string, string][] = [
    ['Location', [l.location, l.city].filter(Boolean).join(', ')],
    ['Land type', l.land_type], ['Area', areaText(l)], ['Price', l.price], ['Deal type', l.deal_type],
    ['Survey / Gat no.', l.survey_no], ['Title', l.title_status], ['Zone', l.zone], ['Road access', l.road_access],
    ...(showContact ? [['Channel partner', [l.cp_name, l.cp_agency].filter(Boolean).join(' · ')], ['Partner mobile', l.cp_mobile]] as [string, string][] : []),
  ];
  const href = mapsHref(l);
  return (
    <div className="land-details">
      <dl>
        {rows.filter(([, v]) => v).map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
      </dl>
      {l.description && <p className="land-desc">{l.description}</p>}
      {href && <a className="adm-btn ghost sm" href={href} target="_blank" rel="noopener"><i className="fas fa-location-dot" /> Open in Google Maps</a>}
    </div>
  );
}

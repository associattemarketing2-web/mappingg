'use client';

import { useEffect, useState } from 'react';
import { LandDetails, areaText, landDate, type LandRow } from '@/components/lands/LandForm';
import { LAND_TYPES } from '@/components/lands/LandForm';

// Developer panel → Land: every land listing channel partners added that the
// Mappingg team approved, with the partner's name and number.

const waLink = (m: string) => { const d = m.replace(/\D/g, ''); return d ? `https://wa.me/${d.length === 10 ? `91${d}` : d}` : ''; };

export default function DeveloperLands() {
  const [rows, setRows] = useState<LandRow[] | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/my/lands', { credentials: 'same-origin' })
      .then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b?.error?.message || 'Could not load land'); return b; })
      .then((b) => setRows(Array.isArray(b.data) ? b.data : []))
      .catch((e) => { setRows([]); setErr(e instanceof Error ? e.message : 'Could not load land'); });
  }, []);

  const t = q.trim().toLowerCase();
  const shown = (rows || []).filter((l) =>
    (!type || l.land_type === type)
    && (!t || [l.title, l.location, l.city, l.deal_type, l.zone, l.cp_name, l.cp_agency].some((v) => v && v.toLowerCase().includes(t))));

  return (
    <div className="adm-panel">
      <div className="adm-panel-head">
        <h3><i className="fas fa-mountain-sun" /> Land {rows ? <span className="muted">({rows.length})</span> : null}</h3>
      </div>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>Land parcels listed by channel partners and checked by the Mappingg team. Contact the partner directly for details or a site visit.</p>
      <div className="land-tools">
        <input className="crm-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search location, title, partner…" aria-label="Search land" />
        <select className="crm-select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Land type">
          <option value="">All land types</option>
          {LAND_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>
      {err && <p className="adm-note" role="alert"><i className="fas fa-triangle-exclamation" /><span>{err}</span></p>}
      {rows === null ? <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading…</p></div>
        : !shown.length ? <div className="adm-empty"><i className="fas fa-mountain-sun" /><p>{rows.length ? 'No land matches your search.' : 'No land listed yet. Approved listings from channel partners will appear here.'}</p></div>
          : (
            <ul className="land-list">
              {shown.map((l) => {
                const wa = waLink(l.cp_mobile || '');
                return (
                  <li key={l.id} className="land-item">
                    <button type="button" className="land-sum" aria-expanded={open === l.id} onClick={() => setOpen(open === l.id ? null : l.id)}>
                      <span className="land-t">
                        <b>{l.title}</b>
                        <small>{[[l.location, l.city].filter(Boolean).join(', '), l.land_type, areaText(l), l.price].filter(Boolean).join(' · ')}</small>
                      </span>
                      <span className="land-when">{landDate(l.reviewed_at || l.created_at)}</span>
                      <i className={`fas fa-chevron-${open === l.id ? 'up' : 'down'}`} />
                    </button>
                    {open === l.id && (
                      <div className="land-body">
                        <LandDetails l={l} showContact />
                        <div className="adm-actions" style={{ marginTop: 10 }}>
                          {l.cp_mobile && <a className="adm-btn ghost sm" href={`tel:${l.cp_mobile.replace(/[^\d+]/g, '')}`}><i className="fas fa-phone" /> Call partner</a>}
                          {wa && <a className="adm-btn primary sm" href={`${wa}?text=${encodeURIComponent(`Hi ${l.cp_name || ''}, I saw your land “${l.title}” on Mappingg. Can you share more details?`)}`} target="_blank" rel="noopener"><i className="fab fa-whatsapp" /> WhatsApp</a>}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
    </div>
  );
}

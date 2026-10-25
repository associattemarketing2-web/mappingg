'use client';

import { useEffect, useState } from 'react';

// Shown as placeholders: these are what the live site uses when a field is empty
// (keep in sync with the defaults in lib/site-settings.ts).
const DEFAULTS = { gsc: 'xjmisC7LNZagrEObXyZOZoVzRQW2g72BbVjGuaBXsL8', gtm: 'GTM-59Q6QBP6', ga: 'G-PWBF18X96P' };

// Fixed in the site code (app/layout.tsx metadata, lib/insights.ts day rules) —
// shown read-only on the General page so the admin can see what is in use.
const SITE_NAME = 'Mappingg.com';
const TAGLINE = 'Live Real Estate Project Map';
const TIME_ZONE = 'Asia/Kolkata (GMT +5:30)';
const LOGO = '/img/mappingg-logo-sm.png';

/**
 * Site settings. `view="general"` is the General page (site identity, default
 * city, domain and the two Google verification/tag IDs); `view="seo"` has every
 * tracking field. Both save the same `map_settings` row.
 */
export default function SettingsForm({ view = 'seo', cities = [] }: { view?: 'general' | 'seo'; cities?: { key: string; label: string }[] }) {
  const [gtm, setGtm] = useState('');
  const [gsc, setGsc] = useState('');
  const [ga, setGa] = useState('');
  const [yt, setYt] = useState('');
  const [city, setCity] = useState('pune');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [origin, setOrigin] = useState('');

  function flash(msg: string, err = false) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 3000);
  }

  useEffect(() => {
    setOrigin((process.env.NEXT_PUBLIC_SITE_URL || window.location.origin).replace(/\/$/, ''));
    (async () => {
      try {
        const res = await fetch('/api/admin/settings', { credentials: 'same-origin' });
        const body = await res.json();
        const d = body.data || {};
        setGtm(d.gtm_container_id || '');
        setGsc(d.search_console_verification || '');
        setGa(d.ga_measurement_id || '');
        setYt(d.youtube_video_url || '');
        if (typeof d.admin_default_city === 'string') setCity(d.admin_default_city);
      } catch {
        flash('Could not load settings', true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          gtm_container_id: gtm.trim(),
          search_console_verification: gsc.trim(),
          ga_measurement_id: ga.trim(),
          youtube_video_url: yt.trim(),
          admin_default_city: city,
        }),
      });
      if (!res.ok) throw new Error();
      flash('Settings saved');
    } catch {
      flash('Save failed — check the ID formats', true);
    } finally {
      setSaving(false);
    }
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); flash('Copied'); } catch { flash('Could not copy', true); }
  }

  if (loading) return <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading…</p></div>;

  const saveBtn = <button className="pg-btn" disabled={saving}><i className="fas fa-floppy-disk" /> {saving ? 'Saving…' : 'Save Changes'}</button>;
  const toastNode = toast && <div className={`adm-toast show${toast.err ? ' err' : ''}`}><i className={`fas ${toast.err ? 'fa-triangle-exclamation' : 'fa-circle-check'}`} />{toast.msg}</div>;
  const domain = origin.replace(/^https?:\/\//, '');

  if (view === 'general') {
    return (
      <form className="st-form" onSubmit={submit}>
        <section className="pg-card st-sec">
          <div className="st-sec-head">
            <div><h3>General Settings</h3><p>Basic information and platform configuration.</p></div>
            {saveBtn}
          </div>
          <div className="st-general">
            <div className="st-general-fields">
              <div className="adm-field">
                <label>Site Name</label>
                <div className="st-ro"><input value={SITE_NAME} readOnly aria-readonly="true" /><i className="fas fa-lock" title="Set in the website code" /></div>
              </div>
              <div className="adm-field">
                <label>Tagline</label>
                <div className="st-ro"><input value={TAGLINE} readOnly aria-readonly="true" /><i className="fas fa-lock" title="Set in the website code" /></div>
              </div>
              <div className="st-grid">
                <div className="adm-field">
                  <label>Default Location <small>(the Overview opens on this city)</small></label>
                  <select value={city} onChange={(e) => setCity(e.target.value)}>
                    <option value="">All cities</option>
                    {cities.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    {city && !cities.some((c) => c.key === city) && <option value={city}>{city}</option>}
                  </select>
                </div>
                <div className="adm-field">
                  <label>Time Zone</label>
                  <div className="st-ro"><input value={TIME_ZONE} readOnly aria-readonly="true" /><i className="fas fa-lock" title="All dates and daily numbers use India time" /></div>
                </div>
              </div>
            </div>
            <div className="st-logo">
              <span className="st-logo-label">Site Logo</span>
              <div className="st-logo-box">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={LOGO} alt="Mappingg.com logo" />
                <small>SUPER ADMIN</small>
              </div>
              <div className="st-logo-acts">
                <a className="adm-btn ghost sm" href={LOGO} target="_blank" rel="noopener"><i className="fas fa-arrow-up-right-from-square" /> View logo</a>
                <a className="adm-btn ghost sm" href={LOGO} download><i className="fas fa-download" /> Download</a>
              </div>
            </div>
          </div>
          <p className="st-hint"><i className="fas fa-lock" /> Site name, tagline, logo and time zone are part of the website code, so they are shown here for reference.</p>
        </section>

        <section className="pg-card st-sec">
          <div className="st-sec-head"><div><h3>Domain &amp; URLs</h3><p>Where the website lives and how Google verifies it.</p></div></div>
          <div className="st-grid">
            <div className="adm-field">
              <label>Primary Domain</label>
              <div className="st-ro"><input value={origin} readOnly aria-readonly="true" /><i className="fas fa-lock" title="Set by the hosting / NEXT_PUBLIC_SITE_URL" /></div>
            </div>
            <div className="adm-field">
              <label>Google Search Console Verification</label>
              <input value={gsc} onChange={(e) => setGsc(e.target.value)} placeholder={DEFAULTS.gsc} />
            </div>
            <div className="adm-field">
              <label>Site URL <small>(for sharing)</small></label>
              <div className="st-copy">
                <input value={origin} readOnly aria-readonly="true" />
                <button type="button" onClick={() => copy(origin)} title="Copy" aria-label="Copy site URL"><i className="far fa-copy" /></button>
              </div>
            </div>
            <div className="adm-field">
              <label>Google Tag Manager ID</label>
              <input value={gtm} onChange={(e) => setGtm(e.target.value)} placeholder={DEFAULTS.gtm} />
            </div>
          </div>
          <div className="st-links">
            <a href={`${origin}/sitemap.xml`} target="_blank" rel="noopener"><i className="fas fa-sitemap" /> {domain}/sitemap.xml</a>
            <a href={`${origin}/robots.txt`} target="_blank" rel="noopener"><i className="fas fa-robot" /> {domain}/robots.txt</a>
            <a href={`${origin}/map`} target="_blank" rel="noopener"><i className="fas fa-map" /> {domain}/map</a>
          </div>
        </section>
        {toastNode}
      </form>
    );
  }

  return (
    <form className="st-form" onSubmit={submit}>
      <section className="pg-card st-sec">
        <div className="st-sec-head">
          <div><h3>SEO &amp; Analytics</h3><p>Site-wide tracking and search-engine verification.</p></div>
          {saveBtn}
        </div>
        <p className="adm-note" style={{ marginBottom: 16 }}>
          <i className="fas fa-circle-info" />
          <span>Paste values exactly as Google gives them. Leave a field empty to use the site&apos;s default ID (shown greyed out).</span>
        </p>
        <h4 className="st-sub">Verification &amp; tags</h4>
        <div className="st-grid">
          <div className="adm-field">
            <label>Google Search Console Verification <small>(the content value of the meta tag)</small></label>
            <input value={gsc} onChange={(e) => setGsc(e.target.value)} placeholder={DEFAULTS.gsc} />
          </div>
          <div className="adm-field">
            <label>Google Tag Manager ID</label>
            <input value={gtm} onChange={(e) => setGtm(e.target.value)} placeholder={DEFAULTS.gtm} />
          </div>
          <div className="adm-field">
            <label>Google Analytics 4 Measurement ID <small>(gtag.js)</small></label>
            <input value={ga} onChange={(e) => setGa(e.target.value)} placeholder={DEFAULTS.ga} />
          </div>
        </div>
        <h4 className="st-sub">Media</h4>
        <div className="st-grid">
          <div className="adm-field">
            <label>Promo YouTube Video URL <small>(optional)</small></label>
            <input value={yt} onChange={(e) => setYt(e.target.value)} placeholder="https://youtube.com/watch?v=…" />
          </div>
        </div>
      </section>
      {toastNode}
    </form>
  );
}

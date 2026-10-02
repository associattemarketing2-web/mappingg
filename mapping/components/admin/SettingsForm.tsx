'use client';

import { useEffect, useState } from 'react';

export default function SettingsForm() {
  const [gtm, setGtm] = useState('');
  const [gsc, setGsc] = useState('');
  const [yt, setYt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);

  function flash(msg: string, err = false) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 3000);
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/settings', { credentials: 'same-origin' });
        const body = await res.json();
        const d = body.data || {};
        setGtm(d.gtm_container_id || '');
        setGsc(d.search_console_verification || '');
        setYt(d.youtube_video_url || '');
      } catch {
        flash('Could not load settings', true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ gtm_container_id: gtm.trim(), search_console_verification: gsc.trim(), youtube_video_url: yt.trim() }),
      });
      if (!res.ok) throw new Error();
      flash('Settings saved');
    } catch {
      flash('Save failed', true);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading…</p></div>;

  return (
    <form className="adm-panel" onSubmit={submit}>
      <div className="adm-panel-head"><h3>SEO &amp; analytics</h3></div>
      <p className="adm-note" style={{ marginBottom: 16 }}>
        <i className="fas fa-circle-info" />
        <span>These control site-wide tracking &amp; search-engine verification. Paste values exactly as Google gives them.</span>
      </p>
      <div className="adm-field">
        <label>Google Search Console verification <small>(the content value of the meta tag)</small></label>
        <input value={gsc} onChange={(e) => setGsc(e.target.value)} placeholder="e.g. AbCdEf123… (from the HTML tag method)" />
      </div>
      <div className="adm-field">
        <label>Google Tag Manager container ID</label>
        <input value={gtm} onChange={(e) => setGtm(e.target.value)} placeholder="GTM-XXXXXXX" />
      </div>
      <div className="adm-field">
        <label>Promo YouTube video URL <small>(optional)</small></label>
        <input value={yt} onChange={(e) => setYt(e.target.value)} placeholder="https://youtube.com/watch?v=…" />
      </div>
      <div className="adm-actions"><button className="adm-btn primary" disabled={saving}><i className="fas fa-floppy-disk" /> {saving ? 'Saving…' : 'Save settings'}</button></div>

      {toast && <div className={`adm-toast show${toast.err ? ' err' : ''}`}><i className={`fas ${toast.err ? 'fa-triangle-exclamation' : 'fa-circle-check'}`} />{toast.msg}</div>}
    </form>
  );
}

'use client';

import { useRef, useState } from 'react';

const PERM_LABELS: Record<string, string> = {
  map: 'Map Editor',
  intake: 'Projects Intake',
  leads: 'Leads / CRM',
  blogs: 'Blogs',
  seo: 'SEO & Health',
  settings: 'Settings',
};

export default function ProfileForm({
  email,
  role,
  name: initialName = '',
  permissions = [],
  avatar: initialAvatar = '',
  onProfileSaved,
}: {
  email: string;
  role: string;
  name?: string;
  permissions?: string[];
  avatar?: string;
  onProfileSaved?: (p: { name: string; avatar: string }) => void;
}) {
  const isOwner = role === 'admin';
  const [name, setName] = useState(initialName);
  const [avatar, setAvatar] = useState(initialAvatar);
  const [savingProfile, setSavingProfile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  function flash(msg: string, err = false) {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 3000);
  }

  const initials = (name || email || '?').slice(0, 2).toUpperCase();

  function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) return flash('Choose a JPG, PNG, WebP or GIF image', true);
    if (file.size > 1_000_000) return flash('Image is too large (max 1 MB)', true);
    const rd = new FileReader();
    rd.onload = () => setAvatar(String(rd.result || ''));
    rd.readAsDataURL(file);
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await fetch('/api/admin/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: name.trim(), avatar }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || 'Failed');
      flash('Profile saved');
      onProfileSaved?.({ name: body.data?.name ?? name, avatar: body.data?.avatar ?? avatar });
    } catch (e2) {
      flash(e2 instanceof Error ? e2.message : 'Failed', true);
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 8) return flash('New password must be at least 8 characters', true);
    if (next !== confirm) return flash('New passwords do not match', true);
    setSavingPw(true);
    try {
      const res = await fetch('/api/admin/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ current, next }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || 'Failed');
      flash('Password updated');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (e2) {
      flash(e2 instanceof Error ? e2.message : 'Failed', true);
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <>
      <form className="adm-panel" onSubmit={saveProfile}>
        <div className="adm-panel-head"><h3>Your profile</h3></div>
        <div className="adm-profile">
          <div className="adm-avatar" aria-hidden="true">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="Profile" />
            ) : (
              <span className="ph">{initials}</span>
            )}
          </div>
          <div className="adm-profile-main">
            <div className="adm-field">
              <label>Display name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rahul Sharma" />
            </div>
            <div className="adm-avatar-actions">
              <input ref={fileRef} type="file" accept="image/*" onChange={pickPhoto} hidden />
              <button type="button" className="adm-btn ghost sm" onClick={() => fileRef.current?.click()}>
                <i className="fas fa-camera" /> {avatar ? 'Change photo' : 'Upload photo'}
              </button>
              {avatar && (
                <button type="button" className="adm-btn ghost sm" onClick={() => setAvatar('')}>
                  <i className="fas fa-trash" /> Remove
                </button>
              )}
              <small className="adm-hint">Square image works best · max 1 MB</small>
            </div>
          </div>
        </div>
        <div className="adm-actions" style={{ marginTop: 16 }}>
          <button className="adm-btn primary" disabled={savingProfile}>
            <i className="fas fa-floppy-disk" /> {savingProfile ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>

      <div className="adm-panel">
        <div className="adm-panel-head"><h3>Account</h3></div>
        <div className="adm-grid2">
          <div className="adm-field"><label>Email</label><input value={email} disabled /></div>
          <div className="adm-field"><label>Role</label><input value={isOwner ? 'Super admin (full access)' : 'Employee'} disabled /></div>
        </div>
        <div className="adm-field">
          <label>Access</label>
          <div className="adm-perm-badges">
            {isOwner ? (
              <span className="adm-badge ok">All areas</span>
            ) : permissions.length ? (
              permissions.map((p) => <span key={p} className="adm-badge muted">{PERM_LABELS[p] || p}</span>)
            ) : (
              <span className="adm-badge muted">Dashboard only</span>
            )}
          </div>
        </div>
      </div>

      <form className="adm-panel" onSubmit={changePassword}>
        <div className="adm-panel-head"><h3>Change password</h3></div>
        <div className="adm-field"><label>Current password</label><input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required /></div>
        <div className="adm-grid2">
          <div className="adm-field"><label>New password</label><input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required /></div>
          <div className="adm-field"><label>Confirm new password</label><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required /></div>
        </div>
        <div className="adm-actions"><button className="adm-btn primary" disabled={savingPw}><i className="fas fa-key" /> {savingPw ? 'Saving…' : 'Update password'}</button></div>
      </form>

      {toast && <div className={`adm-toast show${toast.err ? ' err' : ''}`}><i className={`fas ${toast.err ? 'fa-triangle-exclamation' : 'fa-circle-check'}`} />{toast.msg}</div>}
    </>
  );
}

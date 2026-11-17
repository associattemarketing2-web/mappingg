'use client';

import { useCallback, useEffect, useState } from 'react';
import './subscriptions.css';

// Developer → Project media: upload a brochure, floor plans and gallery photos
// (Medium and up) or add a highlighted YouTube video (Large Bulk) for each
// project on the plan. Files go to /api/partners/storage in ≤3 MB parts (the
// same upload protocol the admin intake uses); each item is then reviewed by
// Mappingg before it appears on the live map. Plan checks run on the server.

type Project = { id: string; title: string; location: string; review: string; covered: boolean };
type Item = { id: string; kind: string; url: string; title: string; status: string; note: string; created_at: string };
type Info = { items: Item[]; allowed: Record<string, boolean>; limit: number | null; used: number; prefix: Record<string, string> };

const KINDS = [
  { key: 'brochure', label: 'Brochure', icon: 'fa-book-open', accept: 'application/pdf,image/jpeg,image/png,image/webp', hint: 'PDF or image, up to 25 MB' },
  { key: 'floor_plan', label: 'Floor plan', icon: 'fa-vector-square', accept: 'application/pdf,image/jpeg,image/png,image/webp', hint: 'PDF or image' },
  { key: 'gallery', label: 'Gallery photo', icon: 'fa-images', accept: 'image/jpeg,image/png,image/webp', hint: 'JPG, PNG or WebP' },
  { key: 'video', label: 'Highlighted video', icon: 'fa-circle-play', accept: '', hint: 'YouTube link (Large Bulk)' },
] as const;
const PART = 3 * 1024 * 1024;
const STATUS: Record<string, string> = { pending: 'Waiting for review', approved: 'Live', rejected: 'Not approved' };

async function upload(path: string, file: File, onProgress: (p: number) => void) {
  const parts = Math.max(1, Math.ceil(file.size / PART));
  const uploadId = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9-]/g, '');
  for (let i = 0; i < parts; i++) {
    const fd = new FormData();
    fd.set('bucket', 'project-media');
    fd.set('path', path);
    fd.set('contentType', file.type);
    fd.set('file', file.slice(i * PART, (i + 1) * PART), file.name);
    if (parts > 1) { fd.set('parts', String(parts)); fd.set('part', String(i)); fd.set('uploadId', uploadId); }
    const r = await fetch('/api/partners/storage', { method: 'POST', body: fd, credentials: 'same-origin' });
    const b = await r.json().catch(() => ({}));
    if (!r.ok || b?.error) throw new Error(b?.error?.message || `Upload failed (${r.status})`);
    onProgress(Math.round(((i + 1) / parts) * 100));
  }
}

function ProjectMedia({ p }: { p: Project }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number]['key']>('brochure');
  const [file, setFile] = useState<File | null>(null);
  const [video, setVideo] = useState('');
  const [title, setTitle] = useState('');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/my/projects/media?pin=${encodeURIComponent(p.id)}`, { credentials: 'same-origin' });
    const b = await r.json().catch(() => ({}));
    if (r.ok) setInfo(b.data);
  }, [p.id]);
  useEffect(() => { load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!info) return;
    setBusy(true); setMsg(null); setProgress(0);
    try {
      let body: Record<string, string> = { pin_id: p.id, kind, title };
      if (kind === 'video') body.url = video.trim();
      else {
        if (!file) throw new Error('Choose a file first.');
        if (file.size > 25 * 1024 * 1024) throw new Error('Files can be up to 25 MB.');
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
        const path = `${info.prefix[kind]}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        await upload(path, file, setProgress);
        body = { ...body, path };
      }
      const r = await fetch('/api/my/projects/media', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.error?.message || 'Could not send it');
      setMsg({ text: 'Sent — it will appear on the map once the Mappingg team approves it.' });
      setFile(null); setVideo(''); setTitle('');
      load();
    } catch (err) { setMsg({ text: (err as Error).message, err: true }); } finally { setBusy(false); }
  }

  const k = KINDS.find((x) => x.key === kind)!;
  const allowedHere = info?.allowed[kind];
  return (
    <section className="sub-card">
      <h2>
        <i className="fas fa-building" /> {p.title}
        {p.covered ? <span className="sub-badge premium"><i className="fas fa-crown" /> On your plan</span> : <span className="sub-badge free">Free features</span>}
        <span className="sp" />
        {info && info.limit != null && <span className="sub-badge">{info.used} / {info.limit} files</span>}
      </h2>
      {!p.covered && (
        <div className="sub-alert warn" style={{ marginBottom: 12 }}><i className="fas fa-lock" /><span className="grow">Brochures, floor plans and galleries are for projects on a paid plan.</span><a className="sub-btn sm primary" href="/dashboard/developer/subscription#plans">Add this project to a plan</a></div>
      )}
      <form className="sub-form" onSubmit={submit}>
        <label className="sub-field"><span>Type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {KINDS.map((x) => <option key={x.key} value={x.key}>{x.label}{info && !info.allowed[x.key] ? ' (upgrade)' : ''}</option>)}
          </select>
        </label>
        <label className="sub-field"><span>Title <small>(optional)</small></span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={kind === 'floor_plan' ? 'e.g. 2 BHK — 750 sq ft' : ''} /></label>
        {kind === 'video'
          ? <label className="sub-field wide"><span>YouTube link</span><input value={video} onChange={(e) => setVideo(e.target.value)} placeholder="https://youtu.be/…" /></label>
          : <label className="sub-field wide"><span>File <small>— {k.hint}</small></span><input type="file" accept={k.accept} onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>}
        <div className="wide sub-toolbar">
          <button className="sub-btn primary" disabled={busy || !allowedHere || (kind === 'video' ? !video.trim() : !file)}>
            {busy ? <><i className="fas fa-spinner fa-spin" /> {progress ? `${progress}%` : 'Sending…'}</> : <><i className={`fas ${k.icon}`} /> Send for review</>}
          </button>
          {info && !allowedHere && <span className="sub-muted">{kind === 'video' ? 'Highlighted videos are part of Large Bulk.' : 'Not on this project’s plan.'}</span>}
        </div>
      </form>
      {msg && <p className={`sub-msg${msg.err ? ' err' : ''}`} role="status" style={{ marginTop: 10 }}>{msg.text}</p>}
      {info && info.items.length > 0 && (
        <ul className="sub-list" style={{ marginTop: 14 }}>
          {info.items.map((m) => (
            <li key={m.id}>
              <span className="main"><b>{KINDS.find((x) => x.key === m.kind)?.label || m.kind}{m.title ? ` — ${m.title}` : ''}</b><small>{new Date(m.created_at).toLocaleDateString('en-IN')}{m.note ? ` · ${m.note}` : ''}</small></span>
              <a className="sub-btn sm ghost" href={m.url} target="_blank" rel="noopener">Open</a>
              <span className={`sub-badge ${m.status === 'approved' ? 'ok' : m.status === 'rejected' ? 'bad' : 'warn'}`}>{STATUS[m.status] || m.status}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function DevMedia() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  useEffect(() => {
    fetch('/api/subscriptions/current', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((b) => setProjects((b?.data?.projects || []).filter((p: Project) => p.review !== 'rejected')))
      .catch(() => setProjects([]));
  }, []);
  if (!projects) return <div className="sub"><p className="sub-muted"><i className="fas fa-spinner fa-spin" /> Loading…</p></div>;
  return (
    <div className="sub">
      <div className="sub-stack">
        <div className="sub-alert info"><i className="fas fa-circle-info" /><span className="grow">Add a brochure, floor plans and photos to your projects. Each file is checked by the Mappingg team before it shows on the live map — your project stays live meanwhile.</span></div>
        {projects.length ? projects.sort((a, b) => Number(b.covered) - Number(a.covered)).map((p) => <ProjectMedia key={p.id} p={p} />) : <p className="sub-empty">Add a project in Projects Intake first.</p>}
      </div>
    </div>
  );
}

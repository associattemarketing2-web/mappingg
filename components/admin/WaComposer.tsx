'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// s-admin → WhatsApp: compose one or more messages (text, photo, video,
// document, approved template) and send them now, at chosen times, or on
// repeat, to one number or a whole list. Used by Bulk send (a list), the chat
// view (one number) and the Scheduled tab (history + cancel).
// API: /api/admin/whatsapp/schedule, uploads: /api/admin/whatsapp/media.

export interface WaTpl {
  name: string; language: string; category: string; body: string; vars: number; urlVars: number;
  header?: 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT'; headerVars?: number; headerText?: string;
}
export type Outcome = { phone: string; ok: boolean; error?: string };
type Flash = (m: string, e?: boolean) => void;
type Kind = 'text' | 'image' | 'video' | 'document' | 'template';
type When = 'now' | 'at' | 'repeat';

const SCHED_API = '/api/admin/whatsapp/schedule';
const MEDIA_API = '/api/admin/whatsapp/media';

async function call<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || b.error) throw new Error(b?.error?.message || `Request failed (${r.status})`);
  return b.data as T;
}

/** Uploads a file in parts (Vercel caps a request at 4.5 MB) and resolves its public link. */
async function uploadFile(file: File, kind: 'image' | 'video' | 'document', onPct: (n: number) => void): Promise<string> {
  const start = await call<{ id: string; part_bytes: number; parts: number }>(MEDIA_API, { kind, name: file.name, mime: file.type, size: file.size });
  let url = '';
  for (let i = 0; i < start.parts; i++) {
    const r = await fetch(`${MEDIA_API}?id=${start.id}&idx=${i}`, { method: 'PUT', credentials: 'same-origin', body: file.slice(i * start.part_bytes, (i + 1) * start.part_bytes) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok || b.error) throw new Error(b?.error?.message || `Upload failed (${r.status})`);
    onPct(Math.round(((i + 1) / start.parts) * 100));
    if (b.data?.complete) url = b.data.url;
  }
  if (!url) throw new Error('Upload did not finish — try again');
  return url;
}

/** datetime-local value for `ms` in the browser's time zone. */
const localValue = (ms: number) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000); return d.toISOString().slice(0, 16); };
const nextHour = () => { const d = new Date(); d.setMinutes(0, 0, 0); return localValue(d.getTime() + 3_600_000); };
const IST = { timeZone: 'Asia/Kolkata' } as const;
export const whenText = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', ...IST });

interface Draft {
  key: string; kind: Kind; text: string;
  mediaUrl: string; mediaName: string; pct: number | null;
  tplKey: string; params: string[]; urlParam: string; headerParams: string[]; headerUrl: string; headerName: string; headerPct: number | null;
  when: When; times: string[]; start: string; every: number; unit: 'minutes' | 'hours' | 'days'; count: number;
}
const newDraft = (): Draft => ({
  key: Math.random().toString(36).slice(2), kind: 'text', text: '', mediaUrl: '', mediaName: '', pct: null,
  tplKey: '', params: [], urlParam: '', headerParams: [], headerUrl: '', headerName: '', headerPct: null,
  when: 'now', times: [nextHour()], start: nextHour(), every: 1, unit: 'hours', count: 3,
});

const KINDS: [Kind, string, string][] = [
  ['text', 'Text', 'fa-keyboard'], ['image', 'Photo', 'fa-image'], ['video', 'Video', 'fa-video'], ['document', 'Document', 'fa-file-lines'], ['template', 'Template', 'fa-user-check'],
];
const ACCEPT: Record<'image' | 'video' | 'document', string> = { image: 'image/jpeg,image/png', video: 'video/mp4,video/3gpp', document: '*/*' };
const LIMIT: Record<'image' | 'video' | 'document', string> = { image: 'JPG or PNG, up to 5 MB', video: 'MP4, up to 16 MB', document: 'PDF or any file, up to 16 MB' };

function DraftCard({ d, i, total, set, remove, templates, meta, busy, flash }: {
  d: Draft; i: number; total: number; set: (p: Partial<Draft>) => void; remove: () => void;
  templates: WaTpl[]; meta: boolean; busy: boolean; flash: Flash;
}) {
  const tpl = templates.find((t) => `${t.name}|${t.language}` === d.tplKey) || null;
  const fileRef = useRef<HTMLInputElement>(null);
  const headRef = useRef<HTMLInputElement>(null);
  const headKind = tpl?.header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(tpl.header) ? (tpl.header.toLowerCase() as 'image' | 'video' | 'document') : null;

  useEffect(() => {
    if (d.kind !== 'template' || !templates.length || tpl) return;
    set({ tplKey: `${templates[0].name}|${templates[0].language}` });
  }, [d.kind, templates, tpl, set]);
  useEffect(() => {
    set({ params: Array.from({ length: tpl?.vars || 0 }, () => ''), headerParams: Array.from({ length: tpl?.headerVars || 0 }, () => ''), urlParam: '', headerUrl: '', headerName: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl?.name, tpl?.language]);

  async function pick(file: File | undefined, kind: 'image' | 'video' | 'document', header: boolean) {
    if (!file) return;
    try {
      set(header ? { headerPct: 0, headerName: file.name } : { pct: 0, mediaName: file.name });
      const url = await uploadFile(file, kind, (n) => set(header ? { headerPct: n } : { pct: n }));
      set(header ? { headerUrl: url, headerPct: null } : { mediaUrl: url, pct: null });
    } catch (e) {
      set(header ? { headerPct: null, headerName: '' } : { pct: null, mediaName: '' });
      flash((e as Error).message, true);
    }
  }

  const preview = tpl ? tpl.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n) => d.params[Number(n) - 1]?.trim() || m) : '';
  const media = d.kind === 'image' || d.kind === 'video' || d.kind === 'document' ? d.kind : null;

  return (
    <div className="wa-draft">
      <div className="wa-draft-head">
        <b>{total > 1 ? `Message ${i + 1}` : 'Message'}</b>
        {total > 1 && <button type="button" className="adm-btn ghost sm" onClick={remove} disabled={busy} aria-label="Remove message"><i className="fas fa-xmark" /></button>}
      </div>
      <div className="wa-filters wa-bulk-mode" role="tablist" aria-label="Message type">
        {KINDS.map(([k, label, icon]) => (
          <button key={k} type="button" role="tab" aria-selected={d.kind === k} className={d.kind === k ? 'on' : ''} disabled={busy}
            onClick={() => set({ kind: k, ...(k !== d.kind ? { mediaUrl: '', mediaName: '', pct: null } : {}) })}>
            <i className={`fas ${icon}`} /> {label}
          </button>
        ))}
      </div>

      {media && (
        <div className="adm-field">
          <label>{media === 'image' ? 'Photo' : media === 'video' ? 'Video' : 'Document'} <small>— {LIMIT[media]}</small></label>
          <div className="wa-file-row">
            <input ref={fileRef} type="file" hidden accept={ACCEPT[media]} onChange={(e) => { void pick(e.target.files?.[0], media, false); e.target.value = ''; }} />
            <button type="button" className="adm-btn ghost sm" onClick={() => fileRef.current?.click()} disabled={busy || d.pct !== null}>
              {d.pct !== null ? <><i className="fas fa-spinner fa-spin" /> Uploading {d.pct}%</> : <><i className="fas fa-upload" /> {d.mediaUrl ? 'Change file' : 'Upload file'}</>}
            </button>
            {d.mediaName && d.mediaUrl && <span className="wa-file-ok"><i className="fas fa-check" /> {d.mediaName}</span>}
          </div>
          <input type="url" placeholder="…or paste a public link (https://…)" value={d.mediaName ? '' : d.mediaUrl} disabled={busy || !!d.mediaName}
            onChange={(e) => set({ mediaUrl: e.target.value.trim() })} />
        </div>
      )}

      {d.kind !== 'template' ? (
        <div className="adm-field wa-bulk-msg">
          <label>{media ? 'Caption (optional)' : 'Message'} <small>— <code>{'{name}'}</code> = each person&apos;s name</small></label>
          <textarea value={d.text} maxLength={media ? 1024 : 4096} disabled={busy} onChange={(e) => set({ text: e.target.value })}
            placeholder={media ? 'New launch in Baner — 2 & 3 BHK…' : 'Hi {name}, new projects are live on Mappingg…'} style={media ? { minHeight: 70 } : undefined} />
        </div>
      ) : !meta ? (
        <p className="muted">Templates are picked from the whatapi.in account.</p>
      ) : !templates.length ? (
        <p className="muted">No approved templates yet. Create one in the whatapi.in dashboard — it shows here once approved.</p>
      ) : (
        <div className="adm-field wa-bulk-msg">
          <label>Approved template</label>
          <select value={d.tplKey} onChange={(e) => set({ tplKey: e.target.value })} disabled={busy}>
            {templates.map((t) => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} ({t.language}, {t.category.toLowerCase()}{t.header && t.header !== 'NONE' && t.header !== 'TEXT' ? `, ${t.header.toLowerCase()} header` : ''})</option>)}
          </select>
          {headKind && (
            <div className="adm-field">
              <label>Header {headKind} <small>— {LIMIT[headKind]}</small></label>
              <div className="wa-file-row">
                <input ref={headRef} type="file" hidden accept={ACCEPT[headKind]} onChange={(e) => { void pick(e.target.files?.[0], headKind, true); e.target.value = ''; }} />
                <button type="button" className="adm-btn ghost sm" onClick={() => headRef.current?.click()} disabled={busy || d.headerPct !== null}>
                  {d.headerPct !== null ? <><i className="fas fa-spinner fa-spin" /> Uploading {d.headerPct}%</> : <><i className="fas fa-upload" /> {d.headerUrl ? 'Change file' : 'Upload file'}</>}
                </button>
                {d.headerName && d.headerUrl && <span className="wa-file-ok"><i className="fas fa-check" /> {d.headerName}</span>}
              </div>
              <input type="url" placeholder="…or paste a public link (https://…)" value={d.headerName ? '' : d.headerUrl} disabled={busy || !!d.headerName} onChange={(e) => set({ headerUrl: e.target.value.trim() })} />
            </div>
          )}
          {d.headerParams.map((v, j) => (
            <div key={`h${j}`} className="adm-field">
              <label>Header value {`{{${j + 1}}}`}</label>
              <input value={v} maxLength={60} disabled={busy} onChange={(e) => set({ headerParams: d.headerParams.map((x, k) => (k === j ? e.target.value : x)) })} />
            </div>
          ))}
          {d.params.map((v, j) => (
            <div key={j} className="adm-field">
              <label>Value {`{{${j + 1}}}`} <small>— <code>{'{name}'}</code> = each person&apos;s name</small></label>
              <input value={v} maxLength={1000} disabled={busy} onChange={(e) => set({ params: d.params.map((x, k) => (k === j ? e.target.value : x)) })} />
            </div>
          ))}
          {tpl && tpl.urlVars > 0 && (
            <div className="adm-field"><label>Button link value</label><input value={d.urlParam} maxLength={500} disabled={busy} onChange={(e) => set({ urlParam: e.target.value })} /></div>
          )}
          {tpl && <p className="wa-bulk-desc" style={{ whiteSpace: 'pre-wrap' }}><b>Preview:</b> {tpl.headerText ? `${tpl.headerText}\n` : ''}{preview}</p>}
        </div>
      )}

      <div className="adm-field wa-when">
        <label>When to send</label>
        <div className="wa-filters" role="tablist" aria-label="When to send">
          {([['now', 'Now', 'fa-bolt'], ['at', 'Pick date & time', 'fa-calendar-days'], ['repeat', 'Repeat', 'fa-rotate']] as const).map(([w, label, icon]) => (
            <button key={w} type="button" role="tab" aria-selected={d.when === w} className={d.when === w ? 'on' : ''} disabled={busy} onClick={() => set({ when: w })}>
              <i className={`fas ${icon}`} /> {label}
            </button>
          ))}
        </div>
        {d.when === 'at' && (
          <div className="wa-times">
            {d.times.map((t, j) => (
              <span key={j} className="wa-time">
                <input type="datetime-local" value={t} min={localValue(Date.now())} disabled={busy} onChange={(e) => set({ times: d.times.map((x, k) => (k === j ? e.target.value : x)) })} />
                {d.times.length > 1 && <button type="button" className="adm-btn ghost sm" onClick={() => set({ times: d.times.filter((_, k) => k !== j) })} disabled={busy} aria-label="Remove time"><i className="fas fa-xmark" /></button>}
              </span>
            ))}
            <button type="button" className="adm-btn ghost sm" disabled={busy || d.times.length >= 50}
              onClick={() => set({ times: [...d.times, localValue((Date.parse(d.times[d.times.length - 1]) || Date.now()) + 3_600_000)] })}>
              <i className="fas fa-plus" /> Add another time
            </button>
          </div>
        )}
        {d.when === 'repeat' && (
          <div className="wa-repeat">
            <span>Start</span>
            <input type="datetime-local" value={d.start} min={localValue(Date.now())} disabled={busy} onChange={(e) => set({ start: e.target.value })} />
            <span>every</span>
            <input type="number" min={1} max={1000} value={d.every} disabled={busy} onChange={(e) => set({ every: Math.max(1, Number(e.target.value) || 1) })} />
            <select value={d.unit} disabled={busy} onChange={(e) => set({ unit: e.target.value as Draft['unit'] })}>
              <option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option>
            </select>
            <input type="number" min={1} max={200} value={d.count} disabled={busy} onChange={(e) => set({ count: Math.min(200, Math.max(1, Number(e.target.value) || 1)) })} />
            <span>times</span>
          </div>
        )}
        {d.when !== 'now' && d.kind !== 'template' && (
          <p className="wa-note warn"><i className="fas fa-clock" /> Typed messages, photos, videos and documents only reach people who messaged you in the 24 hours before each send. Others are skipped. Use a Template to reach everyone.</p>
        )}
      </div>
    </div>
  );
}

/** Turns a draft into the API's {payload, timing}. Throws a readable error when something is missing. */
function toMessage(d: Draft, templates: WaTpl[], meta: boolean) {
  const iso = (v: string) => { const ms = Date.parse(v); if (!Number.isFinite(ms)) throw new Error('Pick a valid date & time'); return new Date(ms).toISOString(); };
  let payload: Record<string, unknown>;
  if (d.kind === 'text') {
    if (!d.text.trim()) throw new Error('Type the message');
    payload = { kind: 'text', text: d.text.trim() };
  } else if (d.kind === 'template') {
    const tpl = templates.find((t) => `${t.name}|${t.language}` === d.tplKey);
    if (meta && !tpl) throw new Error('Pick a template');
    if (!tpl) throw new Error('Templates are not available');
    if (d.params.some((p) => !p.trim()) || d.headerParams.some((p) => !p.trim())) throw new Error(`Fill every value of template "${tpl.name}"`);
    const hk = tpl.header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(tpl.header) ? tpl.header.toLowerCase() : '';
    if (hk && !d.headerUrl) throw new Error(`Upload the header ${hk} of template "${tpl.name}"`);
    payload = {
      kind: 'template',
      template: {
        name: tpl.name, language: tpl.language, params: d.params.map((p) => p.trim()), ...(d.urlParam.trim() ? { url_param: d.urlParam.trim() } : {}),
        ...(hk ? { header: { type: hk, link: d.headerUrl, ...(hk === 'document' && d.headerName ? { filename: d.headerName } : {}) } }
          : d.headerParams.length ? { header: { type: 'text', params: d.headerParams.map((p) => p.trim()) } } : {}),
      },
    };
  } else {
    if (!/^https?:\/\//i.test(d.mediaUrl)) throw new Error(`Upload the ${d.kind === 'image' ? 'photo' : d.kind} (or paste its link)`);
    payload = { kind: d.kind, media: { url: d.mediaUrl, ...(d.mediaName ? { filename: d.mediaName } : {}) }, ...(d.text.trim() ? { text: d.text.trim() } : {}) };
  }
  const timing = d.when === 'now' ? { mode: 'now' }
    : d.when === 'at' ? { mode: 'at', times: d.times.map(iso) }
      : { mode: 'repeat', start: iso(d.start), every: d.every, unit: d.unit, count: d.count };
  return { payload, timing };
}

/**
 * The composer. `recipients` = who gets it (one chat, or the uploaded list). Messages timed "Now" are sent at once
 * with progress; the rest are saved and go out automatically at their time.
 */
export function Composer({ recipients, templates, meta, configured, flash, onResults, onDone, label }: {
  recipients: { phone: string; name?: string }[]; templates: WaTpl[]; meta: boolean; configured: boolean; flash: Flash;
  onResults?: (r: Outcome[]) => void; onDone?: () => void; label?: string;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([newDraft()]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const stop = useRef(false);
  const setters = useRef(new Map<string, (p: Partial<Draft>) => void>());
  const setFor = useCallback((key: string) => {
    let f = setters.current.get(key);
    if (!f) { f = (p) => setDrafts((ds) => ds.map((x) => (x.key === key ? { ...x, ...p } : x))); setters.current.set(key, f); }
    return f;
  }, []);

  const allNow = drafts.every((d) => d.when === 'now');
  const anyNow = drafts.some((d) => d.when === 'now');
  const uploading = drafts.some((d) => d.pct !== null || d.headerPct !== null);

  async function submit() {
    if (!recipients.length) { flash('Add at least one number first', true); return; }
    let messages;
    try { messages = drafts.map((d, i) => { try { return toMessage(d, templates, meta); } catch (e) { throw new Error(drafts.length > 1 ? `Message ${i + 1}: ${(e as Error).message}` : (e as Error).message); } }); } catch (e) { flash((e as Error).message, true); return; }
    const who = recipients.length === 1 ? (recipients[0].name || recipients[0].phone) : `${recipients.length.toLocaleString('en-IN')} numbers`;
    if (!window.confirm(`${allNow ? 'Send' : anyNow ? 'Send now and schedule' : 'Schedule'} ${drafts.length > 1 ? `${drafts.length} messages` : 'this message'} to ${who}?`)) return;
    setBusy(true);
    stop.current = false;
    try {
      const r = await call<{ schedule: { id: string; runs: { at: string }[] }; due_now: boolean }>(SCHED_API, {
        action: 'create', title: title.trim(), recipients: recipients.map((x) => ({ phone: x.phone, name: x.name || '' })), messages,
      });
      if (r.due_now) {
        // Send-now part: keep calling until nothing due is left, showing progress.
        const dueRuns = r.schedule.runs.filter((x) => Date.parse(x.at) <= Date.now() + 5_000).length || 1;
        const total = dueRuns * recipients.length;
        let done = 0, ok = 0, failed = 0;
        setProgress({ done: 0, total });
        for (let i = 0; i < 400 && !stop.current; i++) {
          const t = await call<{ results: Outcome[]; pending: boolean }>(SCHED_API, { action: 'tick', id: r.schedule.id });
          done += t.results.length; ok += t.results.filter((x) => x.ok).length; failed += t.results.filter((x) => !x.ok).length;
          onResults?.(t.results);
          setProgress({ done: Math.min(done, total), total });
          if (!t.pending) break;
        }
        if (stop.current) await call(SCHED_API, { action: 'cancel', id: r.schedule.id }).catch(() => undefined);
        flash(`${stop.current ? 'Stopped. ' : ''}${ok} ${meta ? 'queued' : 'sent'}${failed ? `, ${failed} not sent` : ''}${allNow ? '' : ' — the rest is scheduled'}`, failed > 0 && !ok);
      } else {
        const first = r.schedule.runs[0]?.at;
        flash(`Scheduled ✓ ${r.schedule.runs.length} send${r.schedule.runs.length === 1 ? '' : 's'}${first ? `, first at ${whenText(first)}` : ''}`);
      }
      setDrafts([newDraft()]); setTitle('');
      onDone?.();
    } catch (e) {
      flash((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wa-composer">
      {drafts.map((d, i) => (
        <DraftCard key={d.key} d={d} i={i} total={drafts.length} set={setFor(d.key)} remove={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
          templates={templates} meta={meta} busy={busy} flash={flash} />
      ))}
      <div className="wa-composer-foot">
        <button type="button" className="adm-btn ghost sm" onClick={() => setDrafts((ds) => [...ds, { ...newDraft(), when: 'at' }])} disabled={busy || drafts.length >= 10}>
          <i className="fas fa-plus" /> Add another message
        </button>
        {!allNow && <input className="wa-title" placeholder="Name this schedule (optional)" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} disabled={busy} />}
        {progress && (
          <div className="wa-bulk-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            <small>{progress.done} / {progress.total}</small>
          </div>
        )}
        <div className="wa-bulk-actions">
          {busy && progress
            ? <button type="button" className="adm-btn danger" onClick={() => { stop.current = true; }}><i className="fas fa-stop" /> Stop</button>
            : <button type="button" className="adm-btn primary wa-shoot" onClick={submit} disabled={busy || uploading || !configured || !recipients.length}>
              {busy ? <i className="fas fa-spinner fa-spin" /> : <i className={`fas ${allNow ? 'fa-paper-plane' : 'fa-calendar-check'}`} />}
              {' '}{allNow ? 'Send' : anyNow ? 'Send & schedule' : 'Schedule'}{label ? ` ${label}` : recipients.length > 1 ? ` to ${recipients.length.toLocaleString('en-IN')}` : ''}
            </button>}
        </div>
      </div>
    </div>
  );
}

interface RunRow { id: string; at: string; status: string; sent: number; failed: number; skipped: number; total: number; cursor: number; summary: string; last_error?: string }
interface SchedRow { id: string; title: string; status: string; created_by: string; created_at: string; numbers: number; runs: RunRow[]; next_at: string | null; messages: { kind: string; summary: string }[] }

const STATUS_BADGE: Record<string, string> = { pending: 'muted', running: 'ok', done: 'ok', cancelled: 'wa-bad', active: 'ok' };
const STATUS_TEXT: Record<string, string> = { pending: 'Waiting', running: 'Sending', done: 'Sent', cancelled: 'Cancelled', active: 'Active' };

/** Every schedule with its sends: what, when, how many sent / failed / skipped; cancel what is still waiting. */
export function SchedulesView({ flash, refreshKey = 0 }: { flash: Flash; refreshKey?: number }) {
  const [rows, setRows] = useState<SchedRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => { call<{ schedules: SchedRow[] }>(SCHED_API).then((d) => setRows(d.schedules), (e) => { flash((e as Error).message, true); setRows([]); }); }, [flash]);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30_000);
    return () => clearInterval(t);
  }, [load, refreshKey]);

  async function act(body: Record<string, unknown>, msg: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    try { await call(SCHED_API, body); flash(msg); load(); } catch (e) { flash((e as Error).message, true); }
  }

  return (
    <div className="adm-panel">
      <div className="adm-panel-head"><h3><i className="fas fa-calendar-days" /> Scheduled &amp; sent</h3><span className="muted">Waiting sends go out automatically at their time.</span></div>
      <div className="wa-table-wrap">
        <table className="wa-table">
          <thead><tr><th>Schedule</th><th>Numbers</th><th>Next send</th><th>Progress</th><th>Status</th><th /></tr></thead>
          <tbody>
            {!rows ? <tr><td colSpan={6} className="muted"><i className="fas fa-spinner fa-spin" /> Loading…</td></tr>
              : !rows.length ? <tr><td colSpan={6} className="muted">Nothing scheduled yet.</td></tr>
                : rows.map((s) => {
                  const done = s.runs.filter((r) => r.status === 'done').length;
                  const waiting = s.runs.some((r) => r.status === 'pending' || r.status === 'running');
                  return [
                    <tr key={s.id}>
                      <td className="wa-cell-text">
                        <button type="button" className="wa-link" onClick={() => setOpen(open === s.id ? null : s.id)}>
                          <i className={`fas fa-chevron-${open === s.id ? 'down' : 'right'}`} /> {s.title}
                        </button>
                        <small className="muted"> · {s.messages.length} message{s.messages.length === 1 ? '' : 's'} · {s.created_by ? s.created_by.split('@')[0] : ''} {whenText(s.created_at)}</small>
                      </td>
                      <td>{s.numbers.toLocaleString('en-IN')}</td>
                      <td>{s.next_at ? whenText(s.next_at) : '—'}</td>
                      <td>{done} / {s.runs.length} sends</td>
                      <td><span className={`adm-badge ${STATUS_BADGE[s.status] || 'muted'}`}>{STATUS_TEXT[s.status] || s.status}</span></td>
                      <td>
                        {waiting
                          ? <button type="button" className="adm-btn ghost sm" onClick={() => act({ action: 'cancel', id: s.id }, 'Cancelled', 'Cancel every waiting send of this schedule?')}><i className="fas fa-ban" /> Cancel</button>
                          : <button type="button" className="adm-btn ghost sm" onClick={() => act({ action: 'delete', id: s.id }, 'Deleted', 'Remove this schedule from the list? Sent messages stay in the chats.')} aria-label="Delete"><i className="fas fa-trash" /></button>}
                      </td>
                    </tr>,
                    open === s.id && (
                      <tr key={`${s.id}-runs`} className="wa-runs"><td colSpan={6}>
                        <table className="wa-table">
                          <thead><tr><th>When</th><th>Message</th><th>Sent</th><th>Failed</th><th>Skipped (24 h)</th><th>Status</th><th /></tr></thead>
                          <tbody>
                            {s.runs.map((r) => (
                              <tr key={r.id}>
                                <td>{whenText(r.at)}</td>
                                <td className="wa-cell-text">{r.summary}</td>
                                <td>{r.sent}</td>
                                <td>{r.failed ? <span className="adm-badge wa-bad" title={r.last_error}>{r.failed}</span> : 0}</td>
                                <td>{r.skipped}</td>
                                <td><span className={`adm-badge ${STATUS_BADGE[r.status] || 'muted'}`}>{STATUS_TEXT[r.status] || r.status}{r.status === 'running' ? ` ${r.cursor}/${r.total}` : ''}</span></td>
                                <td>{(r.status === 'pending' || r.status === 'running') && <button type="button" className="adm-btn ghost sm" onClick={() => act({ action: 'cancel', id: s.id, run_id: r.id }, 'Cancelled')}><i className="fas fa-ban" /></button>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td></tr>
                    ),
                  ];
                })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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
export async function uploadFile(file: File, kind: 'image' | 'video' | 'document', onPct: (n: number) => void): Promise<string> {
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

/** Values for one approved template (the message itself, or the 24-hour fallback). */
interface TplState { tplKey: string; params: string[]; urlParam: string; headerParams: string[]; headerUrl: string; headerName: string; headerPct: number | null }
const newTpl = (): TplState => ({ tplKey: '', params: [], urlParam: '', headerParams: [], headerUrl: '', headerName: '', headerPct: null });

interface Draft {
  key: string; kind: Kind; text: string;
  mediaUrl: string; mediaName: string; pct: number | null;
  tpl: TplState;
  /** Text / file: send this template to numbers outside WhatsApp's 24-hour window (else they are skipped). */
  fbOn: boolean; fb: TplState;
  when: When; times: string[]; start: string; every: number; unit: 'minutes' | 'hours' | 'days'; count: number;
}
const newDraft = (): Draft => ({
  key: Math.random().toString(36).slice(2), kind: 'text', text: '', mediaUrl: '', mediaName: '', pct: null,
  tpl: newTpl(), fbOn: true, fb: newTpl(),
  when: 'now', times: [nextHour()], start: nextHour(), every: 1, unit: 'hours', count: 3,
});

const KINDS: [Kind, string, string][] = [
  ['text', 'Text', 'fa-keyboard'], ['image', 'Photo', 'fa-image'], ['video', 'Video', 'fa-video'], ['document', 'Document', 'fa-file-lines'], ['template', 'Template', 'fa-user-check'],
];
const ACCEPT: Record<'image' | 'video' | 'document', string> = { image: 'image/jpeg,image/png', video: 'video/mp4,video/3gpp', document: '*/*' };
const LIMIT: Record<'image' | 'video' | 'document', string> = { image: 'JPG or PNG, up to 5 MB', video: 'MP4, up to 16 MB', document: 'PDF or any file, up to 16 MB' };
const tplKeyOf = (t: WaTpl) => `${t.name}|${t.language}`;
const headKindOf = (t: WaTpl | null) => (t?.header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(t.header) ? (t.header.toLowerCase() as 'image' | 'video' | 'document') : null);

/** Upload button + "or paste a link" for one file. */
function FileField({ kind, url, name, pct, busy, onPick, onLink }: {
  kind: 'image' | 'video' | 'document'; url: string; name: string; pct: number | null; busy: boolean;
  onPick: (f: File) => void; onLink: (url: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="wa-file-row">
        <input ref={ref} type="file" hidden accept={ACCEPT[kind]} onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }} />
        <button type="button" className="adm-btn ghost sm" onClick={() => ref.current?.click()} disabled={busy || pct !== null}>
          {pct !== null ? <><i className="fas fa-spinner fa-spin" /> Uploading {pct}%</> : <><i className="fas fa-upload" /> {url ? 'Change file' : 'Upload file'}</>}
        </button>
        {name && url && <span className="wa-file-ok"><i className="fas fa-check" /> {name}</span>}
      </div>
      <input type="url" placeholder="…or paste a public link (https://…)" value={name ? '' : url} disabled={busy || !!name} onChange={(e) => onLink(e.target.value.trim())} />
    </>
  );
}

/**
 * Picker + values of an approved template. `ownFile` (fallback only): the message's own file kind — a template
 * whose header takes that kind uses the message's file, no second upload. `hint` adds {message} help.
 */
function TplFields({ s, set, templates, busy, flash, ownFile, hint }: {
  s: TplState; set: (p: Partial<TplState>) => void; templates: WaTpl[]; busy: boolean; flash: Flash;
  ownFile?: Kind; hint?: boolean;
}) {
  const tpl = templates.find((t) => tplKeyOf(t) === s.tplKey) || null;
  const headKind = headKindOf(tpl);
  const usesOwn = !!headKind && headKind === ownFile;

  useEffect(() => {
    if (!templates.length || tpl) return;
    // Fallback: prefer a template whose header matches the message's file, then one with values to fill.
    const best = (ownFile && templates.find((t) => headKindOf(t) === ownFile)) || (hint && templates.find((t) => !headKindOf(t) && t.vars > 0)) || templates[0];
    set({ tplKey: tplKeyOf(best) });
  }, [templates, tpl, set, ownFile, hint]);
  useEffect(() => {
    // Fallback default: the last value carries the typed message, the first the name.
    const n = tpl?.vars || 0;
    const params = Array.from({ length: n }, (_, j) => (!hint ? '' : j === n - 1 ? '{message}' : j === 0 ? '{name}' : ''));
    set({ params, headerParams: Array.from({ length: tpl?.headerVars || 0 }, () => ''), urlParam: '', headerUrl: '', headerName: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl?.name, tpl?.language]);

  async function pick(file: File) {
    if (!headKind) return;
    try {
      set({ headerPct: 0, headerName: file.name });
      const url = await uploadFile(file, headKind, (n) => set({ headerPct: n }));
      set({ headerUrl: url, headerPct: null });
    } catch (e) {
      set({ headerPct: null, headerName: '' });
      flash((e as Error).message, true);
    }
  }

  if (!templates.length) return <p className="muted">No approved templates yet. Create one in the whatapi.in dashboard — it shows here once approved.</p>;
  const preview = tpl ? tpl.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n) => s.params[Number(n) - 1]?.trim() || m) : '';
  const tags = <small>— <code>{'{name}'}</code> = each person&apos;s name{hint && <>, <code>{'{message}'}</code> = your text / caption</>}, <code>{'{link}'}</code> = their project link</small>;
  return (
    <>
      <select value={s.tplKey} onChange={(e) => set({ tplKey: e.target.value })} disabled={busy}>
        {templates.map((t) => <option key={tplKeyOf(t)} value={tplKeyOf(t)}>{t.name} ({t.language}, {t.category.toLowerCase()}{headKindOf(t) ? `, ${headKindOf(t)} header` : ''})</option>)}
      </select>
      {headKind && (usesOwn
        ? <p className="wa-bulk-desc"><i className="fas fa-check" /> Header {headKind}: this message&apos;s file is used.</p>
        : (
          <div className="adm-field">
            <label>Header {headKind} <small>— {LIMIT[headKind]}</small></label>
            <FileField kind={headKind} url={s.headerUrl} name={s.headerName} pct={s.headerPct} busy={busy} onPick={(f) => void pick(f)} onLink={(u) => set({ headerUrl: u })} />
          </div>
        ))}
      {s.headerParams.map((v, j) => (
        <div key={`h${j}`} className="adm-field">
          <label>Header value {`{{${j + 1}}}`} {tags}</label>
          <input value={v} maxLength={60} disabled={busy} onChange={(e) => set({ headerParams: s.headerParams.map((x, k) => (k === j ? e.target.value : x)) })} />
        </div>
      ))}
      {s.params.map((v, j) => (
        <div key={j} className="adm-field">
          <label>Value {`{{${j + 1}}}`} {tags}</label>
          <input value={v} maxLength={1000} disabled={busy} onChange={(e) => set({ params: s.params.map((x, k) => (k === j ? e.target.value : x)) })} />
        </div>
      ))}
      {tpl && tpl.urlVars > 0 && (
        <div className="adm-field"><label>Button link value</label><input value={s.urlParam} maxLength={500} disabled={busy} onChange={(e) => set({ urlParam: e.target.value })} /></div>
      )}
      {tpl && <p className="wa-bulk-desc" style={{ whiteSpace: 'pre-wrap' }}><b>Preview:</b> {tpl.headerText ? `${tpl.headerText}\n` : ''}{preview}</p>}
    </>
  );
}

function DraftCard({ d, i, total, set, remove, templates, meta, busy, flash }: {
  d: Draft; i: number; total: number; set: (p: Partial<Draft>) => void; remove: () => void;
  templates: WaTpl[]; meta: boolean; busy: boolean; flash: Flash;
}) {
  const media = d.kind === 'image' || d.kind === 'video' || d.kind === 'document' ? d.kind : null;
  const dRef = useRef(d);
  dRef.current = d;
  const setTpl = useCallback((p: Partial<TplState>) => { dRef.current = { ...dRef.current, tpl: { ...dRef.current.tpl, ...p } }; set({ tpl: dRef.current.tpl }); }, [set]);
  const setFb = useCallback((p: Partial<TplState>) => { dRef.current = { ...dRef.current, fb: { ...dRef.current.fb, ...p } }; set({ fb: dRef.current.fb }); }, [set]);

  async function pick(file: File, kind: 'image' | 'video' | 'document') {
    try {
      set({ pct: 0, mediaName: file.name });
      const url = await uploadFile(file, kind, (n) => set({ pct: n }));
      set({ mediaUrl: url, pct: null });
    } catch (e) {
      set({ pct: null, mediaName: '' });
      flash((e as Error).message, true);
    }
  }

  return (
    <div className="wa-draft">
      <div className="wa-draft-head">
        <b>{total > 1 ? `Message ${i + 1}` : 'Message'}</b>
        {total > 1 && <button type="button" className="adm-btn ghost sm" onClick={remove} disabled={busy} aria-label="Remove message"><i className="fas fa-xmark" /></button>}
      </div>
      <div className="wa-filters wa-bulk-mode" role="tablist" aria-label="Message type">
        {KINDS.map(([k, label, icon]) => (
          <button key={k} type="button" role="tab" aria-selected={d.kind === k} className={d.kind === k ? 'on' : ''} disabled={busy}
            onClick={() => set({ kind: k, ...(k !== d.kind ? { mediaUrl: '', mediaName: '', pct: null, fb: newTpl() } : {}) })}>
            <i className={`fas ${icon}`} /> {label}
          </button>
        ))}
      </div>

      {media && (
        <div className="adm-field">
          <label>{media === 'image' ? 'Photo' : media === 'video' ? 'Video' : 'Document'} <small>— {LIMIT[media]}</small></label>
          <FileField kind={media} url={d.mediaUrl} name={d.mediaName} pct={d.pct} busy={busy} onPick={(f) => void pick(f, media)} onLink={(u) => set({ mediaUrl: u })} />
        </div>
      )}

      {d.kind !== 'template' ? (
        <div className="adm-field wa-bulk-msg">
          <label>{media ? 'Caption (optional)' : 'Message'} <small>— <code>{'{name}'}</code> = each person&apos;s name, <code>{'{link}'}</code> = their own project link</small></label>
          <textarea value={d.text} maxLength={media ? 1024 : 4096} disabled={busy} onChange={(e) => set({ text: e.target.value })}
            placeholder={media ? 'New launch in Baner — 2 & 3 BHK…' : 'Hi {name}, new projects are live on Mappingg…'} style={media ? { minHeight: 70 } : undefined} />
        </div>
      ) : !meta ? (
        <p className="muted">Templates are picked from the whatapi.in account.</p>
      ) : (
        <div className="adm-field wa-bulk-msg">
          <label>Approved template</label>
          <TplFields s={d.tpl} set={setTpl} templates={templates} busy={busy} flash={flash} />
        </div>
      )}

      {d.kind !== 'template' && meta && (
        <div className="adm-field wa-fallback">
          <label><i className="fas fa-clock" /> Not messaged you in the last 24 hours?</label>
          <p className="wa-bulk-desc muted">WhatsApp only delivers a typed message, photo or video to people who wrote to you in the last 24 hours. Everyone else can only get an approved template.</p>
          <div className="wa-filters" role="tablist" aria-label="24-hour rule">
            <button type="button" role="tab" aria-selected={d.fbOn} className={d.fbOn ? 'on' : ''} disabled={busy} onClick={() => set({ fbOn: true })}><i className="fas fa-user-check" /> Send them a template instead</button>
            <button type="button" role="tab" aria-selected={!d.fbOn} className={!d.fbOn ? 'on' : ''} disabled={busy} onClick={() => set({ fbOn: false })}><i className="fas fa-forward" /> Skip them</button>
          </div>
          {d.fbOn && <TplFields s={d.fb} set={setFb} templates={templates} busy={busy} flash={flash} ownFile={d.kind} hint />}
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
      </div>
    </div>
  );
}

/** A template's API value from its fields. `ownFile`: a matching header is left empty so the server uses the message's file. */
function toTemplate(s: TplState, templates: WaTpl[], ownFile?: Kind) {
  const tpl = templates.find((t) => tplKeyOf(t) === s.tplKey);
  if (!tpl) throw new Error('Pick a template');
  if (s.params.some((p) => !p.trim()) || s.headerParams.some((p) => !p.trim())) throw new Error(`Fill every value of template "${tpl.name}"`);
  if (tpl.urlVars && !s.urlParam.trim()) throw new Error(`Fill the button link value of template "${tpl.name}"`);
  const hk = headKindOf(tpl);
  const own = !!hk && hk === ownFile;
  if (hk && !own && !s.headerUrl) throw new Error(`Upload the header ${hk} of template "${tpl.name}"`);
  return {
    name: tpl.name, language: tpl.language, params: s.params.map((p) => p.trim()), ...(s.urlParam.trim() ? { url_param: s.urlParam.trim() } : {}),
    ...(hk ? { header: { type: hk, link: own ? '' : s.headerUrl, ...(hk === 'document' && !own && s.headerName ? { filename: s.headerName } : {}) } }
      : s.headerParams.length ? { header: { type: 'text', params: s.headerParams.map((p) => p.trim()) } } : {}),
  };
}

/** Turns a draft into the API's {payload, timing}. Throws a readable error when something is missing. */
function toMessage(d: Draft, templates: WaTpl[], meta: boolean) {
  const iso = (v: string) => { const ms = Date.parse(v); if (!Number.isFinite(ms)) throw new Error('Pick a valid date & time'); return new Date(ms).toISOString(); };
  let payload: Record<string, unknown>;
  if (d.kind === 'template') {
    if (!meta) throw new Error('Templates are not available');
    payload = { kind: 'template', template: toTemplate(d.tpl, templates) };
  } else {
    if (d.kind === 'text' && !d.text.trim()) throw new Error('Type the message');
    if (d.kind !== 'text' && !/^https?:\/\//i.test(d.mediaUrl)) throw new Error(`Upload the ${d.kind === 'image' ? 'photo' : d.kind} (or paste its link)`);
    let fallback;
    if (meta && d.fbOn) {
      // Never drop the 24-hour template silently (e.g. the template list hadn't loaded yet).
      if (!templates.length) throw new Error('24-hour template: no approved template loaded yet — wait a moment, or pick "Skip them"');
      try { fallback = toTemplate(d.fb, templates, d.kind); } catch (e) { throw new Error(`24-hour template: ${(e as Error).message}`); }
    }
    payload = {
      kind: d.kind, ...(d.text.trim() ? { text: d.text.trim() } : {}),
      ...(d.kind !== 'text' ? { media: { url: d.mediaUrl, ...(d.mediaName ? { filename: d.mediaName } : {}) } } : {}),
      ...(fallback ? { fallback } : {}),
    };
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
export function Composer({ recipients, templates, meta, configured, flash, onResults, onDone, label, share }: {
  recipients: { phone: string; name?: string }[]; templates: WaTpl[]; meta: boolean; configured: boolean; flash: Flash;
  onResults?: (r: Outcome[]) => void; onDone?: () => void; label?: string;
  /** Attached project link: each number gets its own link wherever {link} is written. */
  share?: { id: string; title: string; location?: string } | null;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([newDraft()]);
  // Attaching a project link fills an empty first message with a ready text carrying {link}.
  const shareText = share ? `Hi {name}, here are the details of *${share.title}*${share.location ? ` (${share.location})` : ''} — photos, brochure & more:
{link}` : '';
  useEffect(() => {
    if (!share) return;
    setDrafts((ds) => ds.map((d, i) => (i === 0 && d.kind !== 'template' && !/\{link\}/i.test(d.text) && (!d.text.trim() || d.text.startsWith('Hi {name}, here are the details of'))
      ? { ...d, text: shareText } : d)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [share?.id]);
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
  const uploading = drafts.some((d) => d.pct !== null || d.tpl.headerPct !== null || d.fb.headerPct !== null);

  async function submit() {
    if (!recipients.length) { flash('Add at least one number first', true); return; }
    if (share && !drafts.some((d) => /\{link\}/i.test(JSON.stringify([d.text, d.tpl.params, d.tpl.urlParam, d.fb.params, d.fb.urlParam])))) {
      flash('Write {link} in the message (or a template value) — that is where each person\'s project link goes', true); return;
    }
    if (!share && drafts.some((d) => /\{link\}/i.test(JSON.stringify([d.text, d.tpl.params, d.fb.params])))) {
      flash('The message has {link} but no project link is attached — create the link above first', true); return;
    }
    let messages;
    try { messages = drafts.map((d, i) => { try { return toMessage(d, templates, meta); } catch (e) { throw new Error(drafts.length > 1 ? `Message ${i + 1}: ${(e as Error).message}` : (e as Error).message); } }); } catch (e) { flash((e as Error).message, true); return; }
    const who = recipients.length === 1 ? (recipients[0].name || recipients[0].phone) : `${recipients.length.toLocaleString('en-IN')} numbers`;
    if (!window.confirm(`${allNow ? 'Send' : anyNow ? 'Send now and schedule' : 'Schedule'} ${drafts.length > 1 ? `${drafts.length} messages` : 'this message'} to ${who}?`)) return;
    setBusy(true);
    stop.current = false;
    try {
      const r = await call<{ schedule: { id: string; runs: { at: string }[] }; due_now: boolean }>(SCHED_API, {
        action: 'create', title: title.trim() || (share ? `Link: ${share.title}` : ''), recipients: recipients.map((x) => ({ phone: x.phone, name: x.name || '' })), messages,
        ...(share ? { share_id: share.id } : {}),
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
      setDrafts([share ? { ...newDraft(), text: shareText } : newDraft()]); setTitle('');
      onDone?.();
    } catch (e) {
      flash((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wa-composer">
      {share && (
        <p className="wa-note wsh-attached"><i className="fas fa-link" /> Project link <b>{share.title}</b> is attached — write <code>{'{link}'}</code> where it should go; each number gets its own link, so you can see who opened it.</p>
      )}
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

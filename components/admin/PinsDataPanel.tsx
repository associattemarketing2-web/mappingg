'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PageHead, StatCard } from './PageHead';
import { usePersistedState } from './usePersistedState';
import { requestFullEdit } from './fullEdit';
import { baseName } from '@/lib/pin-names';

// Super admin → Map & Projects → Pins Data: every map pin in number order with
// its details, so the team can check the data in one place — which pins are
// missing details, which look like the same project, which were deleted, and
// which pin numbers are unused or repeated, series by series.

type Pin = {
  id: string; number: number | null; title: string; developer: string; location: string; type: string; status: string;
  price: string; configuration: string; sqft: string; possession: string; rera: string; description: string; key_usp: string;
  image: boolean; brochure: boolean; video: boolean; located: boolean;
  hidden: boolean; pending: boolean; rejected: boolean; origin: 'intake' | 'developer' | 'map';
  created_at: string; updated_at: string; missing: string[]; score: number;
};
type DeletedPin = Pin & { history_id: string; deleted_at: string; reason: 'merged' | 'duplicate' | 'empty' | 'deleted'; duplicate_of: string };
type DupGroup = { key: string; reasons: string[]; ids: string[] };
type Data = {
  pins: Pin[]; fields: { key: string; label: string }[]; maxNumber: number; gaps: number[]; repeated: number[];
  duplicates: DupGroup[]; deleted: DeletedPin[];
};
type View = 'all' | 'complete' | 'missing' | 'notlive' | 'unused' | 'repeated' | 'duplicates' | 'deleted' | 'series';
/** Saves a quick edit to a pin and reloads the list; resolves false when it failed (the error is already shown). */
type Save = (p: Pin, values: Record<string, unknown>, done: string) => Promise<boolean>;
const SaveCtx = createContext<Save>(async () => false);
type MergeRequest = { keep: string; merge: string[]; title?: string; fillMissing: boolean; combineRera: boolean };
type MergeFn = (req: MergeRequest) => Promise<boolean>;

const SERIES = 100;
const STATUS_LABEL: Record<string, string> = { available: 'Available', construction: 'Under construction', upcoming: 'Upcoming', sold: 'Sold out' };
const ORIGIN_LABEL: Record<Pin['origin'], string> = { intake: 'Projects Intake', developer: 'Developer', map: 'Map Editor' };
const REASON_LABEL: Record<DeletedPin['reason'], string> = { merged: 'Merged', duplicate: 'Duplicate', empty: 'Empty pin', deleted: 'Deleted' };

/** Live on the public map, or why not. */
function visibility(p: Pin): { label: string; cls: string } {
  if (p.rejected) return { label: 'Rejected', cls: 'bad' };
  if (p.pending) return { label: 'Pending', cls: 'warn' };
  if (p.hidden) return { label: 'Hidden', cls: 'muted' };
  if (!p.located) return { label: 'Not placed', cls: 'warn' };
  return { label: 'Live', cls: 'ok' };
}
const isLive = (p: Pin) => visibility(p).cls === 'ok';
const quality = (score: number) => (score === 100 ? 'full' : score >= 70 ? 'part' : 'poor');
const seriesOf = (n: number) => Math.floor((n - 1) / SERIES);
const seriesLabel = (s: number) => `${s * SERIES + 1}–${(s + 1) * SERIES}`;
const shortDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
const matches = (term: string, ...vals: (string | number | null)[]) => !term || vals.some((v) => String(v ?? '').toLowerCase().includes(term));

/* ------------------------------- Pagination ------------------------------ */

const PAGE_SIZES = ['10', '25', '50', '100'] as const;
type PageSize = (typeof PAGE_SIZES)[number];

/** One page of `items`. Goes back to page 1 when `resetKey` (the filters) or the page size changes. */
function usePaged<T>(items: T[], resetKey: string, sizeKey: string, initial: PageSize = '25') {
  const [sizeS, setSize] = usePersistedState<PageSize>(`pins.${sizeKey}.perPage`, initial, PAGE_SIZES);
  const size = Number(sizeS);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [resetKey, size]);
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const pg = Math.min(page, pageCount);
  const first = (pg - 1) * size;
  return { rows: items.slice(first, first + size), total: items.length, first, pg, pageCount, setPage, sizeS, setSize };
}
type Paged = Omit<ReturnType<typeof usePaged>, 'rows'>;

/** "Showing 26–50 of 918 pins", page buttons (1 … 4 5 6 … 37) and rows per page. */
function Pager({ p, noun }: { p: Paged; noun: string }) {
  if (!p.total) return null;
  const { pg, pageCount } = p;
  const list: (number | '…')[] = pageCount <= 7
    ? Array.from({ length: pageCount }, (_, i) => i + 1)
    : pg <= 4 ? [1, 2, 3, 4, 5, '…', pageCount]
      : pg >= pageCount - 3 ? [1, '…', pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount]
        : [1, '…', pg - 1, pg, pg + 1, '…', pageCount];
  // Keep the list's top in view when the page changes.
  const go = (n: number, e: React.MouseEvent) => {
    p.setPage(n);
    const card = (e.currentTarget as HTMLElement).closest('.pg-card');
    if (card && card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: 'start' });
  };
  return (
    <div className="crm3-foot pd-pager">
      <span className="crm3-count">
        Showing {(p.first + 1).toLocaleString('en-IN')}–{Math.min(p.first + Number(p.sizeS), p.total).toLocaleString('en-IN')} of {p.total.toLocaleString('en-IN')} {noun}
      </span>
      {pageCount > 1 && (
        <nav className="crm3-pages" aria-label="Pages">
          <button type="button" disabled={pg <= 1} onClick={(e) => go(pg - 1, e)} aria-label="Previous page"><i className="fas fa-chevron-left" /></button>
          {list.map((n, i) => (n === '…'
            ? <span key={`gap${i}`} className="gap">…</span>
            : <button key={n} type="button" className={n === pg ? 'on' : ''} aria-current={n === pg ? 'page' : undefined} onClick={(e) => go(n, e)}>{n}</button>))}
          <button type="button" disabled={pg >= pageCount} onClick={(e) => go(pg + 1, e)} aria-label="Next page"><i className="fas fa-chevron-right" /></button>
        </nav>
      )}
      <label className="crm3-per">Per page
        <select className="crm-select" value={p.sizeS} onChange={(e) => p.setSize(e.target.value as PageSize)}>
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </div>
  );
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: 'same-origin', ...init });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || b.error) throw new Error(b?.error?.message || `Request failed (${r.status})`);
  return b.data as T;
}

export default function PinsDataPanel({ flash }: { flash: (m: string, err?: boolean) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('all');
  // A number picked in Series → "Use this number" opens Unused with it selected.
  const [unusedPick, setUnusedPick] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    setLoading(true); setError('');
    api<Data>('/api/admin/pins-data')
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the pins'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const pins = useMemo(() => data?.pins || [], [data]);
  const fieldLabel = useMemo(() => Object.fromEntries((data?.fields || []).map((f) => [f.key, f.label])), [data]);
  const complete = pins.filter((p) => p.score === 100).length;
  const notLive = pins.filter((p) => !isLive(p)).length;
  const dupPins = (data?.duplicates || []).reduce((a, g) => a + g.ids.length, 0);
  const repeatedPins = pins.filter((p) => p.number != null && data?.repeated.includes(p.number)).length;

  const save: Save = async (p, values, done) => {
    setBusy(p.id);
    try {
      await api('/api/admin/pins-data', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, values }) });
      flash(done);
      load();
      return true;
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save the pin', true);
      return false;
    } finally { setBusy(null); }
  };

  const removePin = async (p: Pin) => {
    if (!confirm(`Delete pin #${p.number ?? '—'} "${p.title || 'no name'}"? It goes to Deleted pins and can be restored from there.`)) return;
    setBusy(p.id);
    try { await api(`/api/admin/pins-data?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' }); flash(`Pin #${p.number ?? '—'} deleted`); load(); }
    catch (e) { flash(e instanceof Error ? e.message : 'Could not delete the pin', true); }
    finally { setBusy(null); }
  };
  const mergePins: MergeFn = async (req) => {
    setBusy('merge');
    try {
      const res = await api<{ merged: number; filled: string[] }>('/api/admin/pins-data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'merge', ...req }),
      });
      flash(`${res.merged} pin${res.merged === 1 ? '' : 's'} merged${res.filled.length ? ` · ${res.filled.length} details filled in` : ''}`);
      load();
      return true;
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not merge the pins', true);
      return false;
    } finally { setBusy(null); }
  };
  const restorePin = async (p: DeletedPin) => {
    setBusy(p.history_id);
    try {
      await api('/api/rpc/restore_pin_from_history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_history_id: p.history_id }) });
      flash(`Pin #${p.number ?? '—'} restored`); load();
    } catch (e) { flash(e instanceof Error ? e.message : 'Could not restore the pin', true); }
    finally { setBusy(null); }
  };

  const tabs: { key: View; label: string; icon: string; count?: number; alert?: boolean }[] = [
    { key: 'all', label: 'All pins', icon: 'fa-list-ol', count: pins.length },
    { key: 'complete', label: 'Complete data', icon: 'fa-circle-check', count: complete },
    { key: 'missing', label: 'Missing data', icon: 'fa-triangle-exclamation', count: pins.length - complete, alert: true },
    { key: 'notlive', label: 'Not live', icon: 'fa-eye-slash', count: notLive, alert: true },
    { key: 'unused', label: 'Unused numbers', icon: 'fa-hashtag', count: data?.gaps.length || 0, alert: true },
    { key: 'repeated', label: 'Repeated numbers', icon: 'fa-clone', count: data?.repeated.length || 0, alert: true },
    { key: 'duplicates', label: 'Duplicates', icon: 'fa-object-group', count: data?.duplicates.length || 0, alert: true },
    { key: 'deleted', label: 'Deleted', icon: 'fa-trash-can', count: data?.deleted.length || 0 },
    { key: 'series', label: 'Series', icon: 'fa-table-cells' },
  ];

  return (
    <div className="pg-wrap pd-wrap">
      <PageHead icon="fa-table-list" title="Pins Data" sub="Every map pin in number order — its details, missing data, duplicates, deleted pins and unused numbers.">
        <button type="button" className="pg-btn ghost" onClick={load} disabled={loading}><i className={`fas fa-rotate${loading ? ' fa-spin' : ''}`} /> Refresh</button>
        <button type="button" className="pg-btn" onClick={() => data && exportCsv(pins, fieldLabel)} disabled={!pins.length}><i className="fas fa-file-arrow-down" /> Export CSV</button>
      </PageHead>

      {error ? (
        <div className="pg-card adm-empty"><i className="fas fa-triangle-exclamation" /><p>{error}</p></div>
      ) : !data ? (
        <div className="pg-card adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading pins…</p></div>
      ) : (
        <>
          <div className="sc-row pd-stats">
            <StatCard icon="fa-location-dot" tone="violet" value={pins.length.toLocaleString('en-IN')} label="Total pins" on={view === 'all'} onClick={() => setView('all')} />
            <StatCard icon="fa-triangle-exclamation" tone="amber" value={(pins.length - complete).toLocaleString('en-IN')} label="Data missing" on={view === 'missing'} onClick={() => setView('missing')} title={`${complete} pins have every detail filled in`} />
            <StatCard icon="fa-eye-slash" tone="rose" value={notLive} label="Not live on map" on={view === 'notlive'} onClick={() => setView('notlive')} title="Hidden, pending review, rejected or not placed on the map" />
            <StatCard icon="fa-hashtag" tone="teal" value={data.gaps.length} label="Unused pin numbers" on={view === 'unused'} onClick={() => setView('unused')} title={`Numbers between 1 and ${data.maxNumber} with no pin`} />
            <StatCard icon="fa-clone" tone="blue" value={data.repeated.length} label="Repeated numbers" on={view === 'repeated'} onClick={() => setView('repeated')} title={`${repeatedPins} pins share these numbers`} />
            <StatCard icon="fa-object-group" tone="green" value={data.duplicates.length} label="Duplicate groups" on={view === 'duplicates'} onClick={() => setView('duplicates')} title={`${dupPins} pins that look like the same project`} />
          </div>

          <div className="pd-tabs" role="tablist" aria-label="Pins Data views">
            {tabs.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={view === t.key} className={view === t.key ? 'on' : ''} onClick={() => setView(t.key)}>
                <i className={`fas ${t.icon}`} /> {t.label}
                {t.count != null && <em className={t.alert && t.count > 0 ? 'alert' : ''}>{t.count.toLocaleString('en-IN')}</em>}
              </button>
            ))}
          </div>

          <SaveCtx.Provider value={save}>
            {view === 'all' && <AllPins data={data} fieldLabel={fieldLabel} />}
            {view === 'complete' && <Complete data={data} fieldLabel={fieldLabel} />}
            {view === 'missing' && <MissingData data={data} fieldLabel={fieldLabel} />}
            {view === 'notlive' && <NotLive data={data} fieldLabel={fieldLabel} busy={busy} />}
            {view === 'unused' && <Unused data={data} busy={busy} initialPick={unusedPick} />}
            {view === 'repeated' && <Repeated data={data} busy={busy} />}
            {view === 'duplicates' && <Duplicates data={data} busy={busy} onDelete={removePin} onMerge={mergePins} />}
            {view === 'deleted' && <Deleted data={data} busy={busy} onRestore={restorePin} />}
            {view === 'series' && <Series data={data} fieldLabel={fieldLabel} onUseNumber={(n) => { setUnusedPick(n); setView('unused'); }} />}
          </SaveCtx.Provider>
        </>
      )}
    </div>
  );
}

/* ------------------------------- All pins ------------------------------- */

type ShowFilter = '' | 'live' | 'hidden' | 'pending';

function AllPins({ data, fieldLabel }: { data: Data; fieldLabel: Record<string, string> }) {
  const [q, setQ] = useState('');
  const [series, setSeries] = useState<number | null>(null);
  const [quality_, setQuality] = useState<'' | 'complete' | 'incomplete' | 'poor'>('');
  const [show, setShow] = useState<ShowFilter>('');
  const [sort, setSort] = useState<'num' | 'num-desc' | 'score' | 'new'>('num');
  const seriesCount = Math.max(1, Math.ceil(data.maxNumber / SERIES));
  const term = q.trim().toLowerCase();

  const list = data.pins.filter((p) => {
    if (series != null && (p.number == null || seriesOf(p.number) !== series)) return false;
    if (show === 'live' && visibility(p).cls !== 'ok') return false;
    if (show === 'hidden' && !p.hidden) return false;
    if (show === 'pending' && !p.pending && !p.rejected) return false;
    if (quality_ === 'complete' && p.score !== 100) return false;
    if (quality_ === 'incomplete' && p.score === 100) return false;
    if (quality_ === 'poor' && p.score >= 70) return false;
    return matches(term, p.title, p.developer, p.location, p.rera, p.type, p.number);
  }).sort((a, b) => {
    if (sort === 'num-desc') return (b.number ?? -1) - (a.number ?? -1);
    if (sort === 'score') return a.score - b.score || (a.number ?? Infinity) - (b.number ?? Infinity);
    if (sort === 'new') return b.created_at.localeCompare(a.created_at);
    return (a.number ?? Infinity) - (b.number ?? Infinity);
  });

  return (
    <section className="pg-card">
      <div className="pd-toolbar">
        <label className="pg-search grow">
          <i className="fas fa-magnifying-glass" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pin number, name, developer, location or RERA…" aria-label="Search pins" />
        </label>
        <select className="ov-select" value={series ?? ''} onChange={(e) => setSeries(e.target.value === '' ? null : Number(e.target.value))} aria-label="Series">
          <option value="">All numbers</option>
          {Array.from({ length: seriesCount }, (_, s) => <option key={s} value={s}>Pins {seriesLabel(s)}</option>)}
        </select>
        <select className="ov-select" value={quality_} onChange={(e) => setQuality(e.target.value as typeof quality_)} aria-label="Data">
          <option value="">Any data</option>
          <option value="complete">Complete data</option>
          <option value="incomplete">Some data missing</option>
          <option value="poor">Mostly empty</option>
        </select>
        <select className="ov-select" value={show} onChange={(e) => setShow(e.target.value as ShowFilter)} aria-label="On map">
          <option value="">Live & hidden</option>
          <option value="live">Live on map</option>
          <option value="hidden">Hidden</option>
          <option value="pending">Pending / rejected</option>
        </select>
        <select className="ov-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
          <option value="num">Pin # ascending</option>
          <option value="num-desc">Pin # descending</option>
          <option value="score">Least data first</option>
          <option value="new">Newest first</option>
        </select>
      </div>
      <PinTable rows={list} fieldLabel={fieldLabel} repeated={data.repeated} resetKey={`${q}|${series}|${quality_}|${show}|${sort}`} />
    </section>
  );
}

/** The pin list: number, project, location, details, media, map state, data score. Click a row for everything else. */
function PinTable({ rows, fieldLabel, repeated, resetKey, highlight, action }: {
  rows: Pin[]; fieldLabel: Record<string, string>; repeated: number[]; resetKey: string; highlight?: string;
  /** An extra button before Update (e.g. Make live). */
  action?: (p: Pin) => ReactNode;
}) {
  const page = usePaged(rows, resetKey, 'table');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setOpen(null), [resetKey, page.pg]);
  const rep = new Set(repeated);
  if (!rows.length) return <div className="adm-empty"><i className="fas fa-filter" /><p>No pins match these filters.</p></div>;
  return (
    <>
      <div className="table-scroll">
        <table className="pg-table pd-table">
          <thead>
            <tr><th>Pin</th><th>Project</th><th>Location</th><th>Type · Status</th><th>Price · Size</th><th>RERA</th><th>Media</th><th>Map</th><th>Data</th><th /></tr>
          </thead>
          <tbody>
            {page.rows.map((p) => {
              const vis = visibility(p);
              const isOpen = open === p.id;
              return [
                <tr key={p.id} className={isOpen ? 'pd-open' : ''} onClick={() => setOpen(isOpen ? null : p.id)}>
                  <td className="pd-num">
                    {p.number != null ? `#${p.number}` : <span className="pd-miss">No #</span>}
                    {p.number != null && rep.has(p.number) && <span className="pd-flag" title="Another pin has this number too">2×</span>}
                  </td>
                  <td className="pd-proj"><b>{p.title || <span className="pd-miss">No name</span>}</b><small>{p.developer || <span className="pd-miss">No developer</span>}</small></td>
                  <td className="pd-loc"><span>{p.location || <span className="pd-miss">No location</span>}</span>{!p.located && <small className="pd-miss">Not placed on map</small>}</td>
                  <td>{p.type || '—'}<small>{STATUS_LABEL[p.status] || p.status || '—'}</small></td>
                  <td className="pd-price">{p.price || <span className="pd-miss">No price</span>}<small>{[p.configuration, p.sqft].filter(Boolean).join(' · ') || '—'}</small></td>
                  <td className="pd-rera">{p.rera || <span className="pd-miss">—</span>}</td>
                  <td className="pd-media">
                    <i className={`fas fa-image${p.image ? ' on' : ''}`} title={p.image ? 'Has a photo' : 'No photo'} />
                    <i className={`fas fa-file-pdf${p.brochure ? ' on' : ''}`} title={p.brochure ? 'Has a brochure' : 'No brochure'} />
                    <i className={`fab fa-youtube${p.video ? ' on' : ''}`} title={p.video ? 'Has a video' : 'No video'} />
                  </td>
                  <td><span className={`pd-pill ${vis.cls}`}>{vis.label}</span></td>
                  <td>
                    <span className={`pd-meter ${quality(p.score)}`} title={p.missing.length ? `Missing: ${p.missing.map((k) => fieldLabel[k] || k).join(', ')}` : 'Every detail filled'}>
                      <span style={{ width: `${p.score}%` }} />
                    </span>
                    <small>{p.score}%{highlight && p.missing.includes(highlight) ? ` · no ${(fieldLabel[highlight] || highlight).toLowerCase()}` : ''}</small>
                  </td>
                  <td className="pd-acts" onClick={(e) => e.stopPropagation()}>{action?.(p)}<button type="button" className={`adm-btn sm ${isOpen ? 'primary' : 'ghost'}`} onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : p.id); }} title="Fill in or change this pin's details"><i className={`fas ${isOpen ? 'fa-xmark' : 'fa-pen'}`} /> {isOpen ? 'Close' : 'Update'}</button></td>
                </tr>,
                isOpen && (
                  <tr key={`${p.id}-d`} className="pd-detail">
                    <td colSpan={10}>
                      <QuickEdit p={p} fieldLabel={fieldLabel} onClose={() => setOpen(null)} />
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
      <Pager p={page} noun="pins" />
    </>
  );
}

/* ----------------------------- Complete data ---------------------------- */

/** Pins with every detail filled in — the finished ones. */
function Complete({ data, fieldLabel }: { data: Data; fieldLabel: Record<string, string> }) {
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'' | 'live' | 'notlive'>('');
  const term = q.trim().toLowerCase();
  const all = data.pins.filter((p) => p.score === 100);
  const live = all.filter(isLive).length;
  const list = all.filter((p) => (!show || (show === 'live') === isLive(p)) && matches(term, p.title, p.developer, p.location, p.rera, p.number));

  return (
    <section className="pg-card">
      <div className="pg-card-head">
        <div><h3>Pins with complete data</h3>
          <p className="pd-sub">{all.length.toLocaleString('en-IN')} of {data.pins.length.toLocaleString('en-IN')} pins ({data.pins.length ? Math.round((all.length / data.pins.length) * 100) : 0}%) have every detail filled in — {data.fields.map((f) => f.label).join(', ')}.</p></div>
      </div>
      <div className="pd-toolbar">
        <label className="pg-search grow">
          <i className="fas fa-magnifying-glass" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search complete pins…" aria-label="Search complete pins" />
        </label>
        <div className="pd-seg" role="group" aria-label="On the map">
          <button type="button" className={!show ? 'on' : ''} onClick={() => setShow('')}>All <em>{all.length}</em></button>
          <button type="button" className={show === 'live' ? 'on' : ''} onClick={() => setShow('live')}>Live <em>{live}</em></button>
          {all.length > live && <button type="button" className={show === 'notlive' ? 'on' : ''} onClick={() => setShow('notlive')}>Not live <em>{all.length - live}</em></button>}
        </div>
      </div>
      {!all.length
        ? <div className="adm-empty"><i className="fas fa-list-check" /><p>No pin has every detail filled in yet.</p></div>
        : <PinTable rows={list} fieldLabel={fieldLabel} repeated={data.repeated} resetKey={`${q}|${show}`} />}
    </section>
  );
}

/* ----------------------------- Missing data ----------------------------- */

function MissingData({ data, fieldLabel }: { data: Data; fieldLabel: Record<string, string> }) {
  const stats = data.fields.map((f) => {
    const miss = data.pins.filter((p) => p.missing.includes(f.key)).length;
    return { ...f, miss, pct: data.pins.length ? Math.round(((data.pins.length - miss) / data.pins.length) * 100) : 100 };
  });
  const [field, setField] = useState(() => [...stats].sort((a, b) => b.miss - a.miss)[0]?.key || 'title');
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const list = data.pins.filter((p) => p.missing.includes(field) && matches(term, p.title, p.developer, p.location, p.number));
  const label = fieldLabel[field] || field;

  return (
    <>
      <div className="pd-fieldgrid">
        {stats.map((f) => (
          <button key={f.key} type="button" className={`pd-fcard${field === f.key ? ' on' : ''}`} onClick={() => setField(f.key)} aria-pressed={field === f.key}>
            <span className="pd-fhead"><b>{f.label}</b><em className={quality(f.pct >= 90 ? 100 : f.pct >= 60 ? 70 : 0)}>{f.pct}%</em></span>
            <span className={`pd-meter wide ${f.pct >= 90 ? 'full' : f.pct >= 60 ? 'part' : 'poor'}`}><span style={{ width: `${f.pct}%` }} /></span>
            <small>{f.miss ? `${f.miss.toLocaleString('en-IN')} pin${f.miss === 1 ? '' : 's'} missing` : 'Filled on every pin'}</small>
          </button>
        ))}
      </div>
      <section className="pg-card">
        <div className="pd-toolbar">
          <h3 className="pd-h">Pins without {label.toLowerCase()}</h3>
          <label className="pg-search">
            <i className="fas fa-magnifying-glass" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search these pins…" aria-label="Search pins" />
          </label>
        </div>
        {!list.length && !term
          ? <div className="adm-empty"><i className="fas fa-circle-check" /><p>Every pin has {label.toLowerCase()}.</p></div>
          : <PinTable rows={list} fieldLabel={fieldLabel} repeated={data.repeated} resetKey={`${field}|${q}`} highlight={field} />}
      </section>
    </>
  );
}

/* ------------------------------ Duplicates ------------------------------ */

const REASON_TONE: Record<string, string> = { 'Same RERA number': '', 'Same name': '', 'Phases of one project': ' phase', 'Same location': ' soft' };
const FILL_LABEL: Record<string, string> = {
  developer: 'Developer', location: 'Location', image: 'Photo', price: 'Price', configuration: 'Configuration',
  sqft: 'Area', possession: 'Possession', description: 'Description',
};

/** Pins to merge, with the one to keep; the rest are folded into it. */
function Duplicates({ data, busy, onDelete, onMerge }: { data: Data; busy: string | null; onDelete: (p: Pin) => void; onMerge: MergeFn }) {
  const byId = useMemo(() => new Map(data.pins.map((p) => [p.id, p])), [data]);
  const groups = data.duplicates.map((g) => ({ ...g, pins: g.ids.map((id) => byId.get(id)).filter(Boolean) as Pin[] }));
  const [reason, setReason] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [keep, setKeep] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();

  // Drop pins that no longer exist (after a merge or delete).
  useEffect(() => {
    setPicked((list) => list.filter((id) => byId.has(id)));
    setKeep((k) => (k && byId.has(k) ? k : null));
  }, [byId]);

  const pickedPins = picked.map((id) => byId.get(id)).filter(Boolean) as Pin[];
  const keepPin = (keep && byId.get(keep)) || pickedPins.reduce<Pin | null>((a, b) => (!a || b.score > a.score ? b : a), null);
  const toggle = (p: Pin) => setPicked((list) => (list.includes(p.id) ? list.filter((x) => x !== p.id) : [...list, p.id]));
  const pickGroup = (pins: Pin[]) => {
    setPicked(pins.map((p) => p.id));
    setKeep(pins.reduce((a, b) => (b.score > a.score ? b : a), pins[0]).id);
    requestAnimationFrame(() => document.getElementById('pd-merge')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const reasons = [...new Set(groups.flatMap((g) => g.reasons))];
  const shown = groups.filter((g) => !reason || g.reasons.includes(reason));
  const results = term.length < 2 ? [] : data.pins.filter((p) => matches(term, p.title, p.developer, p.rera, p.number));
  const found = usePaged(results, term, 'find', '10');
  const groupPage = usePaged(shown, reason, 'groups', '10');

  return (
    <>
      {pickedPins.length > 0 && keepPin && (
        <MergeBox key={picked.join(',')} pins={pickedPins} keep={keepPin} busy={busy === 'merge'}
          onKeep={setKeep} onRemove={toggle} onClear={() => { setPicked([]); setKeep(null); }}
          onMerge={(req) => onMerge(req).then((ok) => { if (ok) { setPicked([]); setKeep(null); } return ok; })} />
      )}

      <section className="pg-card">
        <div className="pg-card-head">
          <div><h3>Find pins to merge</h3><p className="pd-sub">Search any project — e.g. its name without the phase — and add the pins that are really one project.</p></div>
        </div>
        <label className="pg-search grow pd-findbox">
          <i className="fas fa-magnifying-glass" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search project name, developer, RERA or pin number…" aria-label="Find pins to merge" />
        </label>
        {term.length >= 2 && (
          <ul className="pd-movelist pd-found">
            {found.rows.map((p) => (
              <li key={p.id}>
                <span className="pd-num">{p.number != null ? `#${p.number}` : '—'}</span>
                <span className="pd-dmain"><b>{p.title || 'No name'}</b><small>{[p.developer, p.location].filter(Boolean).join(' · ') || '—'}</small></span>
                <button type="button" className={`adm-btn sm ${picked.includes(p.id) ? 'primary' : 'ghost'}`} onClick={() => toggle(p)}>
                  <i className={`fas ${picked.includes(p.id) ? 'fa-check' : 'fa-plus'}`} /> {picked.includes(p.id) ? 'Added' : 'Add to merge'}
                </button>
              </li>
            ))}
            {!results.length && <li className="muted">No pins match “{q.trim()}”.</li>}
          </ul>
        )}
        {term.length >= 2 && <Pager p={found} noun="matches" />}
      </section>

      <section className="pg-card">
        <div className="pg-card-head">
          <div><h3>Possible duplicate projects</h3><p className="pd-sub">Pins with the same RERA number, the same name nearby, phases of one project, or on the same spot. Merge the ones that are one project, or delete an extra pin.</p></div>
        </div>
        {reasons.length > 1 && (
          <div className="pd-toolbar">
            <div className="pd-seg" role="group" aria-label="Why they match">
              <button type="button" className={!reason ? 'on' : ''} onClick={() => setReason('')}>All <em>{groups.length}</em></button>
              {reasons.map((r) => (
                <button key={r} type="button" className={reason === r ? 'on' : ''} onClick={() => setReason(r)}>{r} <em>{groups.filter((g) => g.reasons.includes(r)).length}</em></button>
              ))}
            </div>
          </div>
        )}
        {!shown.length ? (
          <div className="adm-empty"><i className="fas fa-circle-check" /><p>No duplicate projects found.</p></div>
        ) : (
          <div className="pd-groups">
            {groupPage.rows.map((g) => {
              const best = g.pins.reduce((a, b) => (b.score > a.score ? b : a), g.pins[0]);
              const inMerge = g.pins.every((p) => picked.includes(p.id));
              return (
                <div className={`pd-group${inMerge ? ' picked' : ''}`} key={g.key}>
                  <div className="pd-ghead">
                    {g.reasons.map((r) => <span key={r} className={`pd-reason${REASON_TONE[r] ?? ''}`}>{r}</span>)}
                    <small>{g.pins.length} pins</small>
                    <button type="button" className={`adm-btn sm ${inMerge ? 'primary' : 'ghost'}`} onClick={() => pickGroup(g.pins)}>
                      <i className="fas fa-object-group" /> {inMerge ? 'Selected' : 'Merge these'}
                    </button>
                  </div>
                  {g.pins.map((p) => (
                    <DupRow key={p.id} p={p} keep={p.id === best.id} busy={busy === p.id} picked={picked.includes(p.id)}
                      onToggle={() => toggle(p)} onDelete={() => onDelete(p)} />
                  ))}
                </div>
              );
            })}
          </div>
        )}
        {shown.length > 0 && <Pager p={groupPage} noun="groups" />}
      </section>
    </>
  );
}

/** The merge panel: which pin stays, its final name, what it takes from the others. */
function MergeBox({ pins, keep, busy, onKeep, onRemove, onClear, onMerge }: {
  pins: Pin[]; keep: Pin; busy: boolean; onKeep: (id: string) => void; onRemove: (p: Pin) => void; onClear: () => void;
  onMerge: (req: MergeRequest) => Promise<boolean>;
}) {
  const others = pins.filter((p) => p.id !== keep.id);
  const common = baseName(keep.title);
  const [title, setTitle] = useState(keep.title);
  const [fill, setFill] = useState(true);
  const [rera, setRera] = useState(true);
  useEffect(() => setTitle(keep.title), [keep.id, keep.title]);
  // What the kept pin is missing that another pin has.
  const gains = keep.missing.filter((k) => k !== 'title' && k !== 'rera' && others.some((o) => !o.missing.includes(k)));
  const reraCount = new Set(pins.flatMap((p) => p.rera.split(/[\s,;|]+/).filter((x) => x.length > 6 && !/launch/i.test(x)))).size;

  const submit = () => {
    if (!others.length) return;
    const names = others.map((o) => `#${o.number ?? '—'} ${o.title}`).join('\n');
    if (!confirm(`Merge into #${keep.number ?? '—'} "${title || keep.title}"?\n\nThese pins will be removed from the map (restorable from Deleted pins):\n${names}`)) return;
    onMerge({ keep: keep.id, merge: others.map((o) => o.id), title: title.trim() !== keep.title ? title.trim() : undefined, fillMissing: fill, combineRera: rera });
  };

  return (
    <section className="pg-card pd-merge" id="pd-merge">
      <div className="pg-card-head">
        <div><h3><i className="fas fa-object-group" /> Merge {pins.length} pins into one project</h3>
          <p className="pd-sub">Pick the pin to keep. The others are folded into it and removed from the map — you can restore them from Deleted pins.</p></div>
        <button type="button" className="adm-btn ghost sm" onClick={onClear}><i className="fas fa-xmark" /> Clear</button>
      </div>
      <div className="pd-mergelist" role="radiogroup" aria-label="Pin to keep">
        {pins.map((p) => (
          <label key={p.id} className={`pd-mergepin${p.id === keep.id ? ' keep' : ''}`}>
            <input type="radio" name="pd-keep" checked={p.id === keep.id} onChange={() => onKeep(p.id)} />
            <span className="pd-num">{p.number != null ? `#${p.number}` : '—'}</span>
            <span className="pd-dmain"><b>{p.title || 'No name'}</b><small>{[p.developer, p.location].filter(Boolean).join(' · ') || '—'} · {p.score}% data</small></span>
            <span className={`pd-pill ${p.id === keep.id ? 'ok' : 'dup'}`}>{p.id === keep.id ? 'Keep' : 'Merge in'}</span>
            <button type="button" className="pd-x" onClick={(e) => { e.preventDefault(); onRemove(p); }} aria-label={`Remove ${p.title} from the merge`}><i className="fas fa-xmark" /></button>
          </label>
        ))}
      </div>
      {pins.length < 2 ? (
        <p className="pd-sub">Add at least one more pin — from a group below or with Find pins to merge.</p>
      ) : (
        <>
          <div className="pd-mergeopts">
            <label className="pd-qe-f">
              <span>Project name after merging</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
              {common && common !== title && (
                <button type="button" className="pd-suggest" onClick={() => setTitle(common)}>Use “{common}”</button>
              )}
            </label>
            <div className="pd-checks">
              <label><input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} /> Fill empty details from the other pins
                {fill && <small>{gains.length ? gains.map((k) => FILL_LABEL[k] || k).join(', ') : 'Nothing to fill — the kept pin has these details'}</small>}</label>
              <label><input type="checkbox" checked={rera} onChange={(e) => setRera(e.target.checked)} /> Keep every RERA number on the merged pin
                {rera && <small>{reraCount} RERA number{reraCount === 1 ? '' : 's'}</small>}</label>
            </div>
          </div>
          <div className="pd-qe-foot">
            <span className="pd-sub">#{keep.number ?? '—'} stays · {others.map((o) => `#${o.number ?? '—'}`).join(', ')} {others.length === 1 ? 'is' : 'are'} merged in</span>
            <button type="button" className="adm-btn primary" onClick={submit} disabled={busy || !title.trim()}>
              <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-object-group'}`} /> Merge {pins.length} pins
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function DupRow({ p, keep, busy, picked, onToggle, onDelete }: {
  p: Pin; keep?: boolean; busy: boolean; picked: boolean; onToggle: () => void; onDelete: () => void;
}) {
  const vis = visibility(p);
  return (
    <div className={`pd-drow${picked ? ' picked' : ''}`}>
      <label className="pd-num pd-pickbox" title="Select for merging">
        <input type="checkbox" checked={picked} onChange={onToggle} aria-label={`Select ${p.title} for merging`} />
        {p.number != null ? `#${p.number}` : '—'}
      </label>
      <span className="pd-dmain">
        <b>{p.title || 'No name'}{keep && <span className="pd-keep" title="Most complete pin in this group">Most data</span>}</b>
        <small>{[p.developer, p.location].filter(Boolean).join(' · ') || '—'}</small>
        {p.rera && <small className="pd-rera">RERA {p.rera}</small>}
      </span>
      <span className="pd-dside">
        <span className={`pd-pill ${vis.cls}`}>{vis.label}</span>
        <span className={`pd-meter ${quality(p.score)}`} title={`${p.score}% of the details filled`}><span style={{ width: `${p.score}%` }} /></span>
        <small>{p.score}%</small>
      </span>
      <span className="pd-dacts">
        <button type="button" className="adm-btn ghost sm" onClick={() => requestFullEdit(p.id)}><i className="fas fa-pen" /> Edit</button>
        <button type="button" className="adm-btn danger sm" onClick={onDelete} disabled={busy}><i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-trash'}`} /> Delete</button>
      </span>
    </div>
  );
}


/* ------------------------------ Quick edit ------------------------------ */

const QUICK_FIELDS: { key: string; label: string; wide?: boolean; area?: boolean; hint?: string }[] = [
  { key: 'title', label: 'Project name' }, { key: 'developer', label: 'Developer' },
  { key: 'location', label: 'Location', wide: true, hint: 'Locality, City' },
  { key: 'price', label: 'Price', hint: '₹ 1.2 Cr Onwards' }, { key: 'configuration', label: 'Configuration', hint: '2 / 3 BHK' },
  { key: 'sqft', label: 'Area (sq ft)', hint: '850 - 1200 Sq Ft' }, { key: 'possession', label: 'Possession', hint: 'Dec 2028' },
  { key: 'rera', label: 'RERA no.' },
  { key: 'key_usp', label: 'Key USP', wide: true },
  { key: 'description', label: 'Description', wide: true, area: true },
];

/** Fill in or change a pin's details right in the list; photo and map position stay in the full form. */
function QuickEdit({ p, fieldLabel, onClose }: { p: Pin; fieldLabel: Record<string, string>; onClose: () => void }) {
  const save = useContext(SaveCtx);
  const start = useMemo(() => ({
    title: p.title, developer: p.developer, location: p.location, price: p.price, configuration: p.configuration,
    sqft: p.sqft, possession: p.possession, rera: p.rera, key_usp: p.key_usp, description: p.description,
    number: p.number != null ? String(p.number) : '',
  }), [p]);
  const [form, setForm] = useState<Record<string, string>>(start);
  const [live, setLive] = useState(isLive(p));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm(start); setLive(isLive(p)); }, [start, p]);

  const changed: Record<string, unknown> = {};
  for (const k of Object.keys(start) as (keyof typeof start)[]) if (form[k].trim() !== start[k]) changed[k] = k === 'number' ? Number(form[k]) : form[k];
  if (live !== isLive(p)) changed.live = live;
  const dirty = Object.keys(changed).length > 0;
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    setSaving(true);
    if (await save(p, changed, `Pin #${changed.number ?? p.number ?? '—'} updated`)) onClose();
    setSaving(false);
  };

  return (
    <form className="pd-qe" onSubmit={submit}>
      <div className="pd-qe-head">
        <b>Update pin #{p.number ?? '—'}</b>
        {p.missing.length > 0
          ? <span>Missing: {p.missing.map((k) => <span key={k} className="pd-tag">{fieldLabel[k] || k}</span>)}</span>
          : <span className="pd-ok"><i className="fas fa-circle-check" /> Every detail filled</span>}
        <small>Added from {ORIGIN_LABEL[p.origin]} · created {shortDate(p.created_at)} · updated {shortDate(p.updated_at)}</small>
      </div>
      <div className="pd-qe-grid">
        <label className="pd-qe-f num">
          <span>Pin number</span>
          <input type="number" min={1} value={form.number} onChange={(e) => set('number', e.target.value)} />
        </label>
        {QUICK_FIELDS.map((f) => {
          const need = !form[f.key]?.trim() && (p.missing.includes(f.key) || f.key === 'title');
          return (
            <label key={f.key} className={`pd-qe-f${f.wide ? ' wide' : ''}${need ? ' need' : ''}`}>
              <span>{f.label}{need && <em>missing</em>}</span>
              {f.area
                ? <textarea rows={3} value={form[f.key]} onChange={(e) => set(f.key, e.target.value)} placeholder={f.hint} />
                : <input value={form[f.key]} onChange={(e) => set(f.key, e.target.value)} placeholder={f.hint} />}
            </label>
          );
        })}
      </div>
      <div className="pd-qe-foot">
        <label className={`pd-switch${!p.located ? ' off' : ''}`} title={p.located ? '' : 'Place the pin on the map from Edit all details first'}>
          <input type="checkbox" checked={live} disabled={!p.located} onChange={(e) => setLive(e.target.checked)} />
          <span className="pd-switch-ui" aria-hidden="true" />
          {p.located ? 'Show on the public map' : 'Not placed on the map yet'}
        </label>
        <span className="pd-qe-btns">
          <button type="button" className="adm-btn ghost sm" onClick={() => requestFullEdit(p.id)} title="Photo, brochure, video, map position and every other field">
            <i className="fas fa-up-right-from-square" /> Edit all details
          </button>
          <button type="button" className="adm-btn ghost sm" onClick={onClose}>Cancel</button>
          <button type="submit" className="adm-btn primary sm" disabled={!dirty || saving}>
            <i className={`fas ${saving ? 'fa-spinner fa-spin' : 'fa-check'}`} /> Save
          </button>
        </span>
      </div>
    </form>
  );
}

/* -------------------------------- Not live ------------------------------- */

type NotLiveWhy = '' | 'hidden' | 'pending' | 'rejected' | 'unplaced';
const whyNotLive = (p: Pin): Exclude<NotLiveWhy, ''> =>
  p.rejected ? 'rejected' : p.pending ? 'pending' : p.hidden ? 'hidden' : 'unplaced';
const NOT_LIVE_LABEL: Record<Exclude<NotLiveWhy, ''>, string> = {
  hidden: 'Hidden', pending: 'Pending review', rejected: 'Rejected', unplaced: 'Not placed on map',
};

function NotLive({ data, fieldLabel, busy }: { data: Data; fieldLabel: Record<string, string>; busy: string | null }) {
  const save = useContext(SaveCtx);
  const [why, setWhy] = useState<NotLiveWhy>('');
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const all = data.pins.filter((p) => !isLive(p));
  const list = all.filter((p) => (!why || whyNotLive(p) === why) && matches(term, p.title, p.developer, p.location, p.number));
  const count = (w: Exclude<NotLiveWhy, ''>) => all.filter((p) => whyNotLive(p) === w).length;

  return (
    <section className="pg-card">
      <div className="pg-card-head">
        <div><h3>Pins not live on the map</h3><p className="pd-sub">Hidden, waiting for review, rejected, or with no map position. Put a pin back on the map with Make live, or fill in its details first.</p></div>
      </div>
      <div className="pd-toolbar">
        <label className="pg-search grow">
          <i className="fas fa-magnifying-glass" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search these pins…" aria-label="Search pins" />
        </label>
        <div className="pd-seg" role="group" aria-label="Why it is not live">
          <button type="button" className={!why ? 'on' : ''} onClick={() => setWhy('')}>All <em>{all.length}</em></button>
          {(['hidden', 'pending', 'rejected', 'unplaced'] as const).filter((w) => count(w)).map((w) => (
            <button key={w} type="button" className={why === w ? 'on' : ''} onClick={() => setWhy(w)}>{NOT_LIVE_LABEL[w]} <em>{count(w)}</em></button>
          ))}
        </div>
      </div>
      {!all.length ? (
        <div className="adm-empty"><i className="fas fa-circle-check" /><p>Every pin is live on the map.</p></div>
      ) : (
        <PinTable rows={list} fieldLabel={fieldLabel} repeated={data.repeated} resetKey={`${why}|${q}`}
          action={(p) => p.located ? (
            <button type="button" className="adm-btn ghost sm pd-golive" disabled={busy === p.id}
              onClick={() => save(p, { live: true }, `Pin #${p.number ?? '—'} is live on the map`)}>
              <i className={`fas ${busy === p.id ? 'fa-spinner fa-spin' : 'fa-eye'}`} /> Make live
            </button>
          ) : (
            <button type="button" className="adm-btn ghost sm" onClick={() => requestFullEdit(p.id)} title="Set its map position in the full form">
              <i className="fas fa-location-crosshairs" /> Place on map
            </button>
          )} />
      )}
    </section>
  );
}

/* ----------------------------- Unused numbers ---------------------------- */

function Unused({ data, busy, initialPick }: { data: Data; busy: string | null; initialPick?: number | null }) {
  const save = useContext(SaveCtx);
  const [pick, setPick] = useState<number | null>(initialPick != null && data.gaps.includes(initialPick) ? initialPick : data.gaps[0] ?? null);
  const [q, setQ] = useState('');
  useEffect(() => { if (pick != null && !data.gaps.includes(pick)) setPick(data.gaps[0] ?? null); }, [data, pick]);
  const term = q.trim().toLowerCase();
  const repeated = new Set(data.repeated);
  // Best candidates to move: pins sharing a number, pins with no number, then the highest numbers.
  const rank = (p: Pin) => (p.number == null ? 0 : repeated.has(p.number) ? 1 : 2);
  const candidates = data.pins
    .filter((p) => matches(term, p.title, p.developer, p.location, p.number))
    .sort((a, b) => rank(a) - rank(b) || (b.number ?? 0) - (a.number ?? 0));
  const movePage = usePaged(candidates, `${term}|${pick}`, 'move', '10');
  // The pin each free number belonged to before (deleted, merged or a duplicate).
  const former = useMemo(() => {
    const m = new Map<number, DeletedPin>();
    for (const d of data.deleted) if (d.number != null && !m.has(d.number)) m.set(d.number, d);
    return m;
  }, [data]);
  const was = pick != null ? former.get(pick) : undefined;
  const bySeries = new Map<number, number[]>();
  for (const n of data.gaps) bySeries.set(seriesOf(n), [...(bySeries.get(seriesOf(n)) || []), n]);

  return (
    <div className="pd-split">
      <section className="pg-card">
        <div className="pg-card-head">
          <div><h3>Unused pin numbers</h3><p className="pd-sub">{data.gaps.length} numbers between 1 and {data.maxNumber} have no pin. New projects take the lowest free number automatically; pick one to move an existing pin onto it. A dotted number was used by a pin before.</p></div>
        </div>
        {!data.gaps.length ? (
          <div className="adm-empty"><i className="fas fa-circle-check" /><p>No gaps — every number from 1 to {data.maxNumber} is used.</p></div>
        ) : (
          <div className="pd-gapgroups">
            {[...bySeries].map(([s, nums]) => (
              <div key={s} className="pd-gapgroup">
                <span className="pd-gaplabel">{seriesLabel(s)} <em>{nums.length}</em></span>
                <div className="pd-gapchips">
                  {nums.map((n) => (
                    <button key={n} type="button" className={`${pick === n ? 'on' : ''}${former.has(n) ? ' was' : ''}`} onClick={() => setPick(n)} aria-pressed={pick === n}
                      title={former.has(n) ? `Was: ${former.get(n)!.title || 'a pin'}` : 'Never used'}>#{n}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      {pick != null && (
        <section className="pg-card pd-move">
          <h3>Move a pin to #{pick}</h3>
          {was ? (
            <p className="pd-note">
              <i className="fas fa-link" /> #{pick} was <b>{was.title || 'a pin'}</b>
              {was.duplicate_of
                ? <> ({was.reason === 'merged' ? 'merged into' : 'duplicate of'} {was.duplicate_of}). Its old link keeps redirecting there, even after you use #{pick}.</>
                : <> (deleted). Its old link already shows &ldquo;page not found&rdquo;.</>}
            </p>
          ) : <p className="pd-note"><i className="fas fa-circle-check" /> No pin has used #{pick} before.</p>}
          <p className="pd-sub">Repeated numbers are listed first, then the highest numbers. The moved pin&apos;s old link redirects to its new number.</p>
          <label className="pg-search grow">
            <i className="fas fa-magnifying-glass" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pin number or name…" aria-label="Search pins to move" />
          </label>
          <ul className="pd-movelist">
            {movePage.rows.map((p) => (
              <li key={p.id}>
                <span className="pd-num">{p.number != null ? `#${p.number}` : '—'}</span>
                <span className="pd-dmain"><b>{p.title || 'No name'}</b><small>{p.number != null && repeated.has(p.number) ? 'Shares its number with another pin' : p.location || '—'}</small></span>
                <button type="button" className="adm-btn ghost sm" disabled={busy === p.id}
                  onClick={() => save(p, { number: pick }, `"${p.title || 'Pin'}" is now pin #${pick}`)}>
                  <i className={`fas ${busy === p.id ? 'fa-spinner fa-spin' : 'fa-arrow-right'}`} /> Move to #{pick}
                </button>
              </li>
            ))}
            {!candidates.length && <li className="muted">No pins match.</li>}
          </ul>
          <Pager p={movePage} noun="pins" />
        </section>
      )}
    </div>
  );
}

/* ---------------------------- Repeated numbers --------------------------- */

function Repeated({ data, busy }: { data: Data; busy: string | null }) {
  const save = useContext(SaveCtx);
  const groups = data.repeated.map((n) => ({ n, pins: data.pins.filter((p) => p.number === n) }));
  // Suggest a different free number for each pin that has to move.
  const suggest = useMemo(() => {
    const free = [...data.gaps];
    let next = data.maxNumber + 1;
    const out = new Map<string, number>();
    for (const { pins } of groups) for (const p of pins.slice(1)) out.set(p.id, free.shift() ?? next++);
    return out;
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [nums, setNums] = useState<Record<string, string>>({});

  return (
    <section className="pg-card">
      <div className="pg-card-head">
        <div><h3>Repeated pin numbers</h3><p className="pd-sub">These numbers are on more than one pin. Keep one pin on the number and give the other a free number — a free one is filled in for you.</p></div>
      </div>
      {!groups.length ? (
        <div className="adm-empty"><i className="fas fa-circle-check" /><p>Every pin has its own number.</p></div>
      ) : (
        <div className="pd-groups">
          {groups.map(({ n, pins }) => (
            <div className="pd-group" key={n}>
              <div className="pd-ghead"><span className="pd-reason">Pin #{n}</span><small>{pins.length} pins share this number</small></div>
              {pins.map((p, i) => {
                const value = nums[p.id] ?? (i === 0 ? String(n) : String(suggest.get(p.id) ?? ''));
                const target = Number(value);
                return (
                  <div key={p.id} className="pd-reprow">
                    <span className="pd-dmain">
                      <b>{p.title || 'No name'}</b>
                      <small>{[p.developer, p.location, `created ${shortDate(p.created_at)}`].filter(Boolean).join(' · ')}</small>
                    </span>
                    <span className="pd-renum">
                      <span>New #</span>
                      <input type="number" min={1} value={value} onChange={(e) => setNums((m) => ({ ...m, [p.id]: e.target.value }))} aria-label={`New number for ${p.title}`} />
                      <button type="button" className="adm-btn primary sm" disabled={busy === p.id || !Number.isInteger(target) || target < 1 || target === n}
                        onClick={() => save(p, { number: target }, `"${p.title || 'Pin'}" is now pin #${target}`)}>
                        <i className={`fas ${busy === p.id ? 'fa-spinner fa-spin' : 'fa-check'}`} /> Change
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------ Deleted pins ----------------------------- */

function Deleted({ data, busy, onRestore }: { data: Data; busy: string | null; onRestore: (p: DeletedPin) => void }) {
  const [q, setQ] = useState('');
  const [reason, setReason] = useState<'' | DeletedPin['reason']>('');
  const term = q.trim().toLowerCase();
  const count = (r: DeletedPin['reason']) => data.deleted.filter((p) => p.reason === r).length;
  const list = data.deleted.filter((p) => (!reason || p.reason === reason) && matches(term, p.title, p.developer, p.location, p.rera, p.number, p.duplicate_of));
  const page = usePaged(list, `${q}|${reason}`, 'deleted');

  return (
    <section className="pg-card">
      <div className="pd-toolbar">
        <label className="pg-search grow">
          <i className="fas fa-magnifying-glass" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search deleted pins…" aria-label="Search deleted pins" />
        </label>
        <div className="pd-seg" role="group" aria-label="Why it was deleted">
          <button type="button" className={!reason ? 'on' : ''} onClick={() => setReason('')}>All <em>{data.deleted.length}</em></button>
          {(['merged', 'duplicate', 'empty', 'deleted'] as const).filter((r) => count(r)).map((r) => (
            <button key={r} type="button" className={reason === r ? 'on' : ''} onClick={() => setReason(r)}>{REASON_LABEL[r]} <em>{count(r)}</em></button>
          ))}
        </div>
      </div>
      {!list.length ? (
        <div className="adm-empty"><i className="fas fa-trash-can" /><p>{data.deleted.length ? 'No deleted pins match.' : 'No pins have been deleted.'}</p></div>
      ) : (
        <>
          <p className="pd-count">Restore puts a pin back on the map exactly as it was.</p>
          <div className="table-scroll">
            <table className="pg-table pd-table">
              <thead><tr><th>Pin</th><th>Project</th><th>Location</th><th>RERA</th><th>Why</th><th>Deleted on</th><th /></tr></thead>
              <tbody>
                {page.rows.map((p) => (
                  <tr key={p.history_id} className="pd-static">
                    <td className="pd-num">{p.number != null ? `#${p.number}` : '—'}</td>
                    <td className="pd-proj"><b>{p.title || <span className="pd-miss">No name</span>}</b><small>{p.developer || '—'}</small></td>
                    <td className="pd-loc">{p.location || '—'}</td>
                    <td className="pd-rera">{p.rera || '—'}</td>
                    <td>
                      <span className={`pd-pill ${p.reason === 'duplicate' || p.reason === 'merged' ? 'dup' : p.reason === 'empty' ? 'muted' : 'bad'}`}>{REASON_LABEL[p.reason]}</span>
                      {p.duplicate_of && <small>{p.reason === 'merged' ? 'into' : 'of'} {p.duplicate_of}</small>}
                    </td>
                    <td className="pd-when">{shortDate(p.deleted_at)}</td>
                    <td>
                      <button type="button" className="adm-btn ghost sm" onClick={() => onRestore(p)} disabled={busy === p.history_id}>
                        <i className={`fas ${busy === p.history_id ? 'fa-spinner fa-spin' : 'fa-rotate-left'}`} /> Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager p={page} noun="deleted pins" />
        </>
      )}
    </section>
  );
}

/* ----------------------------- Number series ---------------------------- */

type Cell = 'full' | 'part' | 'poor' | 'gap' | 'rep';
const CELL_META: { key: Cell; label: string }[] = [
  { key: 'full', label: 'Complete' }, { key: 'part', label: 'Some missing' }, { key: 'poor', label: 'Mostly empty' },
  { key: 'gap', label: 'Unused' }, { key: 'rep', label: 'Repeated' },
];

/** Pin numbers 100 at a time: a card per series, the chosen series as a 10×10 grid, and the picked number's details. */
function Series({ data, fieldLabel, onUseNumber }: { data: Data; fieldLabel: Record<string, string>; onUseNumber: (n: number) => void }) {
  const seriesCount = Math.max(1, Math.ceil(data.maxNumber / SERIES));
  const byNumber = useMemo(() => {
    const m = new Map<number, Pin[]>();
    for (const p of data.pins) if (p.number != null) m.set(p.number, [...(m.get(p.number) || []), p]);
    return m;
  }, [data]);
  const former = useMemo(() => {
    const m = new Map<number, DeletedPin>();
    for (const d of data.deleted) if (d.number != null && !m.has(d.number)) m.set(d.number, d);
    return m;
  }, [data]);
  const cellOf = (n: number): Cell => { const at = byNumber.get(n); return !at ? 'gap' : at.length > 1 ? 'rep' : quality(at[0].score); };
  const numbersOf = (s: number) => Array.from({ length: Math.max(0, Math.min(SERIES, data.maxNumber - s * SERIES)) }, (_, i) => s * SERIES + i + 1);
  const tally = (nums: number[]) => {
    const t: Record<Cell, number> = { full: 0, part: 0, poor: 0, gap: 0, rep: 0 };
    for (const n of nums) t[cellOf(n)]++;
    return t;
  };
  const series = Array.from({ length: seriesCount }, (_, s) => ({ s, nums: numbersOf(s) })).map((x) => ({ ...x, t: tally(x.nums) }));
  const total = tally(Array.from({ length: data.maxNumber }, (_, i) => i + 1));

  const [sel, setSel] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const cur = series[Math.min(sel, series.length - 1)];
  const go = (s: number) => { setSel(s); setPicked(null); };
  const at = picked != null ? byNumber.get(picked) : undefined;
  const was = picked != null ? former.get(picked) : undefined;

  return (
    <>
      <section className="pg-card pd-ser-top">
        <div className="pg-card-head">
          <div><h3>Pin number series</h3><p className="pd-sub">Numbers 1 to {data.maxNumber}, in blocks of 100. Pick a block to see each number; click a number for its pin.</p></div>
        </div>
        <div className="pd-ser-legend">
          {CELL_META.map((c) => (
            <span key={c.key} className={`pd-ser-key ${c.key}`}><i />{c.label}<b>{total[c.key].toLocaleString('en-IN')}</b></span>
          ))}
        </div>
        <div className="pd-ser-cards" role="tablist" aria-label="Number series">
          {series.map(({ s, nums, t }) => {
            const used = nums.length - t.gap;
            return (
              <button key={s} type="button" role="tab" aria-selected={s === cur.s} className={`pd-ser-card${s === cur.s ? ' on' : ''}`} onClick={() => go(s)}>
                <span className="pd-ser-head"><b>{seriesLabel(s)}</b>{t.gap > 0 && <em>{t.gap} unused</em>}</span>
                <span className="pd-ser-used"><strong>{used}</strong> / {nums.length} used</span>
                <span className="pd-ser-bar" aria-hidden="true">
                  {CELL_META.map((c) => t[c.key] > 0 && <span key={c.key} className={c.key} style={{ flexGrow: t[c.key] }} />)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="pd-ser-main">
        <section className="pg-card">
          <div className="pd-ser-nav">
            <button type="button" className="adm-btn ghost sm" onClick={() => go(cur.s - 1)} disabled={cur.s === 0} aria-label="Previous series"><i className="fas fa-chevron-left" /></button>
            <div>
              <h3>Pins {seriesLabel(cur.s)}</h3>
              <small>{cur.nums.length - cur.t.gap} used · {cur.t.full} complete · {cur.t.gap} unused{cur.t.rep ? ` · ${cur.t.rep} repeated` : ''}</small>
            </div>
            <button type="button" className="adm-btn ghost sm" onClick={() => go(cur.s + 1)} disabled={cur.s >= series.length - 1} aria-label="Next series"><i className="fas fa-chevron-right" /></button>
          </div>
          <div className="pd-ser-grid">
            {cur.nums.map((n) => {
              const c = cellOf(n);
              const pins = byNumber.get(n);
              const tip = pins ? pins.map((p) => `#${n} ${p.title || '(no name)'} — ${p.score}% data`).join('\n') : `#${n} — unused${former.get(n) ? ` (was ${former.get(n)!.title})` : ''}`;
              return (
                <button key={n} type="button" className={`pd-ser-cell ${c}${picked === n ? ' sel' : ''}`} title={tip} onClick={() => setPicked(n)} aria-pressed={picked === n}>
                  {n}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="pg-card pd-ser-side" aria-live="polite">
          {picked == null ? (
            <div className="pd-ser-empty"><i className="fas fa-hand-pointer" /><p>Click a number to see its pin.</p></div>
          ) : at ? (
            <>
              <span className="pd-ser-big">#{picked}</span>
              {at.length > 1 && <p className="pd-note"><i className="fas fa-clone" /> {at.length} pins share this number — fix it in Repeated numbers.</p>}
              {at.map((p) => (
                <div key={p.id} className="pd-ser-pin">
                  <b>{p.title || 'No name'}</b>
                  <small>{[p.developer, p.location].filter(Boolean).join(' · ') || '—'}</small>
                  <span className="pd-ser-row">
                    <span className={`pd-pill ${visibility(p).cls}`}>{visibility(p).label}</span>
                    <span className={`pd-meter ${quality(p.score)}`}><span style={{ width: `${p.score}%` }} /></span>
                    <small>{p.score}% data</small>
                  </span>
                  {p.missing.length > 0
                    ? <div className="pd-ser-miss">{p.missing.map((k) => <span key={k} className="pd-tag">{fieldLabel[k] || k}</span>)}</div>
                    : <span className="pd-ok"><i className="fas fa-circle-check" /> Every detail filled</span>}
                  <button type="button" className="adm-btn primary sm" onClick={() => requestFullEdit(p.id)}><i className="fas fa-pen" /> Edit details</button>
                </div>
              ))}
            </>
          ) : (
            <>
              <span className="pd-ser-big gap">#{picked}</span>
              <p className="pd-sub">No pin uses this number.</p>
              {was && (
                <p className="pd-note"><i className="fas fa-link" /> Was <b>{was.title || 'a pin'}</b>
                  {was.duplicate_of ? <> — {was.reason === 'merged' ? 'merged into' : 'duplicate of'} {was.duplicate_of}. Its old link keeps going there.</> : <> (deleted).</>}
                </p>
              )}
              <button type="button" className="adm-btn primary sm" onClick={() => onUseNumber(picked)}><i className="fas fa-arrow-right-to-bracket" /> Use this number</button>
            </>
          )}
        </aside>
      </div>
    </>
  );
}

/* --------------------------------- CSV --------------------------------- */

function exportCsv(pins: Pin[], fieldLabel: Record<string, string>) {
  const head = ['Pin #', 'Name', 'Developer', 'Location', 'Type', 'Status', 'On map', 'Price', 'Configuration', 'Area', 'Possession', 'RERA', 'Photo', 'Brochure', 'Video', 'Data %', 'Missing', 'Added from', 'Created'];
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = pins.map((p) => [
    p.number ?? '', p.title, p.developer, p.location, p.type, STATUS_LABEL[p.status] || p.status, visibility(p).label,
    p.price, p.configuration, p.sqft, p.possession, p.rera, p.image ? 'Yes' : 'No', p.brochure ? 'Yes' : 'No', p.video ? 'Yes' : 'No',
    p.score, p.missing.map((k) => fieldLabel[k] || k).join(', '), ORIGIN_LABEL[p.origin], p.created_at.slice(0, 10),
  ].map(cell).join(','));
  const blob = new Blob(['﻿' + [head.map(cell).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mappingg-pins-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

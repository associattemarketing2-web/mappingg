import { getDb } from '../mongodb';
import { invalidateTable } from '../db-engine';
import { ensureSchema, iso, sql, type Row } from './db';
import { audit, newId } from './store';
import { SubError } from './lifecycle';

// Data for the plan features themselves: the CP's private lead book / CRM,
// future-price notes (admin-published, Pro Max), buyer expert/legal/vastu
// requests, the buyer's portfolio, and developer media submissions. Every read
// and write is scoped to the owner in SQL (WHERE owner/user = $id) — a CP can
// never see another CP's leads, a buyer another buyer's portfolio.

const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);

// ---- CP leads / CRM -------------------------------------------------------------
export const CP_LEAD_STATUSES = ['new', 'contacted', 'site_visit', 'negotiation', 'booked', 'lost'] as const;
export const CP_LEAD_PRIORITIES = ['low', 'normal', 'high'] as const;

export interface CpLead {
  id: string; name: string; phone: string; email: string; pin_id: string | null; project_title: string; budget: string; requirement: string;
  city: string; status: string; priority: string; follow_up_at: string | null; notes: string; activity: { at: string; text: string }[];
  archived: boolean; created_at: string; updated_at: string;
}

const toLead = (r: Row): CpLead => ({
  id: r.id, name: r.name, phone: r.phone, email: r.email, pin_id: r.pin_id, project_title: r.project_title, budget: r.budget,
  requirement: r.requirement, city: r.city, status: r.status, priority: r.priority, follow_up_at: iso(r.follow_up_at), notes: r.notes,
  activity: Array.isArray(r.activity) ? r.activity : [], archived: !!r.archived, created_at: iso(r.created_at)!, updated_at: iso(r.updated_at)!,
});

export async function listCpLeads(ownerId: string, opts: { archived?: boolean } = {}): Promise<CpLead[]> {
  await ensureSchema();
  const r = await sql(`SELECT * FROM cp_leads WHERE owner_user_id = $1 AND archived = $2 ORDER BY updated_at DESC LIMIT 1000`, [ownerId, !!opts.archived]);
  return r.rows.map(toLead);
}

export async function countCpLeads(ownerId: string): Promise<number> {
  await ensureSchema();
  return Number((await sql(`SELECT count(*)::int AS n FROM cp_leads WHERE owner_user_id = $1 AND archived = false`, [ownerId])).rows[0]?.n || 0);
}

async function projectTitle(pinId: string | null): Promise<{ id: string | null; title: string }> {
  if (!pinId) return { id: null, title: '' };
  const p = await (await getDb()).collection('pins').findOne({ id: pinId, hidden: { $ne: true } }, { projection: { id: 1, title: 1 } });
  return p ? { id: String(p.id), title: String(p.title || '') } : { id: null, title: '' };
}

export interface CpLeadInput {
  name?: string; phone?: string; email?: string; pin_id?: string | null; budget?: string; requirement?: string; city?: string;
  status?: string; priority?: string; follow_up_at?: string | null; notes?: string; note?: string;
}

export async function createCpLead(ownerId: string, b: CpLeadInput): Promise<CpLead> {
  const name = clip(b.name, 120);
  if (name.length < 2) throw new SubError('Enter the client’s name.');
  const phone = clip(b.phone, 30), email = clip(b.email, 160).toLowerCase();
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new SubError('Enter a valid email.');
  const proj = await projectTitle(b.pin_id ? clip(b.pin_id, 100) : null);
  const now = new Date().toISOString();
  const r = await sql(
    `INSERT INTO cp_leads (id, owner_user_id, name, phone, email, pin_id, project_title, budget, requirement, city, status, priority, follow_up_at, notes, activity)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'new',$11,$12,$13,$14::jsonb) RETURNING *`,
    [newId('cpl'), ownerId, name, phone, email, proj.id, proj.title, clip(b.budget, 80), clip(b.requirement, 1000), clip(b.city, 60),
      (CP_LEAD_PRIORITIES as readonly string[]).includes(String(b.priority)) ? b.priority : 'normal', validDate(b.follow_up_at), clip(b.notes, 4000),
      JSON.stringify([{ at: now, text: 'Lead added' }])],
  );
  return toLead(r.rows[0]);
}

function validDate(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function updateCpLead(ownerId: string, id: string, b: CpLeadInput, opts: { crm: boolean }): Promise<CpLead> {
  const cur = (await sql(`SELECT * FROM cp_leads WHERE id = $1 AND owner_user_id = $2`, [id, ownerId])).rows[0];
  if (!cur) throw new SubError('Lead not found', 404);
  const next = { ...cur };
  const log: string[] = [];
  for (const k of ['name', 'phone', 'email', 'budget', 'requirement', 'city', 'notes'] as const) {
    if (b[k] !== undefined) next[k] = clip(b[k], k === 'notes' ? 4000 : k === 'requirement' ? 1000 : 160);
  }
  if (b.status !== undefined) {
    if (!(CP_LEAD_STATUSES as readonly string[]).includes(String(b.status))) throw new SubError('Unknown status');
    if (b.status !== cur.status) log.push(`Status: ${cur.status} → ${b.status}`);
    next.status = b.status;
  }
  if (b.pin_id !== undefined) { const p = await projectTitle(b.pin_id ? clip(b.pin_id, 100) : null); next.pin_id = p.id; next.project_title = p.title; }
  // Priority, follow-ups and the activity timeline are CRM (Pro Max) features.
  if (opts.crm) {
    if (b.priority !== undefined && (CP_LEAD_PRIORITIES as readonly string[]).includes(String(b.priority))) next.priority = b.priority;
    if (b.follow_up_at !== undefined) { next.follow_up_at = validDate(b.follow_up_at); log.push(next.follow_up_at ? `Follow-up set for ${new Date(next.follow_up_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` : 'Follow-up cleared'); }
    if (b.note) log.push(clip(b.note, 500));
  }
  const now = new Date().toISOString();
  const activity = [...(Array.isArray(cur.activity) ? cur.activity : []), ...log.map((text) => ({ at: now, text }))].slice(-200);
  const r = await sql(
    `UPDATE cp_leads SET name=$3, phone=$4, email=$5, pin_id=$6, project_title=$7, budget=$8, requirement=$9, city=$10, status=$11, priority=$12,
       follow_up_at=$13, notes=$14, activity=$15::jsonb, updated_at=now() WHERE id=$1 AND owner_user_id=$2 RETURNING *`,
    [id, ownerId, next.name, next.phone, next.email, next.pin_id, next.project_title, next.budget, next.requirement, next.city, next.status,
      next.priority, next.follow_up_at, next.notes, JSON.stringify(activity)],
  );
  return toLead(r.rows[0]);
}

/** Leads are archived, never deleted (they stay restorable, also after a plan ends). */
export async function archiveCpLead(ownerId: string, id: string, archived = true) {
  const r = await sql(`UPDATE cp_leads SET archived = $3, updated_at = now() WHERE id = $1 AND owner_user_id = $2`, [id, ownerId, archived]);
  if (!r.rowCount) throw new SubError('Lead not found', 404);
}

export function leadsCsv(leads: CpLead[]): string {
  const cols: (keyof CpLead)[] = ['name', 'phone', 'email', 'project_title', 'budget', 'requirement', 'city', 'status', 'priority', 'follow_up_at', 'notes', 'created_at', 'updated_at'];
  const cell = (v: unknown) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // no spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...leads.map((l) => cols.map((c) => cell(l[c])).join(','))].join('\n');
}

// ---- future price (admin-published notes) ----------------------------------------
export async function getPriceOutlook(pinId: string) {
  await ensureSchema();
  const r = await sql(`SELECT pin_id, expected_price, horizon, note, source, updated_at FROM sub_price_outlook WHERE pin_id = $1`, [pinId]);
  return r.rows[0] ? ({ ...r.rows[0], updated_at: iso(r.rows[0].updated_at) } as Row) : null;
}

export async function listPriceOutlooks(pinIds?: string[]) {
  await ensureSchema();
  const r = pinIds
    ? await sql(`SELECT * FROM sub_price_outlook WHERE pin_id = ANY($1::text[])`, [pinIds])
    : await sql(`SELECT * FROM sub_price_outlook ORDER BY updated_at DESC LIMIT 500`);
  return r.rows.map((x): Row => ({ ...x, updated_at: iso(x.updated_at) }));
}

export async function setPriceOutlook(pinId: string, b: { expected_price?: string; horizon?: string; note?: string; source?: string }, actor: string) {
  const price = clip(b.expected_price, 120);
  if (!price) {
    await sql(`DELETE FROM sub_price_outlook WHERE pin_id = $1`, [pinId]);
    await audit(actor, 'price_outlook.delete', 'pin', pinId);
    return null;
  }
  const source = clip(b.source, 300);
  if (!source) throw new SubError('Say where this figure comes from (developer price list, announced revision…).');
  await sql(
    `INSERT INTO sub_price_outlook (pin_id, expected_price, horizon, note, source, updated_by) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (pin_id) DO UPDATE SET expected_price=$2, horizon=$3, note=$4, source=$5, updated_by=$6, updated_at=now()`,
    [pinId, price, clip(b.horizon, 80), clip(b.note, 600), source, actor],
  );
  await audit(actor, 'price_outlook.set', 'pin', pinId, { expected_price: price, horizon: b.horizon, source });
  return getPriceOutlook(pinId);
}

// ---- buyer services (expert / legal / vastu requests) -------------------------------
export const SERVICE_TYPES = { expert: 'Property expert call', legal: 'Legal document review', vastu: 'Vastu consultation', portfolio: 'Portfolio review' } as const;
export type ServiceType = keyof typeof SERVICE_TYPES;
export const SERVICE_STATUSES = ['requested', 'scheduled', 'in_progress', 'completed', 'cancelled'] as const;

export async function listServiceRequests(userId: string | null, opts: { status?: string } = {}) {
  await ensureSchema();
  const where: string[] = [];
  const params: unknown[] = [];
  if (userId) { params.push(userId); where.push(`user_id = $${params.length}`); }
  if (opts.status) { params.push(opts.status); where.push(`status = $${params.length}`); }
  const r = await sql(`SELECT * FROM buyer_service_requests ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 500`, params);
  return r.rows.map((x): Row => ({ ...x, created_at: iso(x.created_at), updated_at: iso(x.updated_at) }));
}

export async function createServiceRequest(userId: string, b: { type?: string; pin_id?: string; message?: string; preferred_date?: string; preferred_time?: string; contact_phone?: string }) {
  if (!(b.type && b.type in SERVICE_TYPES)) throw new SubError('Choose what you need help with.');
  const open = await sql(`SELECT count(*)::int AS n FROM buyer_service_requests WHERE user_id = $1 AND status IN ('requested','scheduled','in_progress')`, [userId]);
  if (Number(open.rows[0]?.n) >= 10) throw new SubError('You have 10 open requests — we will get back to you on those first.');
  const proj = await projectTitle(b.pin_id ? clip(b.pin_id, 100) : null);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.preferred_date || '')) ? String(b.preferred_date) : '';
  const r = await sql(
    `INSERT INTO buyer_service_requests (id, user_id, type, pin_id, project_title, message, preferred_date, preferred_time, contact_phone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [newId('srq'), userId, b.type, proj.id, proj.title, clip(b.message, 2000), date, clip(b.preferred_time, 40), clip(b.contact_phone, 30)],
  );
  return r.rows[0];
}

export async function updateServiceRequest(id: string, b: { status?: string; admin_note?: string; assigned_to?: string }, actor: string) {
  if (b.status && !(SERVICE_STATUSES as readonly string[]).includes(b.status)) throw new SubError('Unknown status');
  const r = await sql(
    `UPDATE buyer_service_requests SET status = COALESCE($2, status), admin_note = COALESCE($3, admin_note), assigned_to = COALESCE($4, assigned_to), updated_at = now() WHERE id = $1 RETURNING *`,
    [id, b.status || null, b.admin_note != null ? clip(b.admin_note, 2000) : null, b.assigned_to != null ? clip(b.assigned_to, 120) : null],
  );
  if (!r.rows[0]) throw new SubError('Request not found', 404);
  await audit(actor, 'service_request.update', 'service_request', id, b);
  return r.rows[0];
}

export async function cancelOwnServiceRequest(userId: string, id: string) {
  const r = await sql(`UPDATE buyer_service_requests SET status = 'cancelled', updated_at = now() WHERE id = $1 AND user_id = $2 AND status IN ('requested','scheduled') RETURNING id`, [id, userId]);
  if (!r.rows[0]) throw new SubError('This request can no longer be cancelled.', 400);
}

// ---- buyer portfolio ------------------------------------------------------------------
const rupeesToPaise = (v: unknown): number | null => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[,₹\s]/g, ''));
  return Number.isFinite(n) && n >= 0 && n < 1e12 ? Math.round(n * 100) : null;
};

export async function listPortfolio(userId: string) {
  await ensureSchema();
  const r = await sql(`SELECT * FROM buyer_portfolio WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`, [userId]);
  return r.rows.map((x): Row => ({
    ...x, purchase_price_paise: Number(x.purchase_price_paise), current_value_paise: x.current_value_paise == null ? null : Number(x.current_value_paise),
    loan_outstanding_paise: x.loan_outstanding_paise == null ? null : Number(x.loan_outstanding_paise), created_at: iso(x.created_at), updated_at: iso(x.updated_at),
  }));
}

export interface HoldingInput { name?: string; pin_id?: string | null; location?: string; purchase_price?: string | number; purchase_date?: string; area_sqft?: string | number; current_value?: string | number; loan_outstanding?: string | number; notes?: string }

export async function saveHolding(userId: string, id: string | null, b: HoldingInput) {
  const name = clip(b.name, 160);
  if (name.length < 2) throw new SubError('Give the property a name.');
  const area = b.area_sqft === '' || b.area_sqft == null ? null : Math.round(Number(b.area_sqft));
  const proj = await projectTitle(b.pin_id ? clip(b.pin_id, 100) : null);
  const vals = [name, proj.id, clip(b.location, 160), rupeesToPaise(b.purchase_price) ?? 0, /^\d{4}-\d{2}(-\d{2})?$/.test(String(b.purchase_date || '')) ? String(b.purchase_date) : '',
    Number.isFinite(area) && area! > 0 && area! < 1e7 ? area : null, rupeesToPaise(b.current_value), rupeesToPaise(b.loan_outstanding), clip(b.notes, 2000)];
  if (id) {
    const r = await sql(`UPDATE buyer_portfolio SET name=$3, pin_id=$4, location=$5, purchase_price_paise=$6, purchase_date=$7, area_sqft=$8, current_value_paise=$9, loan_outstanding_paise=$10, notes=$11, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id`, [id, userId, ...vals]);
    if (!r.rows[0]) throw new SubError('Not found', 404);
    return id;
  }
  const count = await sql(`SELECT count(*)::int AS n FROM buyer_portfolio WHERE user_id = $1`, [userId]);
  if (Number(count.rows[0]?.n) >= 200) throw new SubError('Your portfolio can hold up to 200 properties.');
  const nid = newId('hld');
  await sql(`INSERT INTO buyer_portfolio (id, user_id, name, pin_id, location, purchase_price_paise, purchase_date, area_sqft, current_value_paise, loan_outstanding_paise, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [nid, userId, ...vals]);
  return nid;
}

export async function deleteHolding(userId: string, id: string) {
  const r = await sql(`DELETE FROM buyer_portfolio WHERE id = $1 AND user_id = $2`, [id, userId]);
  if (!r.rowCount) throw new SubError('Not found', 404);
}

// ---- developer media ----------------------------------------------------------------------
export const MEDIA_KINDS = { brochure: 'dev_brochure_upload', floor_plan: 'dev_floor_plan_upload', gallery: 'dev_gallery_upload', video: 'dev_video_highlight' } as const;
export type MediaKind = keyof typeof MEDIA_KINDS;

export const devMediaPrefix = (userId: string, pinId: string, kind: string) => `dev/${userId}/${pinId}/${kind}/`;
export const publicMediaUrl = (path: string) => `/api/partners/storage?bucket=project-media&path=${encodeURIComponent(path)}&public=1`;

export async function listMedia(opts: { userId?: string; pinId?: string; status?: string }) {
  await ensureSchema();
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.userId) { params.push(opts.userId); where.push(`user_id = $${params.length}`); }
  if (opts.pinId) { params.push(opts.pinId); where.push(`pin_id = $${params.length}`); }
  if (opts.status) { params.push(opts.status); where.push(`status = $${params.length}`); }
  const r = await sql(`SELECT * FROM dev_media_submissions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 500`, params);
  return r.rows.map((x): Row => ({ ...x, created_at: iso(x.created_at), reviewed_at: iso(x.reviewed_at) }));
}

export async function countMedia(pinId: string): Promise<number> {
  return Number((await sql(`SELECT count(*)::int AS n FROM dev_media_submissions WHERE pin_id = $1 AND status IN ('pending','approved')`, [pinId])).rows[0]?.n || 0);
}

export async function submitMedia(userId: string, pinId: string, kind: MediaKind, b: { path?: string; url?: string; title?: string }) {
  let url = '';
  if (kind === 'video') {
    const u = clip(b.url, 300);
    if (!/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(u)) throw new SubError('Paste a YouTube link (https://youtube.com/… or https://youtu.be/…).');
    url = u;
  } else {
    const path = clip(b.path, 300);
    if (!path.startsWith(devMediaPrefix(userId, pinId, kind)) || path.includes('..')) throw new SubError('Upload the file first.');
    url = publicMediaUrl(path);
  }
  const r = await sql(`INSERT INTO dev_media_submissions (id, user_id, pin_id, kind, url, title) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [newId('med'), userId, pinId, kind, url, clip(b.title, 120)]);
  return r.rows[0];
}

/**
 * Admin approves a media submission: it is applied to the project's pin (the
 * fields the live map and project pages already read), without hiding the pin.
 */
export async function reviewMedia(id: string, approve: boolean, note: string, actor: string) {
  const m = (await sql(`SELECT * FROM dev_media_submissions WHERE id = $1`, [id])).rows[0];
  if (!m) throw new SubError('Not found', 404);
  if (m.status !== 'pending') throw new SubError('Already reviewed.');
  if (approve) {
    const pins = (await getDb()).collection('pins');
    const pin = await pins.findOne({ id: m.pin_id, owner_user_id: m.user_id }, { projection: { id: 1, floor_plan_urls: 1, gallery_urls: 1 } });
    if (!pin) throw new SubError('The project no longer exists.');
    const set: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (m.kind === 'brochure') set.brochure_url = m.url;
    if (m.kind === 'video') set.youtube_video_url = m.url;
    if (m.kind === 'floor_plan') set.floor_plan_urls = [...(Array.isArray(pin.floor_plan_urls) ? pin.floor_plan_urls : []), m.url].slice(-30);
    if (m.kind === 'gallery') set.gallery_urls = [...(Array.isArray(pin.gallery_urls) ? pin.gallery_urls : []), m.url].slice(-60);
    await pins.updateOne({ id: m.pin_id, owner_user_id: m.user_id }, { $set: set });
    invalidateTable('pins');
  }
  await sql(`UPDATE dev_media_submissions SET status = $2, note = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1`, [id, approve ? 'approved' : 'rejected', clip(note, 500), actor]);
  await audit(actor, approve ? 'media.approve' : 'media.reject', 'media', id, { pin_id: m.pin_id, kind: m.kind, note });
}

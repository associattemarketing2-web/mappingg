import { randomBytes, randomUUID } from 'node:crypto';
import { getDb, usingMongo } from './mongodb';
import { query } from './pg';
import { mediaUrl } from './pin-media';
import { publicImageUrl } from './seo/public-media';
import { getPublicPins, slugForProject, type Pin } from './seo/entities';
import { prettyPhone, waDigits } from './wa-store';

// Project share links (s-admin → WhatsApp → Bulk send → "Share a project").
//
//   1. Pick a project, tick the photos / brochure / floor plans / videos to share
//      (or upload any other file) → "Create link" saves a share (wa_shares).
//   2. Add numbers and send: every number gets its OWN link
//      (/s/<code>/<token>, one wa_share_links row per number), put into the
//      message wherever {link} is written.
//   3. The link opens a page with exactly what was picked. Opening it (and each
//      download) is recorded on that number's row, so the panel shows who opened
//      it, when, how often, and what they downloaded.
// Link previews fetched by WhatsApp / Facebook crawlers are not counted (the page
// records an open from the browser, and bot user-agents are ignored).

export type ShareKind = 'photo' | 'brochure' | 'floor_plan' | 'payment_plan' | 'video' | 'file';
export interface ShareItem { id: string; kind: ShareKind; url: string; name: string }
export interface ShareProject {
  pin_id: string; title: string; location?: string; developer?: string; price?: string; configuration?: string;
  sqft?: string; possession?: string; status?: string; type?: string; rera?: string; logo?: string; usp?: string; page?: string;
}
export interface WaShare {
  id: string; code: string; title: string; note: string; show_details: boolean;
  project: ShareProject | null; items: ShareItem[];
  views: number; created_by?: string; created_at: string; updated_at: string; deleted?: boolean;
}
export interface ShareLink {
  id: string; share_id: string; phone: string; name: string; created_at: string;
  opens: number; first_open_at?: string; last_open_at?: string; device?: string;
  clicks: number; downloaded?: string[]; last_click_at?: string;
}

const ALPHA = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function token(n: number): string {
  const b = randomBytes(n);
  return Array.from(b, (x) => ALPHA[x % ALPHA.length]).join('');
}

let ready: Promise<void> | null = null;
async function ensure() {
  if (usingMongo()) return;
  ready ??= query(`
    CREATE TABLE IF NOT EXISTS "wa_shares" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
    CREATE TABLE IF NOT EXISTS "wa_share_links" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb);
    CREATE INDEX IF NOT EXISTS wa_shares_code ON "wa_shares" ((doc->>'code'));
    CREATE INDEX IF NOT EXISTS wa_share_links_share ON "wa_share_links" ((doc->>'share_id'));
  `).then(() => undefined).catch((e) => { ready = null; throw e; });
  await ready;
}
async function sharesCol() { await ensure(); return (await getDb()).collection<WaShare & { _id: string }>('wa_shares'); }
async function linksCol() { await ensure(); return (await getDb()).collection<ShareLink & { _id: string }>('wa_share_links'); }

export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com').replace(/\/$/, '');
export const shareUrl = (code: string, tok?: string) => `${siteUrl()}/s/${code}${tok ? `/${tok}` : ''}`;

/* ------------------------------ Project media ------------------------------ */

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const fileName = (url: string, fallback: string) => {
  try {
    const u = new URL(url, 'https://x');
    const p = u.searchParams.get('path') || u.pathname;
    const last = decodeURIComponent(p.split('/').pop() || '').replace(/^[0-9a-f]{8}-/, '');
    return last && last.length < 120 ? last : fallback;
  } catch { return fallback; }
};
const urlOk = (u: string) => /^(https?:\/\/|\/)/.test(u) && !u.startsWith('data:');
const ytId = (u: string) => /(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/.exec(u)?.[1] || '';

/** Light list of the public projects for the picker. */
export async function projectChoices(): Promise<{ id: string; title: string; location: string; developer: string }[]> {
  const pins = await getPublicPins();
  return pins.filter((p) => p.title).map((p) => ({ id: String(p.id), title: str(p.title), location: str(p.location), developer: str(p.developer) }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

async function loadPin(pinId: string): Promise<Record<string, unknown> | null> {
  return (await (await getDb()).collection('pins').findOne({ id: pinId })) as Record<string, unknown> | null;
}
async function loadProject(id: string): Promise<Record<string, unknown> | null> {
  if (!id) return null;
  if (usingMongo()) return (await (await getDb()).collection('projects').findOne({ id })) as Record<string, unknown> | null;
  const r = await query<{ doc: Record<string, unknown> }>(`SELECT doc FROM projects WHERE id = $1 LIMIT 1`, [id]);
  return r.rows[0]?.doc || null;
}

/** Project facts + every photo / brochure / plan / video we hold for it (for the picker). */
export async function projectMedia(pinId: string): Promise<{ project: ShareProject; items: ShareItem[] } | null> {
  const pin = await loadPin(pinId);
  if (!pin) return null;
  const proj = await loadProject(str(pin.intake_project_id));
  const items: ShareItem[] = [];
  const seen = new Set<string>();
  const add = (kind: ShareKind, raw: unknown, name: string) => {
    let url = str(raw);
    if (!url || !urlOk(url)) return;
    if (kind === 'photo') url = publicImageUrl(url) || url;
    if (seen.has(url)) return;
    seen.add(url);
    items.push({ id: randomUUID().slice(0, 8), kind, url, name });
  };
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  if (proj) {
    add('photo', proj.cover_image_url, 'Cover photo');
    arr(proj.gallery_urls).forEach((u, i) => add('photo', u, `Photo ${i + 1}`));
    add('brochure', proj.brochure_url, fileName(str(proj.brochure_url), 'Brochure'));
    arr(proj.floor_plan_urls).forEach((u, i) => add('floor_plan', u, fileName(str(u), `Floor plan ${i + 1}`)));
    add('payment_plan', proj.payment_plan_url, fileName(str(proj.payment_plan_url), 'Payment plan'));
    add('video', proj.youtube_url, 'Project video');
    add('file', proj.media_folder_link, 'Photos & media folder');
  }
  add('brochure', pin.brochure_url, fileName(str(pin.brochure_url), 'Brochure'));
  const bi = str(pin.brochure_image);
  if (bi.startsWith('data:')) add('brochure', mediaUrl('pins', String(pin.id), 'brochure_image', bi), 'Brochure (image)');
  else add('brochure', bi, 'Brochure (image)');
  add('video', pin.youtube_video_url, 'Project video');
  // Videos: keep one per YouTube id.
  const yt = new Set<string>();
  const list = items.filter((i) => { if (i.kind !== 'video') return true; const k = ytId(i.url) || i.url; if (yt.has(k)) return false; yt.add(k); return true; });

  const img = str(pin.image);
  const logo = img.startsWith('data:') ? mediaUrl('pins', String(pin.id), 'image', img, 240) : urlOk(img) ? img : '';
  const vis = (pin.field_visibility && typeof pin.field_visibility === 'object' ? pin.field_visibility : {}) as Record<string, unknown>;
  const project: ShareProject = {
    pin_id: String(pin.id), title: str(pin.title) || 'Project', location: str(pin.location), developer: str(pin.developer),
    price: vis.price === false ? '' : str(pin.price), configuration: str(pin.configuration), sqft: str(pin.sqft),
    possession: str(pin.possession_timeline), status: str(pin.status), type: str(pin.type), rera: str(pin.rera_number),
    usp: str(pin.key_usp).slice(0, 400), logo,
    page: pin.number != null && pin.title ? `/projects/${slugForProject(pin as unknown as Pin)}` : '',
  };
  return { project, items: list };
}

/* --------------------------------- Shares --------------------------------- */

export async function createShare(input: {
  pin_id?: string; title?: string; note?: string; show_details: boolean; items: { kind: ShareKind; url: string; name: string }[]; by?: string;
}): Promise<WaShare> {
  let project: ShareProject | null = null;
  if (input.pin_id) {
    const m = await projectMedia(input.pin_id);
    if (!m) throw new Error('Project not found');
    project = m.project;
  }
  const items = input.items.filter((i) => urlOk(i.url)).slice(0, 60).map((i) => ({ id: randomUUID().slice(0, 8), kind: i.kind, url: i.url.slice(0, 1000), name: (i.name || 'File').slice(0, 120) }));
  if (!items.length && !(project && input.show_details)) throw new Error('Pick at least one photo, brochure or file (or keep the project details on)');
  const col = await sharesCol();
  let code = token(7);
  for (let i = 0; i < 5 && (await col.findOne({ code })); i++) code = token(8);
  const now = new Date().toISOString();
  const s: WaShare = {
    id: randomUUID(), code, title: (input.title || project?.title || 'Shared files').slice(0, 120), note: (input.note || '').slice(0, 1000),
    show_details: input.show_details, project, items, views: 0, created_by: input.by, created_at: now, updated_at: now,
  };
  await col.insertOne({ _id: s.id, ...s });
  return s;
}

export async function getShareById(id: string): Promise<WaShare | null> {
  return (await (await sharesCol()).findOne({ _id: id })) as WaShare | null;
}
export async function getShareByCode(code: string): Promise<WaShare | null> {
  if (!/^[A-Za-z0-9]{5,12}$/.test(code)) return null;
  const s = (await (await sharesCol()).findOne({ code })) as WaShare | null;
  return s && !s.deleted ? s : null;
}
export async function deleteShare(id: string): Promise<void> {
  await (await sharesCol()).updateOne({ _id: id }, { $set: { deleted: true, updated_at: new Date().toISOString() } });
}

/**
 * Gives every recipient their own link for this share (a number already in it keeps its link).
 * Returns phone → link.
 */
export async function assignLinks(shareId: string, recipients: { phone: string; name?: string }[]): Promise<Map<string, string>> {
  const share = await getShareById(shareId);
  if (!share || share.deleted) throw new Error('This share link was deleted — create a new one');
  const col = await linksCol();
  const existing = (await col.find({ share_id: shareId }, { projection: { id: 1, phone: 1 } }).toArray()) as ShareLink[];
  const byPhone = new Map(existing.map((l) => [l.phone, l.id]));
  const now = new Date().toISOString();
  const fresh: (ShareLink & { _id: string })[] = [];
  for (const r of recipients) {
    const phone = waDigits(r.phone);
    if (phone.length < 11 || byPhone.has(phone)) continue;
    const id = token(10);
    byPhone.set(phone, id);
    fresh.push({ _id: id, id, share_id: shareId, phone, name: String(r.name || '').slice(0, 80), created_at: now, opens: 0, clicks: 0 });
  }
  for (let i = 0; i < fresh.length; i += 500) await col.insertMany(fresh.slice(i, i + 500));
  const out = new Map<string, string>();
  for (const [phone, tok] of byPhone) out.set(phone, shareUrl(share.code, tok));
  return out;
}

const BOT = /bot|crawl|spider|facebookexternalhit|whatsapp|preview|slurp|telegram|skype|discord|linkedin|embedly|headless|lighthouse/i;
function deviceOf(ua: string): string {
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iPhone' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return os ? `${br} on ${os}` : br;
}

/**
 * Records an open or a download from the share page. Returns the link row when this was that number's
 * FIRST open (so the caller can alert the team), else null.
 */
export async function recordEvent(code: string, tok: string, event: 'open' | 'click', item: string, ua: string): Promise<ShareLink | null> {
  if (!ua || BOT.test(ua)) return null;
  const share = await getShareByCode(code);
  if (!share) return null;
  const now = new Date().toISOString();
  const shares = await sharesCol();
  if (event === 'open') await shares.updateOne({ _id: share.id }, { $inc: { views: 1 } });
  if (!/^[A-Za-z0-9]{6,16}$/.test(tok)) return null;
  const col = await linksCol();
  const link = (await col.findOne({ _id: tok })) as ShareLink | null;
  if (!link || link.share_id !== share.id) return null;
  if (event === 'open') {
    await col.updateOne({ _id: tok }, { $inc: { opens: 1 }, $set: { last_open_at: now, device: deviceOf(ua), ...(link.first_open_at ? {} : { first_open_at: now }) } });
    return link.first_open_at ? null : { ...link, first_open_at: now };
  }
  const name = (share.items.find((i) => i.id === item)?.name || item).slice(0, 120);
  const downloaded = [...new Set([...(link.downloaded || []), name])].slice(0, 60);
  await col.updateOne({ _id: tok }, { $inc: { clicks: 1 }, $set: { downloaded, last_click_at: now, ...(link.first_open_at ? {} : { first_open_at: now, last_open_at: now, opens: 1 }) } });
  return null;
}

/** Shares for the panel, newest first, with sent / opened counts. */
export async function listShares(): Promise<(WaShare & { sent: number; opened: number; url: string })[]> {
  const rows = ((await (await sharesCol()).find({}).sort({ created_at: -1 }).limit(100).toArray()) as WaShare[]).filter((s) => !s.deleted);
  const counts = new Map<string, { sent: number; opened: number }>();
  if (rows.length) {
    if (!usingMongo()) {
      const r = await query<{ s: string; n: string; o: string }>(
        `SELECT doc->>'share_id' s, count(*) n, count(*) FILTER (WHERE coalesce(doc->>'first_open_at','') <> '') o
           FROM wa_share_links WHERE doc->>'share_id' = ANY($1) GROUP BY 1`, [rows.map((x) => x.id)],
      );
      for (const x of r.rows) counts.set(x.s, { sent: Number(x.n), opened: Number(x.o) });
    } else {
      const all = (await (await linksCol()).find({ share_id: { $in: rows.map((x) => x.id) } }, { projection: { share_id: 1, first_open_at: 1 } }).toArray()) as ShareLink[];
      for (const l of all) { const c = counts.get(l.share_id) || { sent: 0, opened: 0 }; c.sent++; if (l.first_open_at) c.opened++; counts.set(l.share_id, c); }
    }
  }
  return rows.map((s) => ({ ...s, ...(counts.get(s.id) || { sent: 0, opened: 0 }), url: shareUrl(s.code) }));
}

/** Every number a share was sent to, opened ones first. */
export async function shareRecipients(shareId: string) {
  const rows = (await (await linksCol()).find({ share_id: shareId }).toArray()) as ShareLink[];
  return rows
    .map((l) => ({ ...l, phone_display: prettyPhone(l.phone) }))
    .sort((a, b) => (b.last_open_at || '').localeCompare(a.last_open_at || '') || a.created_at.localeCompare(b.created_at));
}

import type { NextRequest } from 'next/server';
import { clientIp } from './rate-limit';
import { splitPhone } from './phone';
import { locate, regionName } from './site-analytics';

// Every new lead (contact form, live-map enquiry) is also pushed to the sales
// CRM (B2BBricks) through its integration webhook, CRM_WEBHOOK_URL. Sent in the
// background after the lead is saved here, so a slow or failing CRM never
// affects the visitor. Without the env var nothing is sent.

export interface CrmLead {
  name: string;
  /** Stored form ("+91 9876543210") or as typed. */
  mobile?: string;
  email?: string;
  project?: string;
  /** Which form the lead came from, e.g. "Contact form" — shown in the CRM remark. */
  source: string;
  /** The page the form was submitted from (see pageOf). */
  page?: string;
  message?: string;
  /** Extra "Label: value" parts for the remark (empty values are skipped). */
  extra?: [string, unknown][];
  ip?: string;
}

/** The visitor's own IP (behind Cloudflare it is in its own header). */
export function visitorIp(req: NextRequest): string {
  return req.headers.get('cf-connecting-ip') || req.headers.get('true-client-ip') || clientIp(req);
}

/** The page the visitor submitted the form from (the request's Referer), without its query string. */
export function pageOf(req: NextRequest): string {
  return (req.headers.get('referer') || '').split(/[?#]/)[0].slice(0, 300);
}

/** "+91 9876543210" → "9876543210"; other countries keep their code ("14155550123"). */
function crmMobile(value: unknown): string {
  const { code, number } = splitPhone(value);
  if (!number) return '';
  return code === '+91' ? number : code.replace(/\D/g, '') + number;
}

const oneLine = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

async function send(lead: CrmLead): Promise<void> {
  const url = process.env.CRM_WEBHOOK_URL;
  if (!url) return;
  try {
    const ip = lead.ip && lead.ip !== 'unknown' ? lead.ip.replace(/^::ffff:/, '') : '';
    const geo = ip ? await locate(ip) : {};
    const place = [geo.city, geo.region && regionName(geo.country || '', geo.region)].filter(Boolean).join(', ');
    // The remark is what the sales team reads first: which form, project and page the lead came from.
    const remark = [
      ...[['Form', lead.source], ['Project', lead.project], ['Page', lead.page], ...(lead.extra || []), ['Message', lead.message], ['IP', ip], ['Location', place]]
        .map(([k, v]) => [k, oneLine(v)])
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`),
    ].join(' | ');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: oneLine(lead.name),
        mobile: crmMobile(lead.mobile),
        email: oneLine(lead.email),
        project: oneLine(lead.project),
        remark,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.warn('[crm] webhook answered', res.status, (await res.text().catch(() => '')).slice(0, 200));
  } catch (e) {
    console.warn('[crm] could not send lead:', e instanceof Error ? e.message : e);
  }
}

/** Queue a lead for the CRM. Returns at once and never throws. */
export function pushToCrm(lead: CrmLead): void {
  void send(lead);
}

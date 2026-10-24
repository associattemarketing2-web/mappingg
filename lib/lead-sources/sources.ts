import { SITE_URL } from '../seo/config';
import { query } from '../pg';
import { googleConfigured, GOOGLE_SOURCE } from './google-ads';
import { metaConfigured, metaEnv, META_SOURCE } from './meta';
import { CSV_SOURCE } from './csv-import';
import { lastOk, leadCountsBySource, listPortals, statsBySource, type Portal, type SourceStats } from './store';

// The registry of every buyer-lead source and how its status is worked out.
// A source is only "Connected" when there is evidence it works: it's a form on
// this site, or a webhook / test / sync actually succeeded. Configured-but-
// unproven sources stay "Not configured" with a note saying what's left to do.

export type SourceStatus = 'connected' | 'not_configured' | 'permission_required' | 'failed';
export type SourceAction = 'test' | 'sync' | 'subscribe' | 'import';

export interface Credential { env: string; label: string; secret: boolean; required: boolean; set: boolean }
export interface SourceView {
  id: string;
  name: string;
  group: 'website' | 'ads' | 'import' | 'portal';
  icon: string;
  description: string;
  status: SourceStatus;
  status_note: string;
  records: number;
  last_record_at: string | null;
  last_success_at: string | null;
  last_success_was_test: boolean;
  last_error: string | null;
  last_error_at: string | null;
  webhook_url?: string;
  credentials: Credential[];
  setup: string[];
  actions: SourceAction[];
  portal?: Portal;
}

const cred = (env: string, label: string, secret = true, required = true): Credential => ({ env, label, secret, required, set: !!(process.env[env] || '').trim() });

/** Counts of website leads per channel, straight from the lead tables. */
async function websiteCounts() {
  const safe = async (text: string) => { try { return (await query(text)).rows; } catch { return []; } };
  const contact = await safe(`SELECT CASE WHEN doc->>'source' = 'Buyer sign-up' THEN 'signup' WHEN doc->>'source' = 'buyer-requirement' THEN 'requirement' ELSE 'contact' END AS k,
      COUNT(*)::int AS n, MAX(doc->>'created_at') AS last FROM contact_leads GROUP BY 1`);
  const map = await safe(`SELECT CASE WHEN doc ? 'integration_app_id' THEN 'partner' WHEN doc ? 'ingest_source' THEN 'ingest' ELSE 'map' END AS k,
      COUNT(*)::int AS n, MAX(doc->>'created_at') AS last FROM leads GROUP BY 1`);
  const apps = await safe(`SELECT COUNT(*)::int AS n FROM api_apps WHERE status = 'active'`);
  const by = new Map<string, { n: number; last: string | null }>();
  for (const r of [...contact, ...map]) by.set(String(r.k), { n: Number(r.n) || 0, last: r.last || null });
  return { by, activeApps: Number(apps[0]?.n) || 0 };
}

function fromLog(st: SourceStats | undefined) {
  return {
    last_success_at: st?.last_ok_at || null,
    last_success_was_test: !!st?.last_ok_test,
    last_error: st?.last_error || null,
    last_error_at: st?.last_error_at || null,
  };
}

/** The latest event failed (and nothing succeeded after it). */
const failingNow = (st?: SourceStats) => !!st && st.last_any_ok === false;

export async function listSources(): Promise<SourceView[]> {
  const [{ by, activeApps }, stats, ingested, portals] = await Promise.all([
    websiteCounts(), statsBySource().catch(() => new Map<string, SourceStats>()),
    leadCountsBySource().catch(() => new Map()), listPortals().catch(() => [] as Portal[]),
  ]);
  const site = (k: string) => by.get(k) || { n: 0, last: null };
  const website = (id: string, k: string, name: string, icon: string, description: string, setup: string[]): SourceView => ({
    id, name, group: 'website', icon: `fas ${icon}`, description,
    status: 'connected', status_note: 'Built into the Mappingg website — every submission is saved straight to the database.',
    records: site(k).n, last_record_at: site(k).last, last_success_at: site(k).last, last_success_was_test: false,
    last_error: null, last_error_at: null, credentials: [], setup, actions: [],
  });

  const out: SourceView[] = [
    website('website_contact', 'contact', 'Contact form', 'fa-envelope', 'Messages from /contact, including the "Buying a home" topic with area, BHK, budget and timeline.',
      ['Nothing to set up. Submissions appear in Leads → Contact and here.']),
    website('website_requirement', 'requirement', 'Buyer requirement form', 'fa-clipboard-list', 'The public form at /buyer-requirement: preferred area, BHK, budget, timeline and explicit contact consent.',
      ['Nothing to set up. Link to /buyer-requirement from ads, WhatsApp or the site menu to collect requirements.']),
    website('website_map', 'map', 'Live-map enquiries', 'fa-map-location-dot', '"Enquire now" on project cards in the live map, from guests and signed-in accounts.',
      ['Nothing to set up. Enquiries appear in Leads → Map enquiries and here.']),
    website('website_signup', 'signup', 'Buyer accounts', 'fa-user-plus', 'Buyers who created an account, with the preferences they gave at sign-up.',
      ['Nothing to set up. Every buyer account is added as a lead automatically.']),
  ];

  const partner = site('partner');
  out.push({
    id: 'partner_api', name: 'Partner websites (Developer API)', group: 'website', icon: 'fas fa-plug',
    description: 'Enquiries partner websites send through POST /api/v1/enquiries.',
    status: activeApps ? 'connected' : 'not_configured',
    status_note: activeApps ? `${activeApps} active application(s) can send enquiries.` : 'No active Developer API application has the enquiries scope yet.',
    records: partner.n, last_record_at: partner.last, last_success_at: partner.last, last_success_was_test: false, last_error: null, last_error_at: null,
    credentials: [], setup: ['Super admin → Developer API → create an application with the "enquiries:submit" scope and the partner\'s website, then share the key with them.'], actions: [],
  });

  // ---- Google Ads ----
  const g = stats.get(GOOGLE_SOURCE);
  const gConf = googleConfigured();
  const gStatus: SourceStatus = !gConf ? 'not_configured' : failingNow(g) ? 'failed' : g?.last_ok_at ? 'connected' : 'not_configured';
  out.push({
    id: GOOGLE_SOURCE, name: 'Google Ads lead forms', group: 'ads', icon: 'fab fa-google',
    description: 'Leads from Google Ads lead form assets, delivered instantly by webhook.',
    status: gStatus,
    status_note: !gConf ? 'Set GOOGLE_ADS_LEAD_WEBHOOK_KEY (at least 16 characters) on the server first.'
      : gStatus === 'failed' ? 'The last webhook was rejected or could not be saved — see the error.'
        : gStatus === 'connected' ? (g?.real_events ? 'Receiving leads.' : 'Google Ads test data received — waiting for the first real lead.')
          : 'Key is set on the server, but no webhook has arrived yet. Add the URL and key in Google Ads and click "Send test data".',
    records: ingested.get(GOOGLE_SOURCE)?.n || 0, last_record_at: ingested.get(GOOGLE_SOURCE)?.last || null,
    ...fromLog(g),
    webhook_url: `${SITE_URL}/api/integrations/google-ads/leads`,
    credentials: [cred('GOOGLE_ADS_LEAD_WEBHOOK_KEY', 'Webhook key (any long random string; the same value goes in Google Ads)')],
    setup: [
      'Generate a long random key (e.g. 32+ characters) and add it to the server environment as GOOGLE_ADS_LEAD_WEBHOOK_KEY (Vercel → Project → Settings → Environment Variables), then redeploy.',
      'In Google Ads open the campaign\'s lead form asset → "Lead delivery option" → "Webhook integration".',
      'Paste the webhook URL shown here and the same key.',
      'Click "Send test data". This panel should then show a successful test (test data is never saved as a lead).',
      'Repeat for each lead form. Leads older than the webhook can be downloaded as CSV in Google Ads and brought in with CSV import.',
    ],
    actions: ['test'],
  });

  // ---- Meta ----
  const m = stats.get(META_SOURCE);
  const mConf = metaConfigured();
  const lastKind = m?.last_any_ok === false ? (m.last_error_kind === 'permission' ? 'permission' : 'failed') : null;
  // The webhook handshake alone proves nothing about Graph access: Connected needs a passing test, a sync or a real lead.
  const mProven = mConf && (!!(await lastOk(META_SOURCE, 'test').catch(() => null)) || !!(await lastOk(META_SOURCE, 'sync').catch(() => null)) || (m?.real_events || 0) > 0);
  const mStatus: SourceStatus = !mConf ? 'not_configured' : lastKind === 'permission' ? 'permission_required' : lastKind === 'failed' ? 'failed' : mProven ? 'connected' : 'not_configured';
  const env = metaEnv();
  out.push({
    id: META_SOURCE, name: 'Meta lead ads (Facebook & Instagram)', group: 'ads', icon: 'fab fa-facebook',
    description: 'Instant-form leads from Facebook and Instagram ads, through the official Graph API and webhooks.',
    status: mStatus,
    status_note: !mConf ? 'Set META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN, META_PAGE_ID and META_PAGE_ACCESS_TOKEN on the server first.'
      : mStatus === 'permission_required' ? 'Meta refused access — the token is missing a permission or the app needs Advanced Access for leads_retrieval.'
        : mStatus === 'failed' ? 'The last call to Meta failed — see the error.'
          : mStatus === 'connected' ? 'Connected to the Page.' : 'Credentials are set. Click "Test connection" to check them.',
    records: ingested.get(META_SOURCE)?.n || 0, last_record_at: ingested.get(META_SOURCE)?.last || null,
    ...fromLog(m),
    webhook_url: `${SITE_URL}/api/integrations/meta/leads`,
    credentials: [
      cred('META_APP_SECRET', 'App secret (Meta app → App settings → Basic)'),
      cred('META_WEBHOOK_VERIFY_TOKEN', 'Webhook verify token (any random string you choose)'),
      cred('META_PAGE_ID', 'Facebook Page ID that runs the lead ads', false),
      cred('META_PAGE_ACCESS_TOKEN', 'Long-lived Page access token (System User token recommended)'),
      cred('META_GRAPH_VERSION', `Graph API version (optional, default ${env.version === 'v23.0' ? 'v23.0' : env.version})`, false, false),
      cred('META_LEAD_FORM_IDS', 'Lead form IDs to sync, comma-separated (optional; default: all forms on the Page)', false, false),
    ],
    setup: [
      'Create (or open) a Meta app of type "Business" at developers.facebook.com, linked to your Business Manager.',
      'Permissions needed: leads_retrieval, pages_show_list, pages_read_engagement, pages_manage_metadata, pages_manage_ads (and business_management if the Page is owned by a Business). leads_retrieval needs Advanced Access through App Review for leads from people outside your app roles.',
      'In Business Settings → Users → System users, create a system user, give it the Page (and ad account), and generate a token with the permissions above. Use it as META_PAGE_ACCESS_TOKEN.',
      'Business Settings → Integrations → Leads Access: allow this app (and the CRM) to access the Page\'s leads.',
      'Add META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN, META_PAGE_ID and META_PAGE_ACCESS_TOKEN to the server environment and redeploy.',
      'App dashboard → Webhooks → Page → Subscribe: callback URL = the webhook URL shown here, verify token = META_WEBHOOK_VERIFY_TOKEN; then subscribe to the "leadgen" field.',
      'Here: click "Test connection", then "Subscribe Page" if it says the Page isn\'t subscribed, then "Run sync" to pull the last 90 days.',
      'Check with Meta\'s Lead Ads Testing Tool — test leads prove the webhook but are never saved as leads.',
    ],
    actions: ['test', 'subscribe', 'sync'],
  });

  // ---- CSV ----
  const c = stats.get(CSV_SOURCE);
  out.push({
    id: CSV_SOURCE, name: 'CSV import (broker referrals & enquiries)', group: 'import', icon: 'fas fa-file-csv',
    description: 'Upload a CSV from a broker or your own offline enquiries. Requires the supplier and the consent basis; duplicates are skipped.',
    status: failingNow(c) ? 'failed' : 'connected',
    status_note: 'Built in. Every import is previewed first and logged here.',
    records: ingested.get(CSV_SOURCE)?.n || 0, last_record_at: ingested.get(CSV_SOURCE)?.last || null,
    ...fromLog(c), credentials: [],
    setup: [
      'Only import people who agreed to be contacted by Associatte PropTech (Mappingg) — say how in "Consent basis".',
      'Include a consent column (yes/no) if the supplier recorded consent per person; rows without a clear "yes" are then skipped.',
      'Preview first. Nothing is saved until you click Import.',
    ],
    actions: ['import'],
  });

  // ---- portals ----
  for (const p of portals) {
    const st = stats.get(`portal:${p.id}`);
    const status: SourceStatus = p.permission === 'permitted' ? 'not_configured' : 'permission_required';
    out.push({
      id: `portal:${p.id}`, name: p.name, group: 'portal', icon: 'fas fa-globe', description: p.data_scope || 'Public property portal',
      status,
      status_note: p.permission === 'permitted'
        ? 'Permission recorded, but no automated connector exists for this portal. Nothing is fetched.'
        : p.permission === 'denied' ? 'The portal owner refused automated access. Nothing is fetched.'
          : 'No written permission from the portal owner for automated access. Nothing is fetched.',
      records: 0, last_record_at: null, ...fromLog(st),
      credentials: [],
      setup: [
        'Read the portal\'s terms of use and robots.txt; contact the portal for written permission or an official feed/API for the exact data and use you need.',
        'Record the answer here (permission, note, link to the email or agreement).',
        'Never collect buyers\' names, phones or emails from a portal — buyer contact details only come from people who contacted you directly.',
      ],
      actions: [], portal: p,
    });
  }
  return out;
}

/** Common Indian property portals, added only when the admin asks. Permission starts as "not reviewed". */
export const COMMON_PORTALS: Pick<Portal, 'id' | 'name' | 'url'>[] = [
  { id: '99acres', name: '99acres', url: 'https://www.99acres.com' },
  { id: 'magicbricks', name: 'MagicBricks', url: 'https://www.magicbricks.com' },
  { id: 'housing', name: 'Housing.com', url: 'https://housing.com' },
  { id: 'nobroker', name: 'NoBroker', url: 'https://www.nobroker.in' },
  { id: 'squareyards', name: 'Square Yards', url: 'https://www.squareyards.com' },
  { id: 'proptiger', name: 'PropTiger', url: 'https://www.proptiger.com' },
  { id: 'makaan', name: 'Makaan.com', url: 'https://www.makaan.com' },
];
export const DEFAULT_PORTAL_SCOPE = 'Public listing / project data only. Buyer contact details are never collected from portals.';

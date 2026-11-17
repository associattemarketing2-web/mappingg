import { getDb } from '../mongodb';
import { esc, layout, notifyAdmin, queueMail } from '../mailer';
import { sql, type Sql } from './db';
import { newId } from './store';
import { CATEGORY_LABEL, formatInr, type Category } from './catalog';

// Subscription notifications: an in-app item (sub_notifications, shown in the
// dashboards' bells and on My subscription) plus an email through the existing
// mailer (lib/mailer.ts — SMTP, queued, never blocks a request). A dedupe key
// makes reminders idempotent: the daily cron can run any number of times and a
// "7 days left" reminder is still sent once per subscription term.

export type SubNotice =
  | 'activated' | 'payment_success' | 'payment_failed' | 'expiring' | 'expired' | 'renewed'
  | 'upgraded' | 'downgraded' | 'refund_processed' | 'limit_reached' | 'cancelled' | 'past_due';

export interface NoticeCtx {
  plan?: string;
  amount_paise?: number;
  expires_at?: string | null;
  days?: number;
  reason?: string;
  invoice?: string;
}

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');

export function subscriptionPath(category: Category | null | undefined): string {
  const role = category === 'cp' ? 'agent' : category || 'buyer';
  return `/dashboard/${role}/subscription`;
}

/** Title + body for each notice, worded per account type. */
export function template(type: SubNotice, category: Category, c: NoticeCtx): { title: string; body: string; adminCopy: boolean } {
  const who = CATEGORY_LABEL[category];
  const plan = c.plan || 'your plan';
  const perks = category === 'developer' ? 'your project features' : category === 'cp' ? 'your project access, brochures and CRM' : 'your premium buyer tools';
  switch (type) {
    case 'activated': return { title: `${plan} is active`, body: `Your ${who} subscription is active${c.expires_at ? ` until ${fmtDate(c.expires_at)}` : ''}. ${perks[0].toUpperCase()}${perks.slice(1)} are unlocked.`, adminCopy: true };
    case 'payment_success': return { title: 'Payment received', body: `We received ${c.amount_paise != null ? formatInr(c.amount_paise) : 'your payment'} for ${plan}.${c.invoice ? ` Invoice ${c.invoice} is in My subscription.` : ''}`, adminCopy: false };
    case 'payment_failed': return { title: 'Payment failed', body: `Your payment for ${plan} did not go through${c.reason ? ` (${c.reason})` : ''}. No money was taken for a failed payment — you can try again from My subscription.`, adminCopy: true };
    case 'expiring': return { title: `${plan} ends in ${c.days} day${c.days === 1 ? '' : 's'}`, body: `Your subscription ends on ${fmtDate(c.expires_at)}. Renew now to keep ${perks} without a break.`, adminCopy: false };
    case 'past_due': return { title: `${plan} has ended — renewal required`, body: `Your subscription ended on ${fmtDate(c.expires_at)}. ${perks[0].toUpperCase()}${perks.slice(1)} stay on for a short grace period — renew to keep them.`, adminCopy: false };
    case 'expired': return { title: `${plan} has expired`, body: `Your account is back on the Free plan. Nothing was deleted — renew any time to unlock ${perks} again.`, adminCopy: true };
    case 'renewed': return { title: `${plan} renewed`, body: `Thanks! Your subscription now runs until ${fmtDate(c.expires_at)}.`, adminCopy: true };
    case 'upgraded': return { title: `Upgraded to ${plan}`, body: `Your new plan is active${c.expires_at ? ` until ${fmtDate(c.expires_at)}` : ''}.`, adminCopy: true };
    case 'downgraded': return { title: `Plan change scheduled`, body: `You will move to ${plan} when your current term ends${c.expires_at ? ` on ${fmtDate(c.expires_at)}` : ''}.`, adminCopy: true };
    case 'refund_processed': return { title: 'Refund processed', body: `${c.amount_paise != null ? formatInr(c.amount_paise) : 'Your refund'} was refunded to your original payment method. Banks usually take 5–7 working days to show it.`, adminCopy: true };
    case 'limit_reached': return { title: 'Plan limit reached', body: category === 'cp' ? 'You have used every project-detail view on your plan for this week. Upgrade for more, or wait for the weekly reset on Monday.' : category === 'buyer' ? 'You have opened every property listing your Free plan includes. Upgrade to Buyer Premium for unlimited listings.' : 'You have reached a limit on your plan. Upgrade to add more.', adminCopy: false };
    case 'cancelled': return { title: `${plan} cancelled`, body: c.expires_at ? `Your plan stays active until ${fmtDate(c.expires_at)} and will not be renewed.` : 'Your subscription was cancelled.', adminCopy: true };
  }
}

/**
 * Record an in-app notification and email the account holder. Returns false
 * when the dedupe key was already used (nothing sent).
 */
export async function notifySub(
  userId: string, category: Category, type: SubNotice, ctx: NoticeCtx = {},
  opts: { dedupeKey?: string; email?: boolean; q?: Sql } = {},
): Promise<boolean> {
  const t = template(type, category, ctx);
  const link = subscriptionPath(category);
  const q = opts.q || sql;
  const r = await q(
    `INSERT INTO sub_notifications (id, user_id, category, type, title, body, link, dedupe_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [newId('ntf'), userId, category, type, t.title, t.body, link, opts.dedupeKey || null],
  );
  if (!r.rows.length) return false;
  if (opts.email !== false) {
    // Email after the in-app record; mail failures never undo a billing change.
    void (async () => {
      try {
        const u = await (await getDb()).collection('users').findOne({ id: userId }, { projection: { email: 1, name: 1 } });
        const email = String(u?.email || '');
        const name = String(u?.name || '').split(' ')[0] || 'there';
        if (email) {
          queueMail({ to: email, subject: `${t.title} — Mappingg`, html: layout({ title: t.title, body: [`Hi ${esc(name)},`, esc(t.body)], cta: { label: 'Open My subscription', href: link } }) });
        }
        if (t.adminCopy) {
          notifyAdmin(`Subscription: ${t.title} — ${email || userId}`, { title: t.title, body: [esc(t.body)], rows: [['Account', email || userId], ['Type', CATEGORY_LABEL[category]], ['Plan', ctx.plan || '']], cta: { label: 'Open Subscriptions', href: '/dashboard/s-admin?tab=subscriptions' } });
        }
      } catch (e) {
        console.warn('[subscriptions] notification email failed:', e instanceof Error ? e.message : e);
      }
    })();
  }
  return true;
}

export interface SubNotification { id: string; type: SubNotice; title: string; body: string; link: string | null; read_at: string | null; created_at: string }

export async function listNotifications(userId: string, limit = 30): Promise<SubNotification[]> {
  const r = await sql(`SELECT id, type, title, body, link, read_at, created_at FROM sub_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, [userId, limit]);
  return r.rows.map((n) => ({
    id: String(n.id), type: n.type, title: String(n.title), body: String(n.body), link: n.link || null,
    read_at: n.read_at ? new Date(n.read_at).toISOString() : null, created_at: new Date(n.created_at).toISOString(),
  }));
}

export async function markNotificationsRead(userId: string) {
  await sql(`UPDATE sub_notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [userId]);
}

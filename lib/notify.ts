import { getDb } from './mongodb';
import { esc, layout, notifyAdmin, queueMail } from './mailer';

// Email for account / project events: one to the account holder and a copy to
// the Mappingg team (ADMIN_NOTIFY_EMAIL). Called from logActivity(), so every
// sign-up, project added / edited / approved / rejected, verification decision
// and so on sends mail without each route having to remember to.
// Routine events (logins, compare list, favourites, internal notes) send nothing.

const ROLE: Record<string, string> = { buyer: 'Buyer / Investor', developer: 'Developer / Builder', agent: 'Channel Partner' };

type Event = { user_id: string; email: string; name?: string; role?: string; type: string; detail?: string; actor?: string };
type Msg = { subject: string; title: string; intro?: string; cta?: { label: string; href: string } };

const dash = { label: 'Open your dashboard', href: '/dashboard' };

/** What the account holder is told, per event type. Missing = no mail to them. */
const USER: Record<string, (e: Event) => Msg> = {
  signup: (e) => e.role === 'buyer'
    ? { subject: 'Welcome to Mappingg', title: 'Your account is ready', intro: 'The live map is unlocked — open any pin to see status, RERA number and possession date.', cta: { label: 'Open the live map', href: '/map' } }
    : { subject: 'Welcome to Mappingg — verification in progress', title: 'Your account was created', intro: 'We will verify your MahaRERA number shortly (usually within one working day) and email you as soon as your account is approved.', cta: dash },
  project_added: () => ({ subject: 'Project received — waiting for review', title: 'We received your project', intro: 'The Mappingg team will review it and email you when it is live on the map.', cta: dash }),
  project_edited: () => ({ subject: 'Project changes received — waiting for review', title: 'We received your changes', intro: 'They go live on the map once the Mappingg team approves them.', cta: dash }),
  project_delete_requested: () => ({ subject: 'Delete request received', title: 'We received your delete request', cta: dash }),
  project_approved: () => ({ subject: 'Your project is live on Mappingg', title: 'Project approved', cta: { label: 'See it on the map', href: '/map' } }),
  project_rejected: () => ({ subject: 'Your project needs changes', title: 'Project not approved', intro: 'Edit the project in your dashboard and send it again.', cta: dash }),
  project_delete_approved: () => ({ subject: 'Your project was deleted', title: 'Delete request approved', cta: dash }),
  project_delete_rejected: () => ({ subject: 'Your delete request was declined', title: 'Delete request declined', cta: dash }),
  project_deleted: () => ({ subject: 'A project was removed', title: 'Project removed', cta: dash }),
  project_admin_edit: () => ({ subject: 'Mappingg updated your project', title: 'Project details corrected', cta: dash }),
  approved: () => ({ subject: 'Your Mappingg account is verified', title: 'Account approved', intro: 'Your dashboard is unlocked.', cta: dash }),
  rejected: () => ({ subject: 'Your Mappingg application', title: 'Application not approved', intro: 'Reply to this email if you think this is a mistake.' }),
  access: () => ({ subject: 'Your Mappingg access changed', title: 'Access updated', cta: dash }),
  reset: () => ({ subject: 'Your Mappingg account is under review', title: 'Verification pending', intro: 'We will email you once it has been checked again.' }),
  password_reset: () => ({ subject: 'Your Mappingg password was changed', title: 'Password changed', intro: 'If this wasn’t you, reply to this email right away.' }),
  profile_edited: () => ({ subject: 'Your Mappingg account details were updated', title: 'Account details updated', cta: dash }),
  deleted: () => ({ subject: 'Your Mappingg account was closed', title: 'Account deleted' }),
};

/** Admin subject line, per event type. Missing = no admin copy. */
const ADMIN: Record<string, (e: Event, who: string) => string> = {
  signup: (e, who) => `New ${ROLE[String(e.role)] || 'account'} sign-up: ${who}`,
  project_added: (_, who) => `Project added by ${who} — review needed`,
  project_edited: (_, who) => `Project edited by ${who} — review needed`,
  project_delete_requested: (_, who) => `Delete request from ${who}`,
  project_approved: (_, who) => `Project approved for ${who}`,
  project_rejected: (_, who) => `Project rejected for ${who}`,
  project_delete_approved: (_, who) => `Project deleted for ${who}`,
  project_delete_rejected: (_, who) => `Delete request declined for ${who}`,
  project_deleted: (_, who) => `Project deleted (${who})`,
  project_admin_edit: (_, who) => `Project corrected for ${who}`,
  approved: (_, who) => `Account approved: ${who}`,
  rejected: (_, who) => `Account rejected: ${who}`,
  access: (_, who) => `Access changed: ${who}`,
  reset: (_, who) => `Account moved back to pending: ${who}`,
  password_reset: (_, who) => `Password changed: ${who}`,
  profile_edited: (_, who) => `Account details edited: ${who}`,
  deleted: (_, who) => `Account deleted: ${who}`,
};

const PROFILE_LABEL: Record<string, string> = {
  area: 'Preferred area', configuration: 'Configuration', budget: 'Budget', timeline: 'Planning to buy', purpose: 'Buying for',
  company: 'Company', designation: 'Designation', activeProjects: 'Active projects', reraProject: 'MahaRERA project no.', website: 'Website',
  agency: 'Agency', reraAgent: 'MahaRERA agent no.', areas: 'Areas',
};

export async function notifyActivity(e: Event): Promise<void> {
  const user = USER[e.type];
  const admin = ADMIN[e.type];
  if (!user && !admin) return;
  try {
    // The account's mobile number and sign-up details, for the admin copy.
    const doc = await (await getDb()).collection('users')
      .findOne({ id: e.user_id }, { projection: { name: 1, mobile: 1, role: 1, profile: 1, provider: 1, company: 1 } })
      .catch(() => null);
    const name = String(e.name || doc?.name || '').trim();
    const role = String(e.role || doc?.role || '');
    const who = name || e.email;

    if (user && e.email) {
      const m = user({ ...e, role });
      queueMail({
        to: e.email,
        subject: m.subject,
        html: layout({
          title: m.title,
          body: [`Hi ${esc(name.split(' ')[0] || 'there')},`, e.detail ? esc(e.detail) : '', m.intro ? esc(m.intro) : ''].filter(Boolean),
          cta: m.cta,
        }),
      });
    }

    if (admin) {
      const profile = (doc?.profile && typeof doc.profile === 'object' ? doc.profile : {}) as Record<string, unknown>;
      notifyAdmin(admin({ ...e, role }, who), {
        title: admin({ ...e, role }, who),
        body: e.detail ? [esc(e.detail)] : [],
        rows: [
          ['Name', name], ['Email', e.email], ['Mobile', doc?.mobile || (e.type === 'signup' && doc?.provider === 'google' ? 'Not added yet (Google sign-in)' : '')],
          ['Account type', ROLE[role] || role], ['Done by', e.actor],
          ...(e.type === 'signup' ? Object.entries(profile).map(([k, v]) => [PROFILE_LABEL[k] || k, v] as [string, unknown]) : []),
        ],
        cta: { label: 'Open admin', href: '/dashboard/s-admin' },
      }, e.email);
    }
  } catch (err) {
    console.warn('[notify] failed for', e.type, err instanceof Error ? err.message : err);
  }
}

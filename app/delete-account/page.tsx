import type { Metadata } from 'next';
import Link from 'next/link';
import InfoPage, { ContactBlock } from '@/components/InfoPage';
import DeleteAccountForm, { type DeleteAccountState } from '@/components/DeleteAccountForm';
import { PUBLIC_ROLES, getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { buildMetadata } from '@/lib/seo/metadata';

// Public account deletion page. Google Play requires a web link where people can
// delete their account, or ask for it, without the app (Play Console → App
// content → Data safety). What is deleted: lib/account-deletion.ts.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = buildMetadata({
  title: 'Delete your Mappingg account',
  description: 'Delete your Mappingg account and personal data, from the website or the Mappingg app, with or without signing in.',
  path: '/delete-account',
});

async function accountState(): Promise<{ state: DeleteAccountState; email?: string; name?: string }> {
  const me = await getCurrentUser().catch(() => null);
  if (!me) return { state: 'signed-out' };
  if (!(PUBLIC_ROLES as readonly string[]).includes(me.role)) return { state: 'staff', email: me.email };
  const user = await (await getDb()).collection('users')
    .findOne({ id: me.id }, { projection: { email: 1, name: 1, password_hash: 1 } })
    .catch(() => null);
  if (!user) return { state: 'signed-out' };
  return {
    state: user.password_hash ? 'password' : 'no-password',
    email: String(user.email || me.email),
    name: user.name ? String(user.name) : '',
  };
}

export default async function DeleteAccountPage() {
  const account = await accountState();
  return (
    <InfoPage
      path="/delete-account"
      crumb="Delete account"
      eyebrow="Your data"
      icon="fas fa-user-xmark"
      tone="earth"
      title={<>Delete your <span className="accent">Mappingg account</span></>}
      intro="You can delete your account at any time, here or in the Mappingg app (Account → Delete my account)."
    >
      <section className="ipg-section">
        <div className="container da-layout">
          <div className="da-info">
            <h2>What happens when you delete</h2>

            <h3><i className="fas fa-trash-can" aria-hidden="true" /> Deleted permanently</h3>
            <ul>
              <li>Your account: name, email, WhatsApp number and password</li>
              <li>Your sign-up details, buyer preferences, compare list and favourites</li>
              <li>Your sign-in on every device. You are signed out everywhere.</li>
            </ul>

            <h3><i className="fas fa-user-secret" aria-hidden="true" /> Kept without your name or contact details</h3>
            <ul>
              <li>Records of the projects you enquired about, and when, so we keep accurate statistics. Your name, email, phone number and messages are removed from them.</li>
              <li>Our account activity log, with your email, name, IP address and device removed.</li>
            </ul>

            <h3><i className="fas fa-building" aria-hidden="true" /> Developer accounts</h3>
            <ul>
              <li>Projects you added stay on the live map as public project information. They are no longer linked to you.</li>
            </ul>

            <h3><i className="fas fa-clock" aria-hidden="true" /> Timing</h3>
            <ul>
              <li>With your password: deleted immediately.</li>
              <li>By request (Google or WhatsApp sign-in, or if you can&apos;t sign in): within 30 days. We may contact you first to confirm it is your account.</li>
              <li>Copies of enquiries already sent to our team by email or to our sales sheet are removed within 30 days.</li>
            </ul>

            <p className="da-more">
              More in our <Link href="/privacy">Privacy Policy</Link>. Questions? Contact us:
            </p>
            <ContactBlock />
          </div>

          <div className="da-form">
            <DeleteAccountForm state={account.state} email={account.email} name={account.name} />
          </div>
        </div>
      </section>
    </InfoPage>
  );
}

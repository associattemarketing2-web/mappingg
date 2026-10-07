import Link from 'next/link';
import InfoPage, { ContactBlock, LegalDoc, UpdatedChip, type LegalSection } from '@/components/InfoPage';
import { CookieSettingsButton } from '@/components/CookieConsent';
import { EMAIL } from '@/lib/contact';

const ext = { target: '_blank', rel: 'noopener' } as const;

// Keep in step with the cookies the code actually sets: lib/auth.ts (session),
// lib/google-oauth.ts (Google sign-in), components/CookieConsent.tsx (choice)
// and Google Tag Manager (analytics, only after consent).
const ESSENTIAL = [
  { name: 'mg_session', purpose: 'Keeps you signed in to your Mappingg account.', duration: '60 days' },
  { name: 'mg_oauth_state, mg_oauth_verifier', purpose: 'Protect the “Sign in with Google” round-trip from tampering.', duration: '10 minutes' },
  { name: 'mg_cookie_consent', purpose: 'Remembers your cookie choice so we don’t ask again.', duration: '1 year' },
];
const ANALYTICS = [
  { name: '_ga', purpose: 'Google Analytics: tells visits apart so we can count unique visitors.', duration: '2 years' },
  { name: '_ga_<ID>', purpose: 'Google Analytics: keeps track of the current visit.', duration: '2 years' },
];

function CookieTable({ rows }: { rows: { name: string; purpose: string; duration: string }[] }) {
  return (
    <div className="ipg-table">
      <table>
        <thead>
          <tr><th>Cookie</th><th>Purpose</th><th>Duration</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td data-label="Cookie"><code>{r.name}</code></td>
              <td data-label="Purpose">{r.purpose}</td>
              <td data-label="Duration">{r.duration}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const sections: LegalSection[] = [
  {
    id: 'what-are-cookies',
    title: 'What cookies are',
    body: (
      <p>
        Cookies are small text files a website stores in your browser. They let the site remember things between pages
        and visits, such as the fact that you are signed in. We also use your browser&apos;s local storage for a few
        similar settings, and this policy covers those too.
      </p>
    ),
  },
  {
    id: 'essential',
    title: 'Essential cookies',
    body: (
      <>
        <p>
          These are needed for the Platform to work, for example to keep you signed in and secure. They are always on and
          are never used to track you across other websites.
        </p>
        <CookieTable rows={ESSENTIAL} />
      </>
    ),
  },
  {
    id: 'analytics',
    title: 'Analytics cookies',
    body: (
      <>
        <p>
          With your consent, we use Google Analytics, loaded through Google Tag Manager, to understand which pages and map
          features people use so we can improve them. These cookies are <strong>off until you choose
          &quot;Accept all&quot;</strong> in the cookie banner. If you choose &quot;Essential only&quot;, they are never set.
        </p>
        <CookieTable rows={ANALYTICS} />
        <p>
          Google processes this data under its own{' '}
          <a href="https://policies.google.com/privacy" {...ext}>Privacy Policy</a>.
        </p>
      </>
    ),
  },
  {
    id: 'third-party',
    title: 'Third-party services',
    body: (
      <p>
        Some pages load content from other services, such as map tiles, fonts, and embedded YouTube videos. Those services
        may set their own cookies, which are governed by their own policies. See our{' '}
        <Link href="/map-data">Map data &amp; OpenStreetMap policy</Link> for the map providers we use.
      </p>
    ),
  },
  {
    id: 'your-choices',
    title: 'Your choices',
    body: (
      <>
        <p>
          You can change your mind at any time. Open the cookie settings to switch between &quot;Accept all&quot; and
          &quot;Essential only&quot;:
        </p>
        <p><CookieSettingsButton /></p>
        <p>
          You can also block or delete cookies in your browser settings. If you block essential cookies, you won&apos;t be
          able to sign in.
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: (
      <p>
        If we start using new kinds of cookies, we will update this page and ask for your consent again where needed. The
        &quot;Last updated&quot; date always shows the latest revision. How we handle personal data in general is covered
        in our <Link href="/privacy">Privacy Policy</Link>.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact us',
    body: <ContactBlock />,
  },
];

export default function CookiesPage() {
  return (
    <InfoPage
      path="/cookies"
      crumb="Cookie policy"
      eyebrow="Legal"
      icon="fas fa-cookie-bite"
      tone="earth"
      title={<>Cookie <span className="accent">policy</span></>}
      intro="Which cookies Mappingg.com uses, why, and how to change your choice."
      meta={<UpdatedChip date="7 October 2026" />}
    >
      <LegalDoc
        path="/cookies"
        glance={[
          { icon: 'fas fa-lock', title: 'Essential only by default', text: 'Without your OK, we only set the cookies needed to sign in and stay secure.' },
          { icon: 'fas fa-chart-simple', tone: 'water', title: 'Analytics with consent', text: 'Google Analytics runs only after you choose “Accept all”.' },
          { icon: 'fas fa-sliders', tone: 'earth', title: 'Change any time', text: 'Reopen cookie settings from this page whenever you like.' },
        ]}
        intro={
          <>
            This Cookie Policy explains how Mappingg (&quot;we&quot;, &quot;us&quot;) uses cookies and similar
            technologies on https://www.mappingg.com/ (the &quot;Platform&quot;). Questions? Email us at{' '}
            <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.
          </>
        }
        sections={sections}
      />
    </InfoPage>
  );
}

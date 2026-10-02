import type { Metadata } from 'next';
import Link from 'next/link';
import InfoPage, { ContactBlock, LegalDoc, UpdatedChip, type LegalSection } from '@/components/InfoPage';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Mappingg and Associatte PropTech collect, use and protect your personal information, including how our OpenStreetMap-based maps work.',
  alternates: { canonical: `${SITE_URL}/privacy` },
};

const ext = { target: '_blank', rel: 'noopener' } as const;

const sections: LegalSection[] = [
  {
    id: 'information-you-give-us',
    title: 'Information you give us',
    body: (
      <>
        <p>We receive and store the information you knowingly provide when you:</p>
        <ul>
          <li>create an account — your full name, WhatsApp number, email address and password, or your basic Google profile if you sign in with Google;</li>
          <li>register as a developer or channel partner — your MahaRERA registration number, which we check on the MahaRERA website;</li>
          <li>enquire about a project on the live map — your name, WhatsApp number, email and the project you asked about;</li>
          <li>write to us, apply for a job or ask about advertising.</li>
        </ul>
        <p>You can choose not to give us some information, but some features of the Website may then be unavailable to you.</p>
      </>
    ),
  },
  {
    id: 'collected-automatically',
    title: 'Information collected automatically',
    body: (
      <p>
        When you visit the Website, our servers record information your browser sends, such as your IP address, browser
        type and version, operating system, language preferences, the page you came from, the pages you visit and the time
        spent on them, searches made on the Website, and access dates and times.
      </p>
    ),
  },
  {
    id: 'how-we-use-it',
    title: 'How we use your information',
    body: (
      <>
        <p>We use the information we collect to:</p>
        <ul>
          <li>run and operate the Website and your account;</li>
          <li>share project details you ask for and respond to your enquiries;</li>
          <li>contact you by phone, SMS, email, WhatsApp or RCS about your enquiries and about projects and offers, where you have agreed to this;</li>
          <li>verify developer and channel-partner registrations;</li>
          <li>improve the Website and our customer service;</li>
          <li>detect abuse and produce traffic and usage statistics that do not identify any individual user.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'maps-and-openstreetmap',
    title: 'Maps and OpenStreetMap',
    body: (
      <>
        <p>
          Our interactive maps are built with map data from{' '}
          <a href="https://www.openstreetmap.org/copyright" {...ext}>OpenStreetMap</a>, © OpenStreetMap contributors, made
          available under the Open Database License (ODbL). To display a map, your browser loads map images
          (&quot;tiles&quot;) directly from third-party servers rather than from us:
        </p>
        <div className="providers">
          <div>
            <i className="fas fa-map" aria-hidden="true" />
            <strong>Standard map view</strong>
            OpenStreetMap Foundation
            <br /><span>tile.openstreetmap.org</span>
          </div>
          <div>
            <i className="fas fa-satellite" aria-hidden="true" />
            <strong>Satellite view</strong>
            Esri
            <br /><span>server.arcgisonline.com</span>
          </div>
          <div>
            <i className="fas fa-cube" aria-hidden="true" />
            <strong>3D map view</strong>
            An independent open-source map tile service using OpenStreetMap data
          </div>
        </div>
        <p>
          When your browser requests these tiles, the provider automatically receives technical information such as your
          IP address, browser type and version, the address of the page you are viewing, and which map area and zoom level
          you are looking at. This is standard for any website that shows an online map. These providers handle that
          information under their own policies, which we do not control, including the{' '}
          <a href="https://osmfoundation.org/wiki/Privacy_Policy" {...ext}>OpenStreetMap Foundation Privacy Policy</a>, its{' '}
          <a href="https://operations.osmfoundation.org/policies/tiles/" {...ext}>Tile Usage Policy</a> and the{' '}
          <a href="https://www.esri.com/en-us/privacy/overview" {...ext}>Esri Privacy Statement</a>. Their servers may be
          located outside India. See our <Link href="/map-data">Map data &amp; OpenStreetMap policy</Link> for how we
          credit and use these providers.
        </p>
        <div className="note">
          <i className="fas fa-shield-halved" aria-hidden="true" />
          <span>
            We never send your name, phone number, email address or enquiry details to any map provider. The map does not
            read your device&apos;s GPS or location, and the locality search is matched within the page itself — your
            search terms are not sent to OpenStreetMap or any geocoding service.
          </span>
        </div>
      </>
    ),
  },
  {
    id: 'other-services',
    title: 'Other third-party services',
    body: (
      <p>
        We may use Google Tag Manager and related analytics tools to understand how the Website is used, Google Fonts to
        display text, and YouTube to play project videos. When these load, the provider receives technical information
        such as your IP address and browser details and handles it under its own privacy policy.
      </p>
    ),
  },
  {
    id: 'cookies',
    title: 'Cookies and browser storage',
    body: (
      <p>
        The Website uses cookies and your browser&apos;s local storage to keep you signed in, remember how many map
        searches you have used, and produce usage statistics. A cookie is a small text file stored by your browser; it
        cannot run programs or deliver viruses to your computer. Most browsers accept cookies automatically, but you can
        change your browser settings to refuse them. Some features, such as staying signed in, may not work without them.
      </p>
    ),
  },
  {
    id: 'sharing',
    title: 'Sharing your information',
    body: (
      <p>
        When you enquire about a project, we may share your contact details with that project&apos;s developer or its
        authorised representatives so they can respond to you. <strong>We do not sell your personal information.</strong>{' '}
        We may also disclose information where the law requires it, or to protect our rights, property or safety.
      </p>
    ),
  },
  {
    id: 'your-choices',
    title: 'Retention and your choices',
    body: (
      <p>
        We keep personal information for as long as it is needed for the purposes in this Policy, or as long as the law
        requires. You can ask us to access, correct or delete your personal information, or to stop contacting you, by
        writing to us at the address below. You can unsubscribe from our emails at any time using the link in each email.
      </p>
    ),
  },
  {
    id: 'children',
    title: 'Children',
    body: (
      <p>
        We do not knowingly collect personal information from children under the age of 13. If you are under 13, please do
        not submit any personal information through the Website. If you believe a child under 13 has given us personal
        information, please contact us and we will delete it.
      </p>
    ),
  },
  {
    id: 'security',
    title: 'Information security',
    body: (
      <p>
        We keep the information you provide on servers in a controlled, secure environment, and we maintain reasonable
        administrative, technical and physical safeguards against unauthorised access, use, modification and disclosure.
        However, no transmission over the Internet or a wireless network can be guaranteed to be completely secure, so we
        cannot guarantee the security of information exchanged between you and the Website.
      </p>
    ),
  },
  {
    id: 'data-breach',
    title: 'Data breach',
    body: (
      <p>
        If we become aware that the security of the Website has been compromised or that users&apos; personal information
        has been disclosed to unrelated third parties, we will take reasonable steps, including investigation, reporting
        and cooperation with law-enforcement authorities. Where there is a reasonable risk of harm to you, or where the law
        requires it, we will make reasonable efforts to notify you by email.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this Policy',
    body: (
      <p>
        We may update this Policy from time to time. Changes take effect when the updated Policy is posted on this page,
        and the &quot;Last updated&quot; date above will change. We will email registered users about significant
        changes. Continuing to use the Website after a change means you accept the updated Policy.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact us',
    body: (
      <>
        <p>If you have any questions about this Policy, or want to access or delete your data, please contact us:</p>
        <ContactBlock />
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <InfoPage
      path="/privacy"
      crumb="Privacy policy"
      eyebrow="Legal"
      icon="fas fa-user-shield"
      title={<>Your privacy, <span className="accent">plainly explained</span></>}
      intro="What we collect, why we collect it, who else sees it, and the choices you have."
      meta={<UpdatedChip />}
    >
      <LegalDoc
        path="/privacy"
        glance={[
          { icon: 'fas fa-address-card', title: 'What we collect', text: 'Details you give us when you sign up or enquire, plus standard browser information.' },
          { icon: 'fas fa-map-location-dot', tone: 'water', title: 'Map providers', text: 'Map images load from OpenStreetMap and others. They see your IP address, never your contact details.' },
          { icon: 'fas fa-hand-holding-heart', tone: 'earth', title: 'Never sold', text: 'We don’t sell your data. Ask us any time to see, correct or delete it.' },
        ]}
        intro={
          <>
            This Privacy Policy explains how Associatte PropTech Pvt Ltd (&quot;we&quot;, &quot;us&quot;) collects, uses
            and protects the personal information you (&quot;you&quot;, &quot;User&quot;) provide on mappingg.com,
            associatte.com and their products and services (the &quot;Website&quot;). It does not apply to companies we do
            not own or control, or to people we do not employ or manage.
          </>
        }
        sections={sections}
      />
    </InfoPage>
  );
}

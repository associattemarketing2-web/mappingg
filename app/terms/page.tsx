import Link from 'next/link';
import InfoPage, { ContactBlock, LegalDoc, OfficialChannels, UpdatedChip, type LegalSection } from '@/components/InfoPage';
import { EMAIL } from '@/lib/contact';

import { SITE_URL } from '@/lib/seo/config';

const sections: LegalSection[] = [
  {
    id: 'agreement',
    title: 'Agreement to Terms',
    body: (
      <>
        <p>
          By accessing or using https://www.mappingg.com/ (&quot;the Platform&quot;), you agree to be bound by these Terms
          of Service (&quot;Terms&quot;). If you do not agree to these Terms, please do not use the Platform.
        </p>
        <p>
          These Terms constitute a legally binding agreement between you and Mappingg (&quot;we&quot;, &quot;us&quot;,
          &quot;our&quot;), a SaaS company operating under the laws of India.
        </p>
      </>
    ),
  },
  {
    id: 'who-can-use',
    title: 'Who can use Mappingg',
    body: (
      <>
        <h3>Age requirement</h3>
        <p>
          You must be at least <strong>18 years of age</strong> to create an account or use the Platform. By using
          Mappingg, you confirm that you are 18 or older.
        </p>
        <h3>Eligibility</h3>
        <p>You may use Mappingg if:</p>
        <ul>
          <li>you are an individual buyer, investor, or real estate developer;</li>
          <li>you are a business entity acting through an authorised representative;</li>
          <li>you agree to comply with all applicable Indian laws and regulations.</li>
        </ul>
        <h3>Account registration</h3>
        <p>To access full features, you must create an account. You agree to:</p>
        <ul>
          <li>provide accurate, complete, and current information;</li>
          <li>keep your account credentials secure and confidential;</li>
          <li>notify us immediately of any unauthorised access to your account;</li>
          <li>be responsible for all activity that occurs under your account.</li>
        </ul>
        <p>
          Developer and channel-partner accounts get full access only after we verify the MahaRERA registration number
          provided. We may suspend or close accounts that break these Terms or give false information.
        </p>
      </>
    ),
  },
  {
    id: 'what-we-offer',
    title: 'What Mappingg is (and is not)',
    body: (
      <>
        <h3>What Mappingg provides</h3>
        <p>Mappingg is a <strong>real estate intelligence engine</strong> that provides:</p>
        <ul>
          <li>an interactive live map displaying real estate projects across India;</li>
          <li>tools for buyers to discover and explore properties;</li>
          <li>analytics and insights for investors;</li>
          <li>listing and project management tools for developers;</li>
          <li>AI-powered recommendations and market intelligence.</li>
        </ul>
        <h3>What Mappingg is not</h3>
        <p>
          <strong>Important:</strong> Mappingg is a technology platform, not a real estate agent, broker, or financial
          adviser. Specifically, we do <strong>not</strong>:
        </p>
        <ul>
          <li>represent buyers, sellers, investors, or developers in any transaction;</li>
          <li>provide legally binding property valuations;</li>
          <li>provide financial, investment, or legal advice;</li>
          <li>guarantee the accuracy of third-party property listings;</li>
          <li>facilitate or process property transactions or payments.</li>
        </ul>
        <p>
          Any real estate transaction you enter into as a result of using Mappingg is solely between you and the relevant
          parties. We are not a party to any such transaction.
        </p>
      </>
    ),
  },
  {
    id: 'information',
    title: 'Information on the Platform',
    body: (
      <>
        <p>
          Project information comes from developers, public records such as the MahaRERA website, and other sources, and
          is provided for reference only. We work to keep it accurate, but we do not guarantee that it is complete,
          current or without errors.
        </p>
        <div className="note">
          <i className="fas fa-circle-info" aria-hidden="true" />
          <span>
            Always confirm details with the developer and on the MahaRERA website before making any decision. See our{' '}
            <Link href="/disclaimer">Disclaimer</Link> for more.
          </span>
        </div>
      </>
    ),
  },
  {
    id: 'acceptable-use',
    title: 'Acceptable use',
    body: (
      <>
        <p>When using the Platform you agree not to:</p>
        <ul>
          <li>post or submit information that is false, misleading, unlawful or infringes anyone else&apos;s rights;</li>
          <li>copy, scrape or harvest projects, contact details or other data from the Platform by automated means;</li>
          <li>try to access parts of the Platform or its systems that you are not authorised to use, or interfere with how it works;</li>
          <li>use the Platform to send spam or unsolicited messages.</li>
        </ul>
        <p>Misuse of the Platform may result in account suspension.</p>
      </>
    ),
  },
  {
    id: 'listings',
    title: 'Listings by developers and partners',
    body: (
      <p>
        If you list or promote a project, you confirm that you are authorised to do so, that the information you provide
        is accurate and complies with the Real Estate (Regulation and Development) Act, 2016 and MahaRERA rules, and that
        you have the right to use any images, logos and brochures you upload. You allow us to display this material on
        the Platform. We may edit or remove any listing at our discretion.
      </p>
    ),
  },
  {
    id: 'your-content',
    title: 'Your content',
    body: (
      <p>
        <strong>You own the content you create on Mappingg</strong>, such as reviews, comments, map pins and project
        listings. By posting it, you grant Mappingg a non-exclusive, royalty-free licence to display, distribute and
        promote that content within the Platform and for marketing purposes. You can revoke this licence by deleting the
        content or your account.
      </p>
    ),
  },
  {
    id: 'ai-features',
    title: 'AI features',
    body: (
      <p>
        Mappingg uses AI to power features such as property recommendations, market insights and smart search on the
        live map. You can opt out of AI personalisation at any time by emailing <a href={`mailto:${EMAIL}`}>{EMAIL}</a>{' '}
        with the subject &quot;AI Opt-Out Request&quot;. See our <Link href="/privacy">Privacy Policy</Link> for details.
      </p>
    ),
  },
  {
    id: 'communications',
    title: 'Communications',
    body: (
      <p>
        By creating an account or sending an enquiry, you agree that we, and the developers or authorised representatives
        of the projects you enquire about, may contact you by phone, SMS, email, WhatsApp or RCS about your enquiry and
        related projects and offers. You can ask us to stop at any time.
      </p>
    ),
  },
  {
    id: 'intellectual-property',
    title: 'Intellectual property',
    body: (
      <p>
        The Platform&apos;s design, text, graphics and software belong to us or our licensors. Project names, logos and
        images belong to their respective developers. Map data is © OpenStreetMap contributors, available under the{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">Open Database License</a>, and
        satellite imagery belongs to its providers. See our <Link href="/map-data">Map data &amp; OpenStreetMap policy</Link>.
      </p>
    ),
  },
  {
    id: 'third-parties',
    title: 'Third-party links and services',
    body: (
      <p>
        The Platform links to and uses third-party services, such as map tile providers, the MahaRERA website, YouTube,
        WhatsApp, Instagram, LinkedIn and Facebook. We are not responsible for their content or practices, and your use
        of them is governed by their own terms.
      </p>
    ),
  },
  {
    id: 'official-channels',
    title: 'Official channels',
    body: (
      <>
        <p>
          Mappingg communicates only through the channels below. Messages, pages or profiles that use the Mappingg name
          from any other account are not ours, and we are not responsible for them. Content we post on these channels is
          covered by these Terms and by our <Link href="/disclaimer">Disclaimer</Link>.
        </p>
        <OfficialChannels />
      </>
    ),
  },
  {
    id: 'liability',
    title: 'Limitation of liability',
    body: (
      <p>
        The Platform is provided &quot;as is&quot; and &quot;as available&quot;. To the extent the law allows, we are not
        liable for any loss or damage arising from your use of the Platform or from relying on information shown on it,
        including any decision to book or buy a property.
      </p>
    ),
  },
  {
    id: 'privacy',
    title: 'Privacy',
    body: <p>How we handle your personal information is explained in our <Link href="/privacy">Privacy Policy</Link>.</p>,
  },
  {
    id: 'changes',
    title: 'Changes to these Terms',
    body: (
      <p>
        We will notify you at least <strong>30 days</strong> before any material changes to these Terms, by email and with
        a notice on the Platform. Minor changes, such as fixing typos or clarifying wording, may be made without advance
        notice, but the &quot;Last updated&quot; date will always show the latest revision. Continuing to use the Platform
        after changes take effect means you accept the updated Terms.
      </p>
    ),
  },
  {
    id: 'governing-law',
    title: 'Governing law',
    body: <p>These Terms are governed by the laws of India, and the courts of Pune, Maharashtra have exclusive jurisdiction.</p>,
  },
  {
    id: 'contact',
    title: 'Contact us',
    body: <ContactBlock />,
  },
];

export default function TermsPage() {
  return (
    <InfoPage
      path="/terms"
      crumb="Terms of use"
      eyebrow="Legal"
      icon="fas fa-file-signature"
      tone="water"
      title={<>Terms of <span className="accent">use</span></>}
      intro="The ground rules for using Mappingg.com and its live project map, written to be as clear and readable as possible."
      meta={<UpdatedChip />}
    >
      <LegalDoc
        path="/terms"
        glance={[
          { icon: 'fas fa-pen-nib', title: 'You own your content', text: 'Reviews, pins and listings you create on Mappingg stay yours.' },
          { icon: 'fas fa-handshake-slash', tone: 'water', title: 'Not a broker', text: 'We provide a real estate intelligence platform, not real estate agency or brokerage.' },
          { icon: 'fas fa-user-check', tone: 'earth', title: '18 or older', text: 'You must be 18 or older to use Mappingg.' },
          { icon: 'fas fa-bell', title: '30 days’ notice', text: 'We will notify you 30 days before any material changes to these Terms.' },
          { icon: 'fas fa-robot', tone: 'water', title: 'AI, your choice', text: 'We use AI to power features. You can opt out of AI personalisation.' },
          { icon: 'fas fa-scale-balanced', tone: 'earth', title: 'Be respectful', text: 'Misuse of the platform may result in account suspension.' },
        ]}
        intro={
          <>
            <p>
              <strong>Plain language commitment:</strong> legal documents don&apos;t have to be confusing. If you have any
              questions about anything written here, email us at <a href={`mailto:${EMAIL}`}>{EMAIL}</a> and we&apos;ll
              happily explain.
            </p>
            <p>
              These Terms of Service (&quot;Terms&quot;) are an agreement between you and Mappingg (&quot;we&quot;,
              &quot;us&quot;) and apply to your use of https://www.mappingg.com/ and its related services (the
              &quot;Platform&quot;). By using the Platform you agree to these Terms. If you do not agree, please do not use it.
            </p>
          </>
        }
        sections={sections}
      />
    </InfoPage>
  );
}

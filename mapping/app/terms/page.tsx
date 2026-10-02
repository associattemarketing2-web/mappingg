import type { Metadata } from 'next';
import Link from 'next/link';
import InfoPage, { ContactBlock, LegalDoc, UpdatedChip, type LegalSection } from '@/components/InfoPage';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

export const metadata: Metadata = {
  title: 'Terms of Use',
  description: 'The terms that apply when you use Mappingg.com, the live real estate project map by Associatte PropTech.',
  alternates: { canonical: `${SITE_URL}/terms` },
};

const sections: LegalSection[] = [
  {
    id: 'what-we-offer',
    title: 'What the Website offers',
    body: (
      <p>
        Mappingg shows real estate projects, upcoming infrastructure and nearby places on an interactive map, along with
        details such as project status, MahaRERA registration numbers and possession dates. Buyers can explore projects
        and enquire about them; developers and channel partners can register to list and promote projects.
      </p>
    ),
  },
  {
    id: 'information',
    title: 'Information on the Website',
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
    id: 'account',
    title: 'Your account',
    body: (
      <ul>
        <li>You must give accurate information when you create an account, and keep it up to date.</li>
        <li>You are responsible for keeping your password safe and for everything done through your account.</li>
        <li>Developer and channel-partner accounts get full access only after we verify the MahaRERA registration number provided.</li>
        <li>We may suspend or close accounts that break these Terms or give false information.</li>
      </ul>
    ),
  },
  {
    id: 'acceptable-use',
    title: 'Acceptable use',
    body: (
      <>
        <p>When using the Website you agree not to:</p>
        <ul>
          <li>post or submit information that is false, misleading, unlawful or infringes anyone else&apos;s rights;</li>
          <li>copy, scrape or harvest projects, contact details or other data from the Website by automated means;</li>
          <li>try to access parts of the Website or its systems that you are not authorised to use, or interfere with how it works;</li>
          <li>use the Website to send spam or unsolicited messages.</li>
        </ul>
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
        the Website. We may edit or remove any listing at our discretion.
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
        The Website&apos;s design, text, graphics and software belong to us or our licensors. Project names, logos and
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
        The Website links to and uses third-party services, such as map tile providers, the MahaRERA website, YouTube and
        WhatsApp. We are not responsible for their content or practices, and your use of them is governed by their own
        terms.
      </p>
    ),
  },
  {
    id: 'liability',
    title: 'Limitation of liability',
    body: (
      <p>
        The Website is provided &quot;as is&quot; and &quot;as available&quot;. To the extent the law allows, we are not
        liable for any loss or damage arising from your use of the Website or from relying on information shown on it,
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
        We may update these Terms from time to time. Changes take effect when they are posted on this page, and continuing
        to use the Website afterwards means you accept the updated Terms.
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
      intro="The ground rules for using Mappingg.com and its live project map."
      meta={<UpdatedChip />}
    >
      <LegalDoc
        path="/terms"
        glance={[
          { icon: 'fas fa-circle-check', title: 'Use it fairly', text: 'Give accurate details, keep your password safe and don’t scrape the map.' },
          { icon: 'fas fa-magnifying-glass', tone: 'water', title: 'Double-check details', text: 'Project information is for reference. Confirm with the developer and MahaRERA.' },
          { icon: 'fas fa-scale-balanced', tone: 'earth', title: 'Indian law', text: 'These Terms follow Indian law, with courts in Pune, Maharashtra.' },
        ]}
        intro={
          <>
            These Terms of Use (&quot;Terms&quot;) are an agreement between you and Associatte PropTech Pvt Ltd
            (&quot;we&quot;, &quot;us&quot;) and apply to your use of mappingg.com and its related services (the
            &quot;Website&quot;). By using the Website you agree to these Terms. If you do not agree, please do not use it.
          </>
        }
        sections={sections}
      />
    </InfoPage>
  );
}

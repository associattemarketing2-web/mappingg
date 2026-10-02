import type { Metadata } from 'next';
import InfoPage, { ContactBlock, LegalDoc, UpdatedChip, type LegalSection } from '@/components/InfoPage';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

export const metadata: Metadata = {
  title: 'Disclaimer',
  description: 'Project information on Mappingg.com is for reference only. Please confirm all details with the developer and MahaRERA.',
  alternates: { canonical: `${SITE_URL}/disclaimer` },
};

const sections: LegalSection[] = [
  {
    id: 'not-official',
    title: 'Not the developer’s official website',
    body: (
      <p>
        This is not the official website of any developer or property. It belongs to an authorised channel partner and is
        for information purposes only. All rights to developers&apos; logos and images are reserved to the respective
        developers.
      </p>
    ),
  },
  {
    id: 'reference-only',
    title: 'Information for reference only',
    body: (
      <>
        <p>
          By accessing this website, you confirm that the information on it, including brochures and marketing material,
          is for information purposes only, and that you have not relied on it to make any booking or purchase in any
          project. The website is updated regularly, but details such as prices, configurations, amenities and possession
          dates can change without notice.
        </p>
        <div className="note">
          <i className="fas fa-shield-halved" aria-hidden="true" />
          <span>
            RERA numbers are verified on the{' '}
            <a href="https://maharera.maharashtra.gov.in/" target="_blank" rel="noopener">MahaRERA website</a>. Other
            project information comes from developers and is shown for reference only. Please confirm all details with the
            developer and MahaRERA before making a decision.
          </span>
        </div>
      </>
    ),
  },
  {
    id: 'no-offer',
    title: 'No offer or advertisement',
    body: (
      <p>
        Nothing on this website constitutes advertising, marketing, booking, selling, an offer for sale, or an invitation
        to buy a unit in any project. We are not liable for any consequence of any action taken by a viewer relying on
        material or information on this website.
      </p>
    ),
  },
  {
    id: 'maps',
    title: 'Maps and locations',
    body: (
      <p>
        Project locations, boundaries, roads and infrastructure shown on the map are approximate and for illustration only.
        Upcoming infrastructure depends on government approvals and timelines that may change. Map data is © OpenStreetMap
        contributors.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact us',
    body: <ContactBlock />,
  },
];

export default function DisclaimerPage() {
  return (
    <InfoPage
      path="/disclaimer"
      crumb="Disclaimer"
      eyebrow="Legal"
      icon="fas fa-circle-exclamation"
      tone="road"
      title={<>Please <span className="accent">read first</span></>}
      intro="Before relying on any project information shown on Mappingg, here is what you should know."
      meta={<UpdatedChip />}
    >
      <LegalDoc
        path="/disclaimer"
        intro={
          <>
            This Disclaimer applies to mappingg.com and all microsites and websites owned by Associatte PropTech Pvt Ltd.
            By using or accessing this website you agree to this Disclaimer without any qualification or limitation.
          </>
        }
        sections={sections}
      />
    </InfoPage>
  );
}

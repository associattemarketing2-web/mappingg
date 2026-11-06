import Link from 'next/link';
import InfoPage, { ContactBlock, LegalDoc, UpdatedChip, type LegalSection } from '@/components/InfoPage';

// How project data is sourced and checked. Keep this page true to the actual
// admin workflow (intake review, registry imports, add-only enrichment); update
// it whenever that workflow changes.

const REGISTRIES = [
  { name: 'MahaRERA (Maharashtra — Pune, Mumbai & MMR)', url: 'https://maharera.maharashtra.gov.in/' },
  { name: 'Karnataka RERA (Bengaluru)', url: 'https://rera.karnataka.gov.in/' },
  { name: 'UP RERA (Noida, Greater Noida)', url: 'https://www.up-rera.in/' },
  { name: 'HARERA (Gurugram)', url: 'https://haryanarera.gov.in/' },
  { name: 'TG RERA (Hyderabad)', url: 'https://rera.telangana.gov.in/' },
];

const sections: LegalSection[] = [
  {
    id: 'sources',
    title: 'Where project information comes from',
    body: (
      <>
        <p>Each project on Mappingg is built from one or more of these sources:</p>
        <ul>
          <li>
            <strong>Developers and their authorised channel partners</strong>, who submit project details — name,
            location, configurations, prices, possession timeline, photos and brochure — through a developer account.
          </li>
          <li>
            <strong>State RERA registries</strong>, for the registration number, the registered promoter and the
            registered project location.
          </li>
          <li>
            <strong>Developers&apos; official websites</strong>, used to fill fields that are still empty (for example
            photos, amenities or a project description). Information already on a project page is never overwritten this
            way; where an official source disagrees with what is on record, the difference is flagged for review instead.
          </li>
          <li>
            <strong>Map data</strong> — project pins are placed from the project&apos;s mapped address, and the base map
            and infrastructure layers are credited on the <Link href="/map-data">map data page</Link>.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'review',
    title: 'Nothing goes live without review',
    body: (
      <>
        <p>
          New submissions and records imported from registries or other public sources go into a review queue. A member
          of the Mappingg team checks them before they are published on the map. Imported records are never published
          automatically.
        </p>
        <p>
          When the same project appears twice (for example two phases listed under one name), the duplicate is hidden and
          its old link permanently redirects to the listing that was kept.
        </p>
      </>
    ),
  },
  {
    id: 'rera',
    title: 'What a RERA number on a project page means',
    body: (
      <>
        <p>
          A RERA number shown on a project page is the registration number on record for that project. When a developer
          lists a project, we check that the number exists on the state registry. It is <strong>not</strong> a
          certification by Mappingg of the project&apos;s approvals, land title, construction quality or timeline.
        </p>
        <p>
          A project without a RERA number on its page may be pre-launch, exempt, or simply missing the number in our
          records — do not assume it is registered. Before paying a booking amount, search the number on the official
          registry and check the promoter name, the registered carpet areas and the declared completion date:
        </p>
        <ul>
          {REGISTRIES.map((r) => (
            <li key={r.url}>
              <a href={r.url} target="_blank" rel="noopener">{r.name}</a>
            </li>
          ))}
        </ul>
      </>
    ),
  },
  {
    id: 'prices',
    title: 'Prices, configurations and possession dates',
    body: (
      <>
        <p>
          Prices are the developer&apos;s listed asking prices at the time they were last updated, usually a starting
          price. They normally exclude stamp duty, registration, GST and other charges. Where a developer has not
          published a price, the page says so rather than showing an estimate. A developer can also ask for a field to be
          hidden, in which case it is not shown or used anywhere on the site.
        </p>
        <p>
          Each project page shows the date its details were last updated. Possession dates are as listed by the developer;
          the completion date declared on the RERA registry is the one the developer is bound by.
        </p>
      </>
    ),
  },
  {
    id: 'editorial',
    title: 'Editorial policy for guides and articles',
    body: (
      <>
        <p>
          Articles on the <Link href="/blog">Mappingg blog</Link> are written and reviewed by the Mappingg team. Project
          tables in locality and price guides are generated from the live project data when the article is updated, not
          typed by hand. Rules, charges and legal requirements are checked against official sources — state RERA
          authorities, stamp-duty and registration departments, and planning authorities — and linked where relevant.
        </p>
        <p>
          We do not publish paid reviews, invented ratings or anonymous &ldquo;expert&rdquo; quotes. Each article shows when
          it was published and when it was last updated.
        </p>
      </>
    ),
  },
  {
    id: 'relationship',
    title: 'Our commercial relationship with developers',
    body: (
      <p>
        Mappingg is a product of Associatte PropTech Pvt Ltd, which works as an authorised channel partner for some
        developers and offers paid listing and marketing services. A project being on the map is not a recommendation.
        See the <Link href="/disclaimer">disclaimer</Link> and <Link href="/terms">terms</Link> for details.
      </p>
    ),
  },
  {
    id: 'corrections',
    title: 'Corrections and updates',
    body: (
      <>
        <p>
          If something on a project page is wrong or out of date — a price, a possession date, a RERA number, a location —
          tell us with the page link and, if you can, a source. Developers can update their own listings from their
          account. We correct confirmed errors and the page&apos;s &ldquo;last updated&rdquo; date changes with it.
        </p>
        <ContactBlock />
      </>
    ),
  },
];

export default function DataSourcesPage() {
  return (
    <InfoPage
      path="/data-sources"
      crumb="Data sources"
      eyebrow="Trust"
      icon="fas fa-shield-halved"
      tone="water"
      title={<>How we source and <span className="accent">check</span> project data</>}
      intro="Where the information on Mappingg comes from, what we check before a project goes live, and what you should still verify yourself."
      meta={<UpdatedChip date="4 November 2026" />}
    >
      <LegalDoc
        path="/data-sources"
        intro={<>This page explains how project information on mappingg.com is collected, reviewed and kept up to date.</>}
        sections={sections}
      />
    </InfoPage>
  );
}

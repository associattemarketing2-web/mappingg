import type { Metadata } from 'next';
import Link from 'next/link';
import InfoPage, { ContactBlock, EMAIL, LegalDoc, UpdatedChip, type LegalSection } from '@/components/InfoPage';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

export const metadata: Metadata = {
  title: 'Map Data & OpenStreetMap Policy',
  description:
    'Where Mappingg’s maps come from, how we credit OpenStreetMap contributors, the licences that apply, how we use map tile servers fairly, and how to report map errors.',
  alternates: { canonical: `${SITE_URL}/map-data` },
};

const ext = { target: '_blank', rel: 'noopener' } as const;

const sections: LegalSection[] = [
  {
    id: 'sources',
    title: 'Where our maps come from',
    body: (
      <>
        <p>
          The base map on Mappingg — roads, rivers, parks, buildings and place names — comes from{' '}
          <a href="https://www.openstreetmap.org" {...ext}>OpenStreetMap</a>, an open world map that anyone can edit, built by
          a global community of volunteers. On top of that base map we add our own content: project pins, project details, project
          boundaries and upcoming infrastructure.
        </p>
        <div className="providers">
          <div>
            <i className="fas fa-map" aria-hidden="true" />
            <strong>Standard map</strong>
            OpenStreetMap data, tiles served by the OpenStreetMap Foundation
          </div>
          <div>
            <i className="fas fa-satellite" aria-hidden="true" />
            <strong>Satellite view</strong>
            Imagery by Esri and its partners (Maxar, Earthstar Geographics)
          </div>
          <div>
            <i className="fas fa-cube" aria-hidden="true" />
            <strong>3D map</strong>
            OpenStreetMap data, served by an independent open-source tile service
          </div>
        </div>
      </>
    ),
  },
  {
    id: 'attribution',
    title: 'How we credit OpenStreetMap',
    body: (
      <>
        <p>
          OpenStreetMap data is made by its contributors, and they must be credited wherever it is shown. Every map on
          Mappingg displays a visible credit in its bottom corner reading <strong>&quot;© OpenStreetMap contributors&quot;</strong>,
          linked to the <a href="https://www.openstreetmap.org/copyright" {...ext}>OpenStreetMap copyright and licence page</a>.
          The satellite view also credits &quot;Imagery © Esri, Maxar, Earthstar Geographics&quot;, and the 3D map shows the
          credits supplied by its map style.
        </p>
        <p>
          We do not hide, shrink beyond readability or remove these credits, and we will keep them in place in any
          screenshot, video or printed material where we reproduce our maps.
        </p>
      </>
    ),
  },
  {
    id: 'licences',
    title: 'Licences that apply',
    body: (
      <ul>
        <li>
          <strong>OpenStreetMap data</strong> is available under the{' '}
          <a href="https://opendatacommons.org/licenses/odbl/" {...ext}>Open Database License (ODbL) 1.0</a>, © OpenStreetMap
          contributors.
        </li>
        <li>
          <strong>Map tile cartography</strong> from the OpenStreetMap standard map is licensed under{' '}
          <a href="https://creativecommons.org/licenses/by-sa/2.0/" {...ext}>Creative Commons Attribution-ShareAlike 2.0</a>.
        </li>
        <li>
          <strong>Satellite imagery</strong> belongs to Esri and its data partners and is used under their terms. It may
          not be copied or reused from our website.
        </li>
        <li>
          <strong>Mappingg content</strong> — project pins, project details, photos, brochures and our overlays — is not
          part of OpenStreetMap. It belongs to us or to the respective developers, as explained in our{' '}
          <Link href="/terms">Terms of use</Link>. Where any of our overlays are derived from OpenStreetMap data, they
          remain subject to the ODbL.
        </li>
      </ul>
    ),
  },
  {
    id: 'fair-use',
    title: 'How we use map tile servers',
    body: (
      <>
        <p>
          The OpenStreetMap Foundation runs its tile servers on donated resources and asks every website to follow its{' '}
          <a href="https://operations.osmfoundation.org/policies/tiles/" {...ext}>Tile Usage Policy</a>. We follow it by:
        </p>
        <ul>
          <li>loading tiles only when a visitor is actually viewing that part of the map;</li>
          <li>never bulk-downloading, pre-fetching or scraping tiles, and never offering them for offline use;</li>
          <li>letting browsers cache tiles as the tile servers instruct, so repeat views don&apos;t re-download them;</li>
          <li>sending standard browser identification with every request, so the servers can see where traffic comes from;</li>
          <li>always showing the required attribution on the map.</li>
        </ul>
        <p>
          Public tile servers are offered without any guarantee of availability. If our traffic grows beyond what the
          policy allows, or the service changes, we will move to a commercial or self-hosted tile provider.
        </p>
      </>
    ),
  },
  {
    id: 'your-use',
    title: 'What we ask of you',
    body: (
      <>
        <p>When using the maps on Mappingg, please do not:</p>
        <ul>
          <li>scrape, bulk-download or systematically capture map tiles, imagery or project data through our website;</li>
          <li>remove or cover the map credits in screenshots or recordings you share;</li>
          <li>present our maps or OpenStreetMap data as your own.</li>
        </ul>
        <div className="note">
          <i className="fas fa-lightbulb" aria-hidden="true" />
          <span>
            Need OpenStreetMap data for your own project? Download it directly from{' '}
            <a href="https://www.openstreetmap.org" {...ext}>openstreetmap.org</a> and follow the ODbL — it&apos;s open to
            everyone.
          </span>
        </div>
      </>
    ),
  },
  {
    id: 'privacy',
    title: 'Your privacy when maps load',
    body: (
      <p>
        Map tiles load directly from the providers above, so they receive technical details such as your IP address,
        browser type and the map area you are viewing. They never receive your name, phone number, email or enquiry
        details from us, and the map does not read your device&apos;s location. Full details are in the{' '}
        <Link href="/privacy#maps-and-openstreetmap">Maps and OpenStreetMap section of our Privacy Policy</Link>, and in the{' '}
        <a href="https://osmfoundation.org/wiki/Privacy_Policy" {...ext}>OpenStreetMap Foundation Privacy Policy</a>.
      </p>
    ),
  },
  {
    id: 'accuracy',
    title: 'Accuracy and limitations',
    body: (
      <>
        <p>
          OpenStreetMap is edited by volunteers and is updated constantly, so roads, buildings and place names may be
          missing, outdated or not yet reflect recent construction. Project pins, boundaries and infrastructure routes
          are placed as accurately as we can, but are approximate.
        </p>
        <div className="note">
          <i className="fas fa-triangle-exclamation" aria-hidden="true" />
          <span>
            Our maps are for exploring and comparing projects. They are not suitable for navigation, surveying or
            deciding legal boundaries. Always visit the site and confirm details with the developer and MahaRERA — see our{' '}
            <Link href="/disclaimer">Disclaimer</Link>.
          </span>
        </div>
      </>
    ),
  },
  {
    id: 'report-errors',
    title: 'Reporting map errors',
    body: (
      <ul>
        <li>
          <strong>Wrong road, building or place name?</strong> That comes from OpenStreetMap, and anyone can fix it. Use{' '}
          <a href="https://www.openstreetmap.org/fixthemap" {...ext}>Fix the map</a> on openstreetmap.org to add a note or
          edit it yourself. Corrections usually appear on our map once the tiles refresh.
        </li>
        <li>
          <strong>Wrong project pin, detail or infrastructure line?</strong> That is our content. Email{' '}
          <a href={`mailto:${EMAIL}?subject=${encodeURIComponent('Map correction')}`}>{EMAIL}</a> with the project name and
          what needs fixing, and we&apos;ll correct it.
        </li>
      </ul>
    ),
  },
  {
    id: 'no-endorsement',
    title: 'No endorsement',
    body: (
      <p>
        Mappingg and Associatte PropTech Pvt Ltd are not affiliated with, sponsored by or endorsed by the OpenStreetMap
        Foundation or Esri. &quot;OpenStreetMap&quot; and its logo are trademarks of the OpenStreetMap Foundation, used here
        only to identify the source of our map data, in line with the{' '}
        <a href="https://osmfoundation.org/wiki/Trademark_Policy" {...ext}>OSMF Trademark Policy</a>.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: (
      <p>
        If we change map providers or how our maps work, we will update this page and the &quot;Last updated&quot; date
        above.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact us',
    body: (
      <>
        <p>Questions about our maps or this policy? Get in touch:</p>
        <ContactBlock />
      </>
    ),
  },
];

export default function MapDataPage() {
  return (
    <InfoPage
      path="/map-data"
      crumb="Map data"
      eyebrow="Legal · OpenStreetMap"
      icon="fas fa-map"
      tone="water"
      title={<>Map data &amp; <span className="accent">OpenStreetMap</span></>}
      intro="Where our maps come from, how we credit the people who make them, and how we use them responsibly."
      meta={<UpdatedChip />}
    >
      <LegalDoc
        path="/map-data"
        glance={[
          { icon: 'fas fa-earth-asia', tone: 'water', title: 'Built on OpenStreetMap', text: 'Our base map is © OpenStreetMap contributors, under the Open Database License.' },
          { icon: 'fas fa-scale-balanced', title: 'Used fairly', text: 'We follow the OSMF Tile Usage Policy: credit shown, no scraping, no bulk downloads.' },
          { icon: 'fas fa-pen-to-square', tone: 'earth', title: 'Spot an error?', text: 'Fix roads and places on OpenStreetMap; email us about project pins.' },
        ]}
        intro={
          <>
            This policy explains how Associatte PropTech Pvt Ltd (&quot;we&quot;, &quot;us&quot;) uses OpenStreetMap and
            other map providers on mappingg.com. It sits alongside our <Link href="/privacy">Privacy Policy</Link>,{' '}
            <Link href="/terms">Terms of use</Link> and <Link href="/disclaimer">Disclaimer</Link>.
          </>
        }
        sections={sections}
      />
    </InfoPage>
  );
}

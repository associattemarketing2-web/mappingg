import type { Metadata } from 'next';
import Link from 'next/link';
import InfoPage, { CtaBand, EMAIL, MiniMap } from '@/components/InfoPage';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

export const metadata: Metadata = {
  title: 'Advertise With Us',
  description: 'Put your real estate project in front of buyers exploring the Mappingg live project map in Pune.',
  alternates: { canonical: `${SITE_URL}/advertise` },
};

const ENQUIRE = `mailto:${EMAIL}?subject=${encodeURIComponent('Advertising on Mappingg')}`;

const OPTIONS = [
  { icon: 'fas fa-location-dot', tone: '', title: 'Project listing', text: 'Put your project on the map with its status, configurations, RERA number and possession date.' },
  { icon: 'fas fa-images', tone: 'water', title: 'Rich project card', text: 'Add photos, brochures and videos so buyers can explore your project without leaving the map.' },
  { icon: 'fas fa-inbox', tone: 'road', title: 'Buyer enquiries', text: 'Receive enquiries from buyers who are interested in your project.' },
  { icon: 'fas fa-newspaper', tone: 'earth', title: 'Blog features', text: 'Feature your project or micro-market in articles written for Pune property buyers.' },
];

export default function AdvertisePage() {
  return (
    <InfoPage
      path="/advertise"
      crumb="Advertise"
      eyebrow="For developers & partners"
      icon="fas fa-bullhorn"
      tone="road"
      title={<>Reach buyers <span className="accent">right on the map</span></>}
      intro="Show your project to people who are already comparing projects in your area."
      actions={
        <>
          <a href={ENQUIRE} className="btn btn-primary"><i className="fas fa-envelope" aria-hidden="true" /> Get options &amp; pricing</a>
          <Link href="/map" className="btn btn-outline">See the live map</Link>
        </>
      }
    >
      <section className="ipg-section">
        <div className="container">
          <div className="ipg-split">
            <MiniMap
              pins={[
                { x: 28, y: 38, color: 'grey', icon: 'fas fa-building' },
                { x: 54, y: 30, color: 'park', icon: 'fas fa-star' },
                { x: 76, y: 52, color: 'grey', icon: 'fas fa-building' },
                { x: 40, y: 64, color: 'grey', icon: 'fas fa-building' },
              ]}
              tag={{ icon: 'fas fa-star', title: 'Your project, in context', text: 'Seen by buyers comparing this location' }}
            />
            <div className="copy">
              <span className="eyebrow"><span className="dot" />Why Mappingg</span>
              <h2>Buyers here are <span className="accent">already deciding</span></h2>
              <p>
                People use Mappingg to compare projects side by side, check RERA details and see what&apos;s nearby. The
                buyers who see your project are actively looking in your location, at the moment they&apos;re choosing.
              </p>
              <p>
                Your project appears alongside the roads, metro lines, schools and hospitals around it, so buyers
                understand its location instantly.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="ipg-section alt">
        <div className="container">
          <div className="ipg-head">
            <span className="eyebrow"><span className="dot" />Options</span>
            <h2>Ways to <span className="accent">work with us</span></h2>
            <p>Mix and match to suit your launch or ongoing sales.</p>
          </div>
          <div className="ipg-grid cols-4">
            {OPTIONS.map((o) => (
              <div className="ipg-card" key={o.title}>
                <span className={`ipg-ic ${o.tone}`}><i className={o.icon} aria-hidden="true" /></span>
                <h3>{o.title}</h3>
                <p>{o.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ipg-section">
        <div className="container">
          <div className="ipg-head">
            <span className="eyebrow"><span className="dot" />Getting started</span>
            <h2>Live on the map in <span className="accent">three steps</span></h2>
            <p>
              We work with developers and channel partners whose projects are registered with MahaRERA. All listings follow
              our <Link href="/terms" style={{ color: 'var(--forest)', fontWeight: 600 }}>Terms of use</Link>.
            </p>
          </div>
          <div className="ipg-steps">
            <div className="ipg-step">
              <h3>Share your project</h3>
              <p>Email us the project name, location and MahaRERA registration number.</p>
            </div>
            <div className="ipg-step">
              <h3>We verify it</h3>
              <p>We check the RERA number on the MahaRERA website before anything goes live.</p>
            </div>
            <div className="ipg-step">
              <h3>Go live</h3>
              <p>Your project appears on the map, and we share options and pricing for promotion.</p>
            </div>
          </div>
        </div>
      </section>

      <CtaBand title="Ready to put your project on the map?" text="Tell us about your project and our team will share options and pricing.">
        <a href={ENQUIRE} className="btn btn-primary">Contact our team <i className="fas fa-arrow-right" aria-hidden="true" /></a>
        <Link href="/contact" className="btn btn-outline">Other ways to reach us</Link>
      </CtaBand>
    </InfoPage>
  );
}

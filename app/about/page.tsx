import type { Metadata } from 'next';
import Link from 'next/link';
import InfoPage, { CtaBand, MiniMap } from '@/components/InfoPage';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

export const metadata: Metadata = {
  title: 'About Us',
  description: 'Mappingg puts every live real estate project on one interactive map. A product by Associatte PropTech, Pune.',
  alternates: { canonical: `${SITE_URL}/about` },
};

const FEATURES = [
  { icon: 'fas fa-location-dot', tone: '', title: 'Live projects', text: 'Every pin is a real project, colour-coded by status, with developer, configuration and possession details.' },
  { icon: 'fas fa-shield-halved', tone: 'water', title: 'Verified RERA numbers', text: 'RERA registration numbers are checked on the MahaRERA website, so you know exactly what you’re looking at.' },
  { icon: 'fas fa-road', tone: 'road', title: 'Upcoming infrastructure', text: 'Metro lines, flyovers and roads being built nearby, with their current status and expected timelines.' },
  { icon: 'fas fa-school', tone: 'earth', title: 'What’s nearby', text: 'Schools, hospitals, metro stations and everyday places around each project, in one view.' },
];

const VALUES = [
  { icon: 'fas fa-magnifying-glass-location', title: 'Clarity first', text: 'One map instead of a pile of brochures, listing sites and site visits.' },
  { icon: 'fas fa-circle-check', title: 'Verified, not guessed', text: 'We check registrations at the source and show where every detail comes from.' },
  { icon: 'fas fa-handshake', title: 'Built with the industry', text: 'We work alongside developers and channel partners to keep information current.' },
];

export default function AboutPage() {
  return (
    <InfoPage
      path="/about"
      crumb="About us"
      eyebrow="About Mappingg"
      icon="fas fa-map-location-dot"
      title={<>Every project, <span className="accent">mapped and verified</span></>}
      intro="Mappingg is a live map of real estate projects, built by Associatte PropTech in Pune to make buying a home clearer."
      actions={
        <>
          <Link href="/map" className="btn btn-primary"><i className="fas fa-map" aria-hidden="true" /> Explore the live map</Link>
          <Link href="/contact" className="btn btn-outline">Talk to us</Link>
        </>
      }
    >
      <section className="ipg-section">
        <div className="container">
          <div className="ipg-split">
            <div className="copy">
              <span className="eyebrow"><span className="dot" />Our story</span>
              <h2>Why we built <span className="accent">Mappingg</span></h2>
              <p>
                Buying a home usually means juggling brochures, listing sites and site visits just to understand what is
                being built where. Location matters more than anything else in property, yet it is the hardest thing to
                see clearly.
              </p>
              <p>
                So we put every live project on one interactive map. You can see a project, its status, its RERA record and
                what&apos;s around it in a single view, and compare it with everything else in the neighbourhood.
              </p>
            </div>
            <MiniMap
              pins={[
                { x: 34, y: 34, color: 'park', icon: 'fas fa-building' },
                { x: 63, y: 26, color: 'road', icon: 'fas fa-person-digging' },
                { x: 72, y: 58, color: 'earth', icon: 'fas fa-building' },
                { x: 20, y: 60, color: 'grey', icon: 'fas fa-clock' },
              ]}
              tag={{ icon: 'fas fa-shield-halved', title: 'RERA verified', text: 'Checked on the MahaRERA website' }}
            />
          </div>
        </div>
      </section>

      <section className="ipg-section alt">
        <div className="container">
          <div className="ipg-head">
            <span className="eyebrow"><span className="dot" />On the map</span>
            <h2>Everything you need to <span className="accent">compare projects</span></h2>
            <p>The details that matter when you choose a home, all in one place.</p>
          </div>
          <div className="ipg-grid cols-4">
            {FEATURES.map((f) => (
              <div className="ipg-card" key={f.title}>
                <span className={`ipg-ic ${f.tone}`}><i className={f.icon} aria-hidden="true" /></span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ipg-section">
        <div className="container">
          <div className="ipg-head">
            <span className="eyebrow"><span className="dot" />Who we are</span>
            <h2>A product by <span className="accent">Associatte PropTech</span></h2>
            <p>
              Associatte PropTech Pvt Ltd is a real estate company based in Hadapsar, Pune. We work with developers and
              channel partners across Pune and the Mumbai Metropolitan Region to bring accurate, up-to-date project
              information to buyers and investors.
            </p>
          </div>
          <div className="ipg-grid">
            {VALUES.map((v) => (
              <div className="ipg-card" key={v.title}>
                <span className="ipg-ic gold"><i className={v.icon} aria-hidden="true" /></span>
                <h3>{v.title}</h3>
                <p>{v.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CtaBand title="See it for yourself" text="Explore live projects across Pune, with RERA details and what’s nearby.">
        <Link href="/map" className="btn btn-primary">Open the live map <i className="fas fa-arrow-right" aria-hidden="true" /></Link>
        <Link href="/advertise" className="btn btn-outline">List your project</Link>
      </CtaBand>
    </InfoPage>
  );
}

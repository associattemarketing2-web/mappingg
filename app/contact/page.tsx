import type { Metadata } from 'next';
import Link from 'next/link';
import InfoPage, { CtaBand, EMAIL, MapArt } from '@/components/InfoPage';
import ContactForm from '@/components/ContactForm';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

export const metadata: Metadata = {
  title: 'Contact Us',
  description: 'Get in touch with the Mappingg team at Associatte PropTech, Hadapsar, Pune.',
  alternates: { canonical: `${SITE_URL}/contact` },
};

const DIRECTIONS = 'https://www.google.com/maps/search/?api=1&query=Naren+Pearl+Magarpatta+Road+Hadapsar+Pune+411028';

const TOPICS = [
  { icon: 'fas fa-house-chimney', tone: '', title: 'Buyers', text: 'Ask about any project, or tap “Enquire” on its card on the live map and the team will get back to you.', subject: 'Project enquiry' },
  { icon: 'fas fa-building', tone: 'water', title: 'Developers', text: 'Want your project on the map? Tell us the project name, location and RERA number.', subject: 'List my project' },
  { icon: 'fas fa-handshake', tone: 'road', title: 'Channel partners', text: 'Register with your MahaRERA number. We verify it, usually within one working day.', subject: 'Channel partner' },
  { icon: 'fas fa-pen-to-square', tone: 'earth', title: 'Corrections', text: 'Spotted wrong or outdated project details? Send us the project name and what needs fixing.', subject: 'Correction' },
];

export default function ContactPage() {
  return (
    <InfoPage
      path="/contact"
      crumb="Contact"
      eyebrow="Contact"
      icon="fas fa-comments"
      tone="water"
      title={<>Talk to the <span className="accent">Mappingg team</span></>}
      intro="Questions about a project, your account or listing with us? We're happy to help."
      actions={
        <>
          <a href={`mailto:${EMAIL}`} className="btn btn-primary"><i className="fas fa-envelope" aria-hidden="true" /> Email us</a>
          <a href={DIRECTIONS} target="_blank" rel="noopener" className="btn btn-outline"><i className="fas fa-diamond-turn-right" aria-hidden="true" /> Get directions</a>
        </>
      }
    >
      <section className="ipg-section">
        <div className="container">
          <div className="ipg-head">
            <span className="eyebrow"><span className="dot" />Send us a message</span>
            <h2>Tell us what you <span className="accent">need</span></h2>
            <p>Fill in the form and our team will get back to you. Your message reaches us directly.</p>
          </div>
          <ContactForm />
        </div>
      </section>

      <section className="ipg-section alt">
        <div className="container">
          <div className="ipg-office">
            <div className="details">
              <span className="eyebrow"><span className="dot" />Visit or write</span>
              <h3>Associatte PropTech Pvt Ltd</h3>
              <div className="row">
                <i className="fas fa-location-dot" aria-hidden="true" />
                <div>
                  <strong>Office</strong>
                  302 and 303, Naren Pearl, 3rd Floor, Magarpatta Road, Above Axis and IndusInd Bank, Hadapsar,
                  Pune - 411028
                </div>
              </div>
              <div className="row">
                <i className="fas fa-envelope" aria-hidden="true" />
                <div>
                  <strong>Email</strong>
                  <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
                </div>
              </div>
              <div className="row">
                <i className="fas fa-diamond-turn-right" aria-hidden="true" />
                <div>
                  <strong>Directions</strong>
                  <a href={DIRECTIONS} target="_blank" rel="noopener">Open in Google Maps</a>
                </div>
              </div>
            </div>
            <div className="visual">
              <MapArt />
              <div className="here" aria-hidden="true">
                <b><i className="fas fa-building" /></b>
                <span>We&apos;re here · Hadapsar</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="ipg-section">
        <div className="container">
          <div className="ipg-head">
            <span className="eyebrow"><span className="dot" />How we can help</span>
            <h2>Reach the <span className="accent">right people</span> faster</h2>
            <p>Pick a topic and we&apos;ll open an email with the subject filled in.</p>
          </div>
          <div className="ipg-grid cols-4">
            {TOPICS.map((t) => (
              <a className="ipg-card link" key={t.title} href={`mailto:${EMAIL}?subject=${encodeURIComponent(t.subject)}`}>
                <span className={`ipg-ic ${t.tone}`}><i className={t.icon} aria-hidden="true" /></span>
                <h3>{t.title}</h3>
                <p>{t.text}</p>
                <span className="more">Write to us <i className="fas fa-arrow-right" aria-hidden="true" /></span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <CtaBand title="Your data, your choice" text="To see, correct or delete the personal information we hold about you, email us and read how we handle it.">
        <a href={`mailto:${EMAIL}?subject=${encodeURIComponent('Privacy request')}`} className="btn btn-primary">Make a privacy request</a>
        <Link href="/privacy" className="btn btn-outline">Read the privacy policy</Link>
      </CtaBand>
    </InfoPage>
  );
}

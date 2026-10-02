import type { Metadata } from 'next';
import Link from 'next/link';
import InfoPage, { CtaBand, EMAIL } from '@/components/InfoPage';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

export const metadata: Metadata = {
  title: 'Careers',
  description: 'Work with the team behind Mappingg, the live real estate project map by Associatte PropTech in Pune.',
  alternates: { canonical: `${SITE_URL}/careers` },
};

const APPLY = `mailto:${EMAIL}?subject=${encodeURIComponent('Careers at Mappingg')}`;

const AREAS = [
  { icon: 'fas fa-house-chimney-user', tone: '', title: 'Real estate sales', text: 'Help buyers find the right project and guide them from first enquiry to site visit.' },
  { icon: 'fas fa-database', tone: 'water', title: 'Research & data', text: 'Keep project, RERA and infrastructure details on the map accurate and up to date.' },
  { icon: 'fas fa-bullhorn', tone: 'road', title: 'Marketing', text: 'Content, social media and campaigns that help buyers discover the right projects.' },
  { icon: 'fas fa-code', tone: 'earth', title: 'Technology', text: 'Build and improve the live map, the website and the tools our team uses every day.' },
];

const WHY = [
  { icon: 'fas fa-seedling', title: 'Real ownership', text: 'A small team means your work goes live quickly and you see its impact.' },
  { icon: 'fas fa-city', title: 'Learn the market', text: 'Get to know Pune real estate from the ground up, project by project.' },
  { icon: 'fas fa-location-dot', title: 'Based in Pune', text: 'Work from our office on Magarpatta Road in Hadapsar.' },
];

export default function CareersPage() {
  return (
    <InfoPage
      path="/careers"
      crumb="Careers"
      eyebrow="Careers"
      icon="fas fa-briefcase"
      tone="earth"
      title={<>Help us <span className="accent">map real estate</span></>}
      intro="We're a growing team in Pune making property information clearer for every buyer."
      actions={
        <a href={APPLY} className="btn btn-primary"><i className="fas fa-paper-plane" aria-hidden="true" /> Send your CV</a>
      }
    >
      <section className="ipg-section">
        <div className="container">
          <div className="ipg-head">
            <span className="eyebrow"><span className="dot" />Why join us</span>
            <h2>Work that people <span className="accent">actually use</span></h2>
            <p>Mappingg brings together real estate, maps and technology — and we care about getting the details right.</p>
          </div>
          <div className="ipg-grid">
            {WHY.map((w) => (
              <div className="ipg-card" key={w.title}>
                <span className="ipg-ic gold"><i className={w.icon} aria-hidden="true" /></span>
                <h3>{w.title}</h3>
                <p>{w.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ipg-section alt">
        <div className="container">
          <div className="ipg-head">
            <span className="eyebrow"><span className="dot" />Teams</span>
            <h2>Areas we <span className="accent">hire in</span></h2>
            <p>We don&apos;t have specific openings listed right now, but we&apos;d still like to hear from you.</p>
          </div>
          <div className="ipg-grid cols-4">
            {AREAS.map((a) => (
              <a className="ipg-card link" key={a.title} href={`mailto:${EMAIL}?subject=${encodeURIComponent(`Careers: ${a.title}`)}`}>
                <span className={`ipg-ic ${a.tone}`}><i className={a.icon} aria-hidden="true" /></span>
                <h3>{a.title}</h3>
                <p>{a.text}</p>
                <span className="more">Apply <i className="fas fa-arrow-right" aria-hidden="true" /></span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="ipg-section">
        <div className="container">
          <div className="ipg-head">
            <span className="eyebrow"><span className="dot" />How to apply</span>
            <h2>Three <span className="accent">simple steps</span></h2>
          </div>
          <div className="ipg-steps">
            <div className="ipg-step">
              <h3>Email your CV</h3>
              <p>Send it to {EMAIL} with &quot;Careers&quot; in the subject line.</p>
            </div>
            <div className="ipg-step">
              <h3>Tell us your interest</h3>
              <p>Mention the area you&apos;d like to work in and what you&apos;d bring to the team.</p>
            </div>
            <div className="ipg-step">
              <h3>Meet the team</h3>
              <p>If there&apos;s a fit, we&apos;ll invite you to a conversation at our Hadapsar office.</p>
            </div>
          </div>
        </div>
      </section>

      <CtaBand title="Think you’d be a good fit?" text="Send us your CV and a few lines about yourself. We read every application.">
        <a href={APPLY} className="btn btn-primary">Send your CV <i className="fas fa-arrow-right" aria-hidden="true" /></a>
        <Link href="/about" className="btn btn-outline">About Mappingg</Link>
      </CtaBand>
    </InfoPage>
  );
}

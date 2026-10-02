import type { Metadata } from 'next';
import Link from 'next/link';
import InfoPage, { CtaBand } from '@/components/InfoPage';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

export const metadata: Metadata = {
  title: 'How It Works',
  description: 'From project data to an intelligent map in three simple steps — connect your data, map your project, then visualise and share it. See how a project goes live on Mappingg.',
  alternates: { canonical: `${SITE_URL}/how-it-works` },
};

const STEPS = [
  { n: '01', icon: 'fas fa-plug', tone: '', title: 'Connect your data', text: 'Share your RERA number, location, plans and prices. We verify the RERA number on the MahaRERA website.', tags: ['RERA', 'Location', 'Plans'] },
  { n: '02', icon: 'fas fa-map-location-dot', tone: 'water', title: 'Map your project', text: 'Your project goes live as a pin with status, photos, possession dates and nearby places.', tags: ['Pin', 'Status', 'Layers'] },
  { n: '03', icon: 'fas fa-share-nodes', tone: 'road', title: 'Visualise & share', text: 'Share one link on WhatsApp, ads and hoardings — and receive enquiries straight from the map.', tags: ['Link', 'QR code', 'Enquiries'] },
];

const JOURNEY = [
  { icon: 'fas fa-user-plus', step: 'Step 1', title: 'Sign up', text: 'Create a developer account.' },
  { icon: 'fas fa-shield-halved', step: 'Step 2', title: 'We verify', text: 'We check the RERA number on MahaRERA.' },
  { icon: 'fas fa-location-dot', step: 'Step 3', title: 'Go live', text: 'Your pin appears on the map.' },
  { icon: 'fas fa-share-nodes', step: 'Step 4', title: 'Share', text: 'Link, QR code and WhatsApp.' },
  { icon: 'fas fa-comments', step: 'Step 5', title: 'Get enquiries', text: 'Serious buyers reach your team.' },
];

const CONNECTED = [
  { icon: 'fas fa-database', title: 'One source of truth', text: 'Prices, status and dates live in one place instead of ten documents.' },
  { icon: 'fas fa-arrows-rotate', title: 'Updates everywhere', text: 'Change a price or mark a plot sold — it reflects instantly on every link.' },
  { icon: 'fab fa-whatsapp', title: 'Enquiries on WhatsApp', text: 'Leads from the map reach your team with the project they viewed.' },
  { icon: 'fas fa-chart-simple', title: 'See what works', text: 'Know which projects and areas buyers are looking at most.' },
];

export default function HowItWorksPage() {
  return (
    <InfoPage
      path="/how-it-works"
      crumb="How it works"
      eyebrow="How it works"
      icon="fas fa-diagram-project"
      tone="water"
      title={<>From project data to an <span className="accent">intelligent map</span></>}
      intro="Three simple steps to put your project in front of the right people — verified, mapped and ready to share."
      actions={
        <>
          <Link href="/advertise" className="btn btn-primary"><i className="fas fa-plus" aria-hidden="true" /> List your project</Link>
          <Link href="/map" className="btn btn-outline">Explore the live map</Link>
        </>
      }
    >
      <section className="ipg-section">
        <div className="container">
          <div className="ipg-head">
            <span className="eyebrow"><span className="dot" />Three steps</span>
            <h2>Put your project on the <span className="accent">map</span></h2>
            <p>Share your details once; we verify them and bring your project to life as an interactive pin.</p>
          </div>
          <div className="ipg-grid">
            {STEPS.map((s) => (
              <div className="ipg-card" key={s.n}>
                <span className={`ipg-ic ${s.tone}`}><i className={s.icon} aria-hidden="true" /></span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ipg-section alt">
        <div className="container">
          <div className="ipg-head">
            <span className="eyebrow water"><span className="dot" />Your journey</span>
            <h2>How a project <span className="accent">goes live</span></h2>
            <p>From sign-up to site visits — here&apos;s the full journey.</p>
          </div>
          <div className="ipg-grid">
            {JOURNEY.map((j) => (
              <div className="ipg-card" key={j.title}>
                <span className="ipg-ic"><i className={j.icon} aria-hidden="true" /></span>
                <h3>{j.step} · {j.title}</h3>
                <p>{j.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ipg-section">
        <div className="container">
          <div className="ipg-head">
            <span className="eyebrow water"><span className="dot" />Always up to date</span>
            <h2>Keep project information <span className="accent">connected</span></h2>
            <p>Update once — every map, link and QR code shows the latest details.</p>
          </div>
          <div className="ipg-grid cols-4">
            {CONNECTED.map((c) => (
              <div className="ipg-card" key={c.title}>
                <span className="ipg-ic gold"><i className={c.icon} aria-hidden="true" /></span>
                <h3>{c.title}</h3>
                <p>{c.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CtaBand title="Ready to map your project?" text="Create a developer account and go live once your RERA number is verified.">
        <Link href="/advertise" className="btn btn-primary">List your project <i className="fas fa-arrow-right" aria-hidden="true" /></Link>
        <Link href="/map" className="btn btn-outline">Open the live map</Link>
      </CtaBand>
    </InfoPage>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import InfoPage, { CtaBand } from '@/components/InfoPage';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

export const metadata: Metadata = {
  title: 'Features',
  description: 'See every real estate project differently — project pins by status, map and satellite views, area labels, nearby places, upcoming infrastructure, project info and plot-by-plot layouts.',
  alternates: { canonical: `${SITE_URL}/features` },
};

const VIEWS = [
  { icon: 'fas fa-location-dot', tone: '', title: 'Project pins', text: 'Every project as a pin, colour-coded by status so you can scan a whole area at a glance.' },
  { icon: 'fas fa-map', tone: 'water', title: 'Map view', text: 'A clean, simple base map that keeps the focus on the projects.' },
  { icon: 'fas fa-satellite', tone: 'earth', title: 'Satellite view', text: 'Real ground context — see the actual surroundings of a project.' },
  { icon: 'fas fa-tags', tone: 'road', title: 'Area labels', text: 'Localities and main roads labelled, so you always know where you are.' },
  { icon: 'fas fa-school', tone: '', title: 'Nearby places', text: 'Schools, hospitals and metro stations around each project, in one view.' },
  { icon: 'fas fa-road', tone: 'road', title: 'Infrastructure', text: 'Metro lines, ring roads, flyovers and bridges — completed, ongoing or planned.' },
  { icon: 'fas fa-circle-info', tone: 'water', title: 'Project info', text: 'Status, MahaRERA-verified RERA number and possession dates for every project.' },
  { icon: 'fas fa-border-all', tone: 'earth', title: 'Plot layouts', text: 'Plotted projects open into a plot-by-plot layout with availability.' },
];

const CONNECTED = [
  { icon: 'fas fa-database', title: 'One source of truth', text: 'Prices, status and dates live in one place instead of ten documents.' },
  { icon: 'fas fa-arrows-rotate', title: 'Updates everywhere', text: 'Change a price or mark a plot sold — it reflects instantly on every link.' },
  { icon: 'fab fa-whatsapp', title: 'Enquiries on WhatsApp', text: 'Leads from the map reach your team with the project they viewed.' },
  { icon: 'fas fa-chart-simple', title: 'See what works', text: 'Know which projects and areas buyers are looking at most.' },
];

export default function FeaturesPage() {
  return (
    <InfoPage
      path="/features"
      crumb="Features"
      eyebrow="Features"
      icon="fas fa-layer-group"
      tone="road"
      title={<>See every project, <span className="accent">differently</span></>}
      intro="Every pin is a project — switch views to explore status, nearby places, upcoming infrastructure and plot-by-plot layouts."
      actions={
        <>
          <Link href="/map" className="btn btn-primary"><i className="fas fa-map" aria-hidden="true" /> Explore the live map</Link>
          <Link href="/how-it-works" className="btn btn-outline">How it works</Link>
        </>
      }
    >
      <section className="ipg-section">
        <div className="container">
          <div className="ipg-head">
            <span className="eyebrow road"><span className="dot" />Map views</span>
            <h2>Eight ways to <span className="accent">read a location</span></h2>
            <p>Switch between views to understand a project and everything around it.</p>
          </div>
          <div className="ipg-grid cols-4">
            {VIEWS.map((v) => (
              <div className="ipg-card" key={v.title}>
                <span className={`ipg-ic ${v.tone}`}><i className={v.icon} aria-hidden="true" /></span>
                <h3>{v.title}</h3>
                <p>{v.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ipg-section alt">
        <div className="container">
          <div className="ipg-head">
            <span className="eyebrow water"><span className="dot" />Always connected</span>
            <h2>Update once, <span className="accent">reflect everywhere</span></h2>
            <p>Your project information stays current across every map, link and QR code.</p>
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

      <CtaBand title="See it on the map" text="Explore live projects across Pune, with RERA details and what’s nearby.">
        <Link href="/map" className="btn btn-primary">Open the live map <i className="fas fa-arrow-right" aria-hidden="true" /></Link>
        <Link href="/faq" className="btn btn-outline">Read the FAQ</Link>
      </CtaBand>
    </InfoPage>
  );
}

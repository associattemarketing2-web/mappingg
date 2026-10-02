import type { Metadata } from 'next';
import Link from 'next/link';
import InfoPage from '@/components/InfoPage';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false },
};

const POPULAR = [
  { href: '/map', icon: 'fas fa-map-location-dot', tone: '', title: 'Live map', text: 'Explore every live project in Pune.' },
  { href: '/blog', icon: 'fas fa-newspaper', tone: 'water', title: 'Blog', text: 'Guides and area insights for buyers.' },
  { href: '/about', icon: 'fas fa-circle-info', tone: 'road', title: 'About us', text: 'Who we are and what Mappingg does.' },
  { href: '/contact', icon: 'fas fa-comments', tone: 'earth', title: 'Contact', text: 'Get in touch with our team.' },
];

export default function NotFound() {
  return (
    <InfoPage
      path=""
      crumb="Page not found"
      eyebrow="Error 404"
      icon="fas fa-map-pin"
      tone="earth"
      title={<>This spot isn&apos;t <span className="accent">on the map</span></>}
      intro="The page you're looking for has moved or doesn't exist. Try one of these instead."
      actions={
        <>
          <Link href="/" className="btn btn-primary"><i className="fas fa-house" aria-hidden="true" /> Back to home</Link>
          <Link href="/map" className="btn btn-outline">Open the live map</Link>
        </>
      }
    >
      <section className="ipg-section">
        <div className="container">
          <div className="ipg-grid cols-4">
            {POPULAR.map((p) => (
              <Link className="ipg-card link" key={p.href} href={p.href}>
                <span className={`ipg-ic ${p.tone}`}><i className={p.icon} aria-hidden="true" /></span>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
                <span className="more">Go <i className="fas fa-arrow-right" aria-hidden="true" /></span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </InfoPage>
  );
}

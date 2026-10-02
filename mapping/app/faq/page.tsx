import type { Metadata } from 'next';
import Link from 'next/link';
import InfoPage, { CtaBand } from '@/components/InfoPage';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

const FAQS = [
  { q: 'What is Mappingg?', a: <>Mappingg is a live map of real estate projects. Each project is a pin with its status, MahaRERA-verified RERA number, possession dates and what&apos;s nearby, so you can understand it in seconds.</> },
  { q: 'What is in it for buyers and investors?', a: <>Buyers and investors can explore the map, view project details, compare locations, understand nearby infrastructure and discover upcoming developments — all in one place.</> },
  { q: 'What infrastructure do you show?', a: <>Metro lines, ring roads, flyovers, bridges and road widening around each area — marked as completed, ongoing or planned — so you can see how a location is set to change.</> },
  { q: 'Which areas are covered?', a: <>We&apos;re starting with projects in Pune and Mumbai, with more metro cities coming soon. Dubai projects are planned next.</> },
  { q: 'How do you verify projects?', a: <>Every RERA number is checked on the official <a href="https://maharera.maharashtra.gov.in/" target="_blank" rel="noopener noreferrer">MahaRERA website</a> before the project goes live. Each project card also links to MahaRERA, so you can verify it yourself in one tap.</> },
  { q: 'How can I list my project?', a: <>Create a developer account and share your RERA number, location and project details. Once we verify your RERA number on the MahaRERA website, your project goes live on the map.</> },
];

export const metadata: Metadata = {
  title: 'FAQ',
  description: 'Answers to common questions about Mappingg — what it is, how projects are verified on MahaRERA, which areas are covered, the infrastructure we show and how to list your project.',
  alternates: { canonical: `${SITE_URL}/faq` },
};

export default function FaqPage() {
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: typeof f.a === 'string' ? f.a : f.q },
    })),
  };

  return (
    <InfoPage
      path="/faq"
      crumb="FAQ"
      eyebrow="Help & FAQ"
      icon="fas fa-circle-question"
      tone="park"
      title={<>Questions, <span className="accent">answered</span></>}
      intro="Everything you need to know about Mappingg — how it works, what we verify and how to get your project on the map."
      actions={
        <>
          <Link href="/map" className="btn btn-primary"><i className="fas fa-map" aria-hidden="true" /> Explore the live map</Link>
          <Link href="/contact" className="btn btn-outline">Still have questions?</Link>
        </>
      }
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      <section className="ipg-section">
        <div className="container">
          <div className="ipg-head">
            <span className="eyebrow"><span className="dot" />Frequently asked</span>
            <h2>Common <span className="accent">questions</span></h2>
            <p>Tap a question to read the answer.</p>
          </div>
          <div className="ipg-faq">
            {FAQS.map((f, i) => (
              <details className="ipg-faq-item" key={f.q} open={i === 0}>
                <summary>{f.q}<i className="fas fa-plus" aria-hidden="true" /></summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <CtaBand title="Didn’t find your answer?" text="Our team is happy to help with anything about projects, verification or listing.">
        <Link href="/contact" className="btn btn-primary">Contact us <i className="fas fa-arrow-right" aria-hidden="true" /></Link>
        <Link href="/map" className="btn btn-outline">Open the live map</Link>
      </CtaBand>
    </InfoPage>
  );
}

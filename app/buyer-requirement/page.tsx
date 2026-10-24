import type { Metadata } from 'next';
import InfoPage from '@/components/InfoPage';
import BuyerRequirementForm from '@/components/BuyerRequirementForm';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = buildMetadata({
  title: 'Post Your Home Requirement — Area, BHK & Budget',
  description: 'Tell Mappingg the area, BHK, budget and timeline you want. Our team shortlists matching RERA-registered projects and contacts you only with your consent.',
  path: '/buyer-requirement',
});

const STEPS = [
  { icon: 'fas fa-clipboard-list', title: 'Tell us what you need', text: 'Area, home size, budget and when you plan to buy.' },
  { icon: 'fas fa-magnifying-glass-location', title: 'We shortlist projects', text: 'Our team matches your requirement against the projects on the live map.' },
  { icon: 'fas fa-phone', title: 'We get in touch', text: 'Only in the ways you agreed to below — and you can ask us to stop any time.' },
];

export default function BuyerRequirementPage() {
  return (
    <InfoPage
      path="/buyer-requirement"
      crumb="Post a requirement"
      eyebrow="For home buyers"
      icon="fas fa-clipboard-list"
      title={<>Post your <span className="accent">home requirement</span></>}
      intro="Tell us where and what you want to buy. We'll shortlist matching projects for you."
    >
      <section className="ipg-section">
        <div className="container">
          <div className="ct-layout">
            <BuyerRequirementForm />
            <aside className="ct-aside">
              <span className="eyebrow"><span className="dot" />How it works</span>
              <h3>From requirement to <span className="accent">shortlist</span></h3>
              <ul className="cf-trust" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 14, fontSize: 14 }}>
                {STEPS.map((s) => (
                  <li key={s.title}><i className={s.icon} aria-hidden="true" /> <b>{s.title}.</b> {s.text}</li>
                ))}
              </ul>
            </aside>
          </div>
        </div>
      </section>
    </InfoPage>
  );
}

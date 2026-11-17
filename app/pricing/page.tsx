import Link from 'next/link';
import InfoPage, { CtaBand } from '@/components/InfoPage';
import PlanGrid, { PlanCompare } from '@/components/subscriptions/PlanGrid';
import '@/components/subscriptions/subscriptions.css';
import { getCurrentUser } from '@/lib/auth';
import { CATEGORY_LABEL, categoryForRole, type Category } from '@/lib/subscriptions/catalog';
import { isAvailable } from '@/lib/subscriptions/db';
import { defaultPublicPlans, publicCatalog, type PublicPlan } from '@/lib/subscriptions/summary';
import { subscriptionPath } from '@/lib/subscriptions/notifications';

export const dynamic = 'force-dynamic';

// /pricing — every active plan, read from the database (Super admin →
// Subscriptions → Plans), in three sections. If the database can't be reached
// the seeded default plans are shown instead, so the page is never empty.
// Server-rendered: no client JS (the tabs are plain anchor links).
const SECTIONS: { key: Category; title: string; intro: string; icon: string; tab: string }[] = [
  { key: 'developer', tab: 'Developers', title: 'For developers', icon: 'fas fa-building', intro: 'List projects free, then add brochures, floor plans, galleries, site-visit booking and priority promotion per project.' },
  { key: 'cp', tab: 'Channel partners', title: 'For channel partners', icon: 'fas fa-handshake', intro: 'Open project details, download brochures, manage your client leads and see future prices — pick the access you need.' },
  { key: 'buyer', tab: 'Buyers', title: 'For home buyers', icon: 'fas fa-house-chimney', intro: 'Compare, save and share projects free. Premium adds vastu and legal guidance, expert help and a portfolio manager.' },
];

const STEPS = [
  { icon: 'fas fa-user-plus', title: 'Pick your account type', text: 'Developer / Builder, Channel Partner or Buyer — each has its own plans.' },
  { icon: 'fas fa-layer-group', title: 'Choose a plan while signing up', text: 'Free is selected by default. You can also pick any paid plan right on the sign-up form.' },
  { icon: 'fas fa-lock', title: 'Pay securely (paid plans only)', text: 'Buyers pay right after sign-up. Developers and channel partners pay once their RERA number is verified.' },
  { icon: 'fas fa-circle-check', title: 'Get exactly your plan’s access', text: 'Free accounts get the Free features; each paid plan unlocks only what it lists. Upgrade any time.' },
];

async function load(): Promise<PublicPlan[]> {
  if (isAvailable()) {
    try {
      const live = (await publicCatalog()).plans;
      if (live.length) return live;
    } catch (e) {
      console.warn('[pricing] live plans unavailable, showing defaults:', e instanceof Error ? e.message : e);
    }
  }
  return defaultPublicPlans();
}

export default async function PricingPage() {
  const [plans, user] = await Promise.all([load(), getCurrentUser().catch(() => null)]);
  const mine = categoryForRole(user?.role);

  const cta = (category: Category) => function PlanCta(p: PublicPlan) {
    if (!user) {
      // Guests sign up straight into this account type with the plan pre-selected
      // (public/landing.js reads ?role=&plan=).
      const role = category === 'cp' ? 'agent' : category;
      const href = `/?signup=1&role=${role}${p.is_free ? '' : `&plan=${encodeURIComponent(p.code)}`}`;
      return <Link className={`sub-btn ${p.recommended ? 'primary' : 'ghost'} block`} href={href}>{p.is_free ? `Create free ${CATEGORY_LABEL[category]} account` : `Sign up with ${p.name}`}</Link>;
    }
    if (mine !== category) return <span className="sub-btn ghost block" aria-disabled="true">For {CATEGORY_LABEL[category]} accounts</span>;
    const href = `${subscriptionPath(category)}${p.is_free ? '' : `?plan=${encodeURIComponent(p.code)}`}`;
    return <Link className={`sub-btn ${p.recommended ? 'primary' : 'ghost'} block`} href={href}>{p.is_free ? 'View my plan' : `Choose ${p.name}`}</Link>;
  };

  // Signed-in accounts see their own section first.
  const sections = mine ? [...SECTIONS.filter((s) => s.key === mine), ...SECTIONS.filter((s) => s.key !== mine)] : SECTIONS;

  return (
    <InfoPage
      path="/pricing"
      crumb="Pricing"
      eyebrow="Membership plans"
      icon="fas fa-crown"
      tone="park"
      title={<>Plans for <span className="accent">every side of the deal</span></>}
      intro="Start free. Upgrade only for what you use — prices are per month (per project for developers) and per quarter for buyers."
      actions={
        user && mine
          ? <Link href={subscriptionPath(mine)} className="btn btn-primary">My plan &amp; billing</Link>
          : <Link href="/?signin=1" className="btn btn-outline">Already have an account? Sign in</Link>
      }
    >
      <div className="sub sub-pricing">
        <nav className="sub-tabs" aria-label="Plans by account type">
          {sections.map((s) => (
            <a key={s.key} href={`#${s.key}`}><i className={s.icon} aria-hidden="true" /> {s.tab}</a>
          ))}
        </nav>

        <section className="ipg-section sub-steps-wrap" aria-label="How plans work">
          <div className="container">
            <ol className="sub-steps">
              {STEPS.map((st, i) => (
                <li key={st.title}><span className="n">{i + 1}</span><i className={st.icon} aria-hidden="true" /><b>{st.title}</b><small>{st.text}</small></li>
              ))}
            </ol>
          </div>
        </section>

        {sections.map((s, i) => {
          const list = plans.filter((p) => p.category === s.key).sort((a, b) => a.sort - b.sort);
          return (
            <section key={s.key} id={s.key} className={`ipg-section sub-cat${i % 2 ? '' : ' alt'}`}>
              <div className="container">
                <div className="sub-wrap" style={{ padding: 0 }}>
                  <div className="sub-hero">
                    <span className="sub-eyebrow"><i className={s.icon} aria-hidden="true" /> {CATEGORY_LABEL[s.key]}{mine === s.key ? ' · your account' : ''}</span>
                    <h2>{s.title}</h2>
                    <p>{s.intro}</p>
                  </div>
                  {list.length ? (
                    <>
                      <PlanGrid plans={list} currentCode={null} cta={cta(s.key)} />
                      <PlanCompare plans={list} open />
                    </>
                  ) : (
                    <div className="sub-alert neutral"><i className="fas fa-circle-info" /><span>No plans are published for this account type yet.</span></div>
                  )}
                </div>
              </div>
            </section>
          );
        })}

        <section className="ipg-section">
          <div className="container">
            <div className="sub-wrap narrow" style={{ padding: 0 }}>
              <div className="sub-card">
                <h2><i className="fas fa-receipt" /> Billing, taxes &amp; renewals</h2>
                <ul className="sub-feats" style={{ gap: 10 }}>
                  <li><i className="fas fa-check" />The exact amount, with any GST, is shown before you pay. Payments are processed securely by Razorpay; Mappingg never sees or stores your card details.</li>
                  <li><i className="fas fa-check" />Plans renew only when you choose to — we remind you 7 days and 1 day before your plan ends.</li>
                  <li><i className="fas fa-check" />Upgrade any time: you get credit for the unused part of your current plan. Moving to a smaller plan takes effect at the end of your term.</li>
                  <li><i className="fas fa-check" />When a plan ends, nothing is deleted — your projects, leads and saved properties stay; only paid features pause until you renew.</li>
                  <li><i className="fas fa-check" />RERA and green-certification badges always show the verified status — a paid plan never changes it.</li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      </div>
      <CtaBand title={<>Questions about a plan?</>} text="Talk to the Mappingg team — we will help you pick the right plan for your projects or business.">
        <Link href="/contact" className="btn btn-primary">Contact us</Link>
      </CtaBand>
    </InfoPage>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import AccountShell from '@/components/subscriptions/AccountShell';
import { EmiCalculator, Portfolio, ServiceRequests } from '@/components/subscriptions/BuyerTools';
import { requireAccountPage } from '@/lib/subscriptions/page-auth';
import { getEntitlements, hasFeature } from '@/lib/subscriptions/entitlements';
import { projectInsights } from '@/lib/subscriptions/insights';
import { getDb } from '@/lib/mongodb';
import { getSeoProjects } from '@/lib/seo-data';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Premium buyer tools — Mappingg', robots: { index: false, follow: false, nocache: true } };

// /dashboard/buyer/premium — buyer tools. Free: loan calculator. Buyer Premium:
// vastu guide, legal checklist, insights on saved projects, expert/legal/vastu
// requests (booked with a person, never shown as done until they are) and the
// portfolio manager. Premium content is only rendered on the server when the
// plan includes it — it is not in the page for other accounts.

function Locked({ title, text }: { title: string; text: string }) {
  return (
    <div className="sub-alert neutral">
      <i className="fas fa-lock" style={{ color: '#b0924f' }} />
      <span className="grow"><b>{title}</b> — {text}</span>
      <Link className="sub-btn sm gold" href="/dashboard/buyer/subscription?plan=buyer_premium">Upgrade</Link>
    </div>
  );
}

const fmtPsf = (v: number | null) => (v ? `₹${v.toLocaleString('en-IN')}/sq ft` : '—');

export default async function PremiumPage({ params }: { params: { role: string } }) {
  const { user } = await requireAccountPage(params.role, ['buyer']);
  const ent = await getEntitlements(user);
  const can = (k: string) => !ent.enforced || hasFeature(ent, k);
  const premium = ent.plan?.code === 'buyer_premium' || (ent.plan && !ent.plan.is_free);
  const doc = await (await getDb()).collection('users').findOne({ id: user.id }, { projection: { favorite_pins: 1, compare_pins: 1, mobile: 1 } });
  const saved = [...new Set([...(Array.isArray(doc?.favorite_pins) ? doc!.favorite_pins : []), ...(Array.isArray(doc?.compare_pins) ? doc!.compare_pins : [])].map(String))].slice(0, 30);
  const insights = can('buyer_premium_insights') ? await projectInsights(saved).catch(() => []) : [];
  const projects = (await getSeoProjects().catch(() => [])).map((p) => ({ id: p.id, title: p.title || `Project #${p.number ?? ''}` }));

  return (
    <AccountShell role="buyer" active="/dashboard/buyer/premium" title="Premium buyer tools" intro={premium ? 'Your Buyer Premium tools.' : 'The loan calculator is free. Upgrade to Buyer Premium for the rest.'}>
      <div className="sub-tools">
        {can('buyer_loan_tools') ? <EmiCalculator /> : <Locked title="Loan calculator" text="not included in your plan." />}
        <div className="sub-tool">
          <h3><i className="fas fa-heart" /> Saved &amp; compared</h3>
          <p className="sub-muted">{saved.length ? `${saved.length} project${saved.length === 1 ? '' : 's'} saved or in your compare list.` : 'Save projects with ♥ and add them to Compare on the live map.'}</p>
          <div className="sub-toolbar"><Link className="sub-btn sm ghost" href="/dashboard/buyer/favorites">Favourites</Link><Link className="sub-btn sm ghost" href="/dashboard/buyer">Compare list</Link><Link className="sub-btn sm primary" href="/map">Live map</Link></div>
        </div>
      </div>

      <section className="sub-card">
        <h2><i className="fas fa-chart-simple" /> Insights on your saved projects <span className="sub-badge premium"><i className="fas fa-crown" /> Premium</span></h2>
        {!can('buyer_premium_insights') ? (
          <Locked title="Premium insights" text="price per sq ft and how each saved project compares with its locality." />
        ) : insights.length ? (
          <div className="sub-table-wrap" style={{ borderTop: 0 }}>
            <table className="sub-table">
              <thead><tr><th>Project</th><th>Listed price</th><th>Area</th><th>Indicative ₹/sq ft</th><th>Locality median</th><th>vs locality</th><th>RERA</th><th>Possession</th></tr></thead>
              <tbody>
                {insights.map((i) => (
                  <tr key={i.id}>
                    <td><Link className="sub-link" href={i.href}>{i.title}</Link><br /><small className="sub-muted">{i.locality}</small></td>
                    <td>{i.price || '—'}</td><td>{i.area || '—'}</td><td>{fmtPsf(i.psf)}</td>
                    <td>{i.localityMedianPsf ? <>{fmtPsf(i.localityMedianPsf)}<br /><small className="sub-muted">{i.localityCount} projects</small></> : <small className="sub-muted">Too few listings</small>}</td>
                    <td>{i.vsLocality == null ? '—' : <b style={{ color: i.vsLocality > 0 ? '#a9532d' : '#24603a' }}>{i.vsLocality > 0 ? '+' : ''}{i.vsLocality}%</b>}</td>
                    <td>{i.rera ? <i className="fas fa-circle-check yes" aria-label="RERA number listed" /> : '—'}</td>
                    <td>{i.possession || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="sub-empty">Save or compare projects on the live map to see insights here.</p>}
        {can('buyer_premium_insights') && <p className="sub-disclaimer" style={{ marginTop: 12 }}>Indicative ₹/sq ft = lowest listed price ÷ smallest listed area, from the details shown on Mappingg. Locality median uses other listed projects with both figures (at least 3). Always confirm the current price list and carpet area with the developer.</p>}
      </section>

      <section className="sub-card">
        <h2><i className="fas fa-user-tie" /> Talk to an expert <span className="sub-badge premium"><i className="fas fa-crown" /> Premium</span></h2>
        {can('buyer_expert_assist') ? (
          <>
            <p className="sub-muted" style={{ marginBottom: 12 }}>Book a call with the Mappingg team — a property expert, a document review with our legal partner, a vastu consultation, or a portfolio review. We confirm the slot by phone; the request shows its real status here.</p>
            <ServiceRequests projects={projects} defaultPhone={String(doc?.mobile || '')} />
          </>
        ) : <Locked title="Expert assistance" text="book calls with a property expert, legal review and vastu consultation." />}
      </section>

      <section className="sub-card">
        <h2><i className="fas fa-briefcase" /> Portfolio manager <span className="sub-badge premium"><i className="fas fa-crown" /> Premium</span></h2>
        {can('buyer_portfolio') ? <Portfolio /> : <Locked title="Portfolio manager" text="track the homes you own or booked, loans and your equity in one place." />}
      </section>

      <div className="sub-grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <section className="sub-card sub-guide">
          <h2><i className="fas fa-scale-balanced" /> Legal checklist for buying a new home <span className="sub-badge premium"><i className="fas fa-crown" /> Premium</span></h2>
          {can('buyer_legal_info') ? (
            <>
              <p className="sub-disclaimer">General information to help you ask the right questions — <b>not legal advice</b>. Have an advocate check the documents for your specific property before you pay or sign.</p>
              <h3>Before you book</h3>
              <ul>
                <li>Check the project&apos;s RERA registration on the state RERA website (MahaRERA in Maharashtra): registration number, validity, promoter details, sanctioned plans and quarterly progress updates.</li>
                <li>Ask for the title search report / title certificate and check that the land owner and the promoter (or their development agreement) match.</li>
                <li>Ask for the 7/12 extract or property card, and an encumbrance search for existing mortgages or loans on the land.</li>
                <li>See the approved building plan and commencement certificate (CC) from the planning authority, and that the floor you are buying is within the approved floors.</li>
                <li>Note the RERA carpet area of your unit — the price must be quoted on carpet area.</li>
              </ul>
              <h3>Before you pay more than 10%</h3>
              <ul>
                <li>Under RERA, the promoter should not take more than 10% of the cost before a written agreement for sale is registered.</li>
                <li>Read the agreement for sale: carpet area, total price and what it includes, payment schedule linked to construction stages, possession date, penalty/interest for delay, and defect liability (5 years under RERA).</li>
                <li>The agreement must be registered; stamp duty and registration charges are paid by the buyer and vary by state and city.</li>
                <li>If you take a loan, confirm the bank has approved the project (APF) — it is also a useful check.</li>
              </ul>
              <h3>At possession</h3>
              <ul>
                <li>Ask for the occupancy certificate (OC) before taking possession; check utilities (water, electricity, sewage) are connected.</li>
                <li>Get the possession letter, all payment receipts, and the society formation / conveyance timeline in writing.</li>
              </ul>
            </>
          ) : <Locked title="Legal checklist" text="step-by-step document checks before booking, paying and taking possession." />}
        </section>

        <section className="sub-card sub-guide">
          <h2><i className="fas fa-compass" /> Vastu guide <span className="sub-badge premium"><i className="fas fa-crown" /> Premium</span></h2>
          {can('buyer_vastu') ? (
            <>
              <p className="sub-disclaimer">Vastu Shastra is a traditional system of design preferences. These are commonly followed guidelines, not scientific or engineering advice — the floor plan, light, ventilation and structure matter most. For a home-specific opinion, book a vastu consultation above.</p>
              <h3>Commonly preferred placements</h3>
              <ul>
                <li><b>Main entrance:</b> north, east or north-east facing entrances are traditionally favoured.</li>
                <li><b>Kitchen:</b> south-east (the Agni corner), with the cook facing east; north-west is the usual alternative.</li>
                <li><b>Master bedroom:</b> south-west, with the head of the bed towards the south or east.</li>
                <li><b>Living room:</b> north or east, ideally with more open space and windows on those sides.</li>
                <li><b>Puja / prayer space:</b> north-east corner of the home.</li>
                <li><b>Toilets:</b> north-west or west; traditionally avoided in the north-east and the centre of the home.</li>
                <li><b>Staircase &amp; heavy storage:</b> south or west sides.</li>
                <li><b>Centre of the home (Brahmasthan):</b> kept open and uncluttered.</li>
              </ul>
              <h3>When comparing flats</h3>
              <ul>
                <li>Use the compass direction on the floor plan (check it on site with a phone compass — brochure plans are not always to true north).</li>
                <li>Most apartments can&apos;t follow every rule; buyers usually prioritise the entrance, kitchen and master bedroom.</li>
              </ul>
            </>
          ) : <Locked title="Vastu guide" text="traditional placement guidelines to check floor plans against." />}
        </section>
      </div>
    </AccountShell>
  );
}

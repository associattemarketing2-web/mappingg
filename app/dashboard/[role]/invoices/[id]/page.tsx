import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import '@/components/subscriptions/subscriptions.css';
import PrintButton from '@/components/subscriptions/PrintButton';
import { requireAccountPage } from '@/lib/subscriptions/page-auth';
import { ensureSchema } from '@/lib/subscriptions/db';
import { getInvoice } from '@/lib/subscriptions/invoices';
import { formatInr } from '@/lib/subscriptions/catalog';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Invoice — Mappingg', robots: { index: false, follow: false, nocache: true } };

// A printable invoice (Download → the browser's "Save as PDF"). Only its owner
// can open it; the content is the snapshot taken when the payment was made.
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—');

export default async function InvoicePage({ params }: { params: { role: string; id: string } }) {
  const { user } = await requireAccountPage(params.role, ['developer', 'agent', 'buyer']);
  await ensureSchema();
  const inv = await getInvoice(String(params.id).slice(0, 60), user.id);
  if (!inv) notFound();
  const t = inv.totals as Record<string, number | string>;
  const n = (k: string) => Number(t[k] || 0);
  const s = inv.seller, c = inv.customer;
  const registered = !!s.registered;
  const title = registered ? 'Tax Invoice' : 'Invoice';
  return (
    <div className="sub sub-page" style={{ padding: '24px 16px 48px' }}>
      <div className="sub-print-bar">
        <PrintButton />
        <a className="sub-btn ghost" href={`/dashboard/${user.role}/subscription`}><i className="fas fa-arrow-left" /> Back to My subscription</a>
      </div>
      <article className="sub-invoice">
        <div className="head">
          <div>
            <div className="sub-brand" style={{ marginBottom: 8 }}><span className="mark" aria-hidden="true" /><b>Mappingg<em>.com</em></b></div>
            <div className="sub-muted" style={{ fontSize: 12.5 }}>
              {s.legal_name || 'Mappingg'}<br />
              {s.address && <>{s.address}<br /></>}
              {registered && s.gstin && <>GSTIN: {s.gstin}<br /></>}
              {s.state && <>State: {s.state}{s.state_code ? ` (${s.state_code})` : ''}<br /></>}
              {s.support_email && <>{s.support_email}</>}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h1>{title}</h1>
            <div className="sub-muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
              No. <b style={{ color: '#16261f' }}>{inv.number}</b><br />
              Date: {fmt(inv.issued_at)}<br />
              Status: <b style={{ color: inv.status === 'paid' ? '#24603a' : '#a9532d' }}>{inv.status === 'paid' ? 'Paid' : inv.status === 'refunded' ? 'Refunded' : 'Partly refunded'}</b>
            </div>
          </div>
        </div>
        <div className="parties">
          <div>
            <b>Billed to</b><br />
            {c.name || '—'}<br />
            {c.email}{c.mobile ? <><br />{c.mobile}</> : null}
            {c.address ? <><br />{c.address}</> : null}
            {c.gstin ? <><br />GSTIN: {c.gstin}</> : null}
          </div>
          <div>
            <b>Billing period</b><br />
            {fmt(inv.period_start)} – {fmt(inv.period_end)}<br />
            <b>Payment</b><br />
            {String(t.gateway) === 'none' ? 'No payment needed (coupon / credit)' : `Razorpay · ${t.gateway_payment_id || '—'}`}
            {registered && <><br />Place of supply: {c.state_code || s.state_code}</>}
          </div>
        </div>
        <table>
          <thead><tr><th>Description</th>{registered && <th>SAC</th>}<th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i}><td>{l.description}</td>{registered && <td>{l.sac || '—'}</td>}<td>{l.quantity}</td><td>{formatInr(l.unit_paise)}</td><td>{formatInr(l.amount_paise)}</td></tr>
            ))}
            {n('discount_paise') > 0 && <tr><td colSpan={registered ? 4 : 3}>Discount{t.coupon_code ? ` (coupon ${t.coupon_code})` : ''}</td><td>− {formatInr(n('discount_paise'))}</td></tr>}
            {n('credit_paise') > 0 && <tr><td colSpan={registered ? 4 : 3}>Credit for unused time on previous plan</td><td>− {formatInr(n('credit_paise'))}</td></tr>}
            {String(inv.tax_mode) !== 'none' && (
              <>
                <tr><td colSpan={registered ? 4 : 3}>Taxable value</td><td>{formatInr(n('taxable_paise'))}</td></tr>
                {n('cgst_paise') > 0 && <tr><td colSpan={registered ? 4 : 3}>CGST @ {n('tax_rate') / 2}%</td><td>{formatInr(n('cgst_paise'))}</td></tr>}
                {n('sgst_paise') > 0 && <tr><td colSpan={registered ? 4 : 3}>SGST @ {n('tax_rate') / 2}%</td><td>{formatInr(n('sgst_paise'))}</td></tr>}
                {n('igst_paise') > 0 && <tr><td colSpan={registered ? 4 : 3}>IGST @ {n('tax_rate')}%</td><td>{formatInr(n('igst_paise'))}</td></tr>}
              </>
            )}
            <tr className="tot"><td colSpan={registered ? 4 : 3}>Total paid ({String(t.currency || 'INR')})</td><td>{formatInr(n('total_paise'))}</td></tr>
          </tbody>
        </table>
        <div className="foot">
          {registered
            ? (String(inv.tax_mode) === 'inclusive' ? 'Amounts are inclusive of GST.' : 'GST charged as shown above.')
            : 'The supplier is not registered under GST; no GST has been charged on this invoice.'}
          {' '}This is a computer-generated invoice and does not need a signature. Order reference: {String(t.gateway_order_id || '—')}.
        </div>
      </article>
    </div>
  );
}

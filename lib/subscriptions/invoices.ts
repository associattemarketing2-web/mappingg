import { iso, sql, type Row, type Sql } from './db';
import { newId, nextCounter } from './store';
import { CATEGORY_LABEL, type Category } from './catalog';
import type { SubSettings } from './db';

// Invoices. One per paid payment (unique on payment_id), numbered in an
// unbroken sequence per Indian financial year (Apr–Mar), e.g. MPG/2026-27/00001.
// Seller and customer details are snapshotted at issue time so a later profile
// or settings change never rewrites an issued invoice.

export interface Invoice {
  id: string;
  number: string;
  payment_id: string;
  user_id: string;
  subscription_id: string | null;
  status: string;
  tax_mode: string;
  seller: Record<string, any>;
  customer: Record<string, any>;
  lines: { description: string; sac?: string; quantity: number; unit_paise: number; amount_paise: number }[];
  totals: Record<string, number | string>;
  period_start: string | null;
  period_end: string | null;
  issued_at: string;
}

export function financialYear(at: Date): string {
  const ist = new Date(at.getTime() + 330 * 60_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

const toInvoice = (r: Row): Invoice => ({
  id: r.id, number: r.number, payment_id: r.payment_id, user_id: r.user_id, subscription_id: r.subscription_id, status: r.status,
  tax_mode: r.tax_mode, seller: r.seller || {}, customer: r.customer || {}, lines: r.lines || [], totals: r.totals || {},
  period_start: iso(r.period_start), period_end: iso(r.period_end), issued_at: iso(r.issued_at)!,
});

export async function issueInvoice(
  p: Row,
  ctx: { settings: SubSettings; customer: { name: string; email: string; mobile: string }; subscriptionId: string | null; periodStart: Date | null; periodEnd: Date | null },
  q: Sql = sql,
): Promise<Invoice> {
  const existing = await q(`SELECT * FROM sub_invoices WHERE payment_id = $1`, [p.id]);
  if (existing.rows[0]) return toInvoice(existing.rows[0]);
  const now = new Date();
  const fy = financialYear(now);
  const seq = await nextCounter(`invoice:${fy}`, q);
  const prefix = (ctx.settings.invoice_prefix || 'MPG').replace(/[^A-Za-z0-9-]/g, '').slice(0, 10) || 'MPG';
  const number = `${prefix}/${fy}/${String(seq).padStart(5, '0')}`;
  const t = ctx.settings.tax;
  const billing = (p.billing || {}) as Record<string, string>;
  const desc = `${CATEGORY_LABEL[p.category as Category] || ''} subscription — ${p.plan_name} (${p.kind === 'upgrade' ? 'upgrade' : p.kind === 'renewal' ? 'renewal' : 'new'}, ${Number(p.period_months)} month${Number(p.period_months) === 1 ? '' : 's'})`;
  const lines = [{
    description: desc + (Number(p.quantity) > 1 || (p.project_ids || []).length ? ` · ${p.quantity} project${Number(p.quantity) === 1 ? '' : 's'}` : ''),
    sac: t.sac || undefined, quantity: Number(p.quantity), unit_paise: Number(p.unit_price_paise), amount_paise: Number(p.base_paise),
  }];
  const totals = {
    base_paise: Number(p.base_paise), discount_paise: Number(p.discount_paise), credit_paise: Number(p.credit_paise),
    taxable_paise: Number(p.taxable_paise), cgst_paise: Number(p.cgst_paise), sgst_paise: Number(p.sgst_paise), igst_paise: Number(p.igst_paise),
    tax_paise: Number(p.tax_paise), total_paise: Number(p.total_paise), tax_rate: Number(p.tax_rate), coupon_code: p.coupon_code || '',
    gateway: p.gateway, gateway_payment_id: p.gateway_payment_id || '', gateway_order_id: p.gateway_order_id || '', currency: p.currency,
  };
  const seller = { legal_name: t.legal_name, gstin: t.registered ? t.gstin : '', address: t.address, state: t.state, state_code: t.state_code, registered: t.registered, support_email: ctx.settings.support_email };
  const customer = {
    name: billing.name || ctx.customer.name, email: ctx.customer.email, mobile: ctx.customer.mobile,
    gstin: billing.gstin || '', address: billing.address || '', state_code: billing.state_code || '',
  };
  const r = await q(
    `INSERT INTO sub_invoices (id, number, payment_id, user_id, subscription_id, status, tax_mode, seller, customer, lines, totals, period_start, period_end)
     VALUES ($1,$2,$3,$4,$5,'paid',$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12) RETURNING *`,
    [newId('inv'), number, p.id, p.user_id, ctx.subscriptionId, p.tax_mode, JSON.stringify(seller), JSON.stringify(customer),
      JSON.stringify(lines), JSON.stringify(totals), ctx.periodStart, ctx.periodEnd],
  );
  return toInvoice(r.rows[0]);
}

export async function listInvoices(userId: string): Promise<Invoice[]> {
  return (await sql(`SELECT * FROM sub_invoices WHERE user_id = $1 ORDER BY issued_at DESC LIMIT 200`, [userId])).rows.map(toInvoice);
}

/** One invoice — only for its owner, or for staff (ownerId null). */
export async function getInvoice(id: string, ownerId: string | null): Promise<Invoice | null> {
  const r = ownerId
    ? await sql(`SELECT * FROM sub_invoices WHERE id = $1 AND user_id = $2`, [id, ownerId])
    : await sql(`SELECT * FROM sub_invoices WHERE id = $1`, [id]);
  return r.rows[0] ? toInvoice(r.rows[0]) : null;
}

export async function setInvoiceStatus(paymentId: string, status: string, q: Sql = sql) {
  await q(`UPDATE sub_invoices SET status = $2 WHERE payment_id = $1`, [paymentId, status]);
}

import type { UsagePeriod } from './catalog';

// Pure money & date maths for subscriptions — no database, fully unit-tested.
// All amounts are integer paise. The server is the only place a price is ever
// computed; nothing the browser sends is trusted as an amount.

const IST_OFFSET_MS = 330 * 60_000;

/** Calendar date in India (Asia/Kolkata, UTC+5:30, no DST). */
function istParts(at: Date) {
  const d = new Date(at.getTime() + IST_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate(), dow: d.getUTCDay() };
}

/** ISO-8601 week in India time, e.g. "2026-W46" — weekly limits reset Monday 00:00 IST. */
export function isoWeekKey(at: Date = new Date()): string {
  const { y, m, day } = istParts(at);
  const d = new Date(Date.UTC(y, m, day));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function periodKey(period: UsagePeriod, at: Date = new Date()): string {
  if (period === 'lifetime') return 'all';
  if (period === 'month') { const { y, m } = istParts(at); return `${y}-${String(m + 1).padStart(2, '0')}`; }
  return isoWeekKey(at);
}

/** When the current usage window ends (next Monday / 1st of month 00:00 IST); null for lifetime. */
export function periodResetsAt(period: UsagePeriod, at: Date = new Date()): Date | null {
  if (period === 'lifetime') return null;
  const { y, m, day, dow } = istParts(at);
  if (period === 'month') return new Date(Date.UTC(y, m + 1, 1) - IST_OFFSET_MS);
  const daysToMonday = ((8 - (dow || 7)) % 7) || 7;
  return new Date(Date.UTC(y, m, day + daysToMonday) - IST_OFFSET_MS);
}

/** Add calendar months, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export interface TaxConfig {
  registered: boolean;
  rate: number;
  inclusive: boolean;
  state_code: string;
}

export interface CouponTerms {
  code: string;
  percent_off: number;
  amount_off_paise: number;
}

export interface QuoteInput {
  unit_price_paise: number;
  quantity: number;
  coupon?: CouponTerms | null;
  /** Unused value of the plan being replaced (upgrades), already in paise. */
  credit_paise?: number;
  tax: TaxConfig;
  /** Customer's GST state code (place of supply). Defaults to the seller's state. */
  customer_state_code?: string | null;
}

export interface Quote {
  unit_price_paise: number;
  quantity: number;
  base_paise: number;
  discount_paise: number;
  credit_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  tax_paise: number;
  total_paise: number;
  tax_mode: 'none' | 'exclusive' | 'inclusive';
  tax_rate: number;
  coupon_code: string | null;
}

/**
 * Price breakdown for one checkout. Order: base → coupon → upgrade credit → GST.
 * Not GST-registered: no tax line, total = taxable value.
 * Exclusive GST: tax added on top of the taxable value.
 * Inclusive GST: the taxable value is backed out of the (discounted) price.
 * Intra-state supply splits GST into CGST + SGST; inter-state is IGST.
 */
export function computeQuote(input: QuoteInput): Quote {
  const qty = Math.max(1, Math.floor(input.quantity || 1));
  const unit = Math.max(0, Math.round(input.unit_price_paise));
  const base = unit * qty;
  let discount = 0;
  if (input.coupon) {
    const pct = Math.min(100, Math.max(0, input.coupon.percent_off || 0));
    discount = Math.round((base * pct) / 100) + Math.max(0, Math.round(input.coupon.amount_off_paise || 0));
    discount = Math.min(discount, base);
  }
  const credit = Math.min(Math.max(0, Math.round(input.credit_paise || 0)), base - discount);
  const net = base - discount - credit;

  const rate = input.tax.registered ? Math.max(0, Number(input.tax.rate) || 0) : 0;
  let taxable = net, tax = 0;
  let mode: Quote['tax_mode'] = 'none';
  if (rate > 0) {
    if (input.tax.inclusive) {
      mode = 'inclusive';
      taxable = Math.round((net * 100) / (100 + rate));
      tax = net - taxable;
    } else {
      mode = 'exclusive';
      tax = Math.round((net * rate) / 100);
    }
  }
  const intra = !input.customer_state_code || input.customer_state_code === input.tax.state_code;
  let cgst = 0, sgst = 0, igst = 0;
  if (tax > 0) {
    if (intra) { cgst = Math.floor(tax / 2); sgst = tax - cgst; } else igst = tax;
  }
  return {
    unit_price_paise: unit, quantity: qty, base_paise: base, discount_paise: discount, credit_paise: credit,
    taxable_paise: taxable, cgst_paise: cgst, sgst_paise: sgst, igst_paise: igst, tax_paise: tax,
    total_paise: taxable + tax, tax_mode: mode, tax_rate: rate, coupon_code: input.coupon?.code || null,
  };
}

/**
 * Unused value of a running subscription, used as upgrade credit: the
 * pre-tax amount actually paid × the share of the term that is left.
 */
export function unusedCredit(paidTaxablePaise: number, startAt: Date, expiresAt: Date, now: Date = new Date()): number {
  const total = expiresAt.getTime() - startAt.getTime();
  const left = expiresAt.getTime() - now.getTime();
  if (total <= 0 || left <= 0 || paidTaxablePaise <= 0) return 0;
  return Math.floor((paidTaxablePaise * Math.min(left, total)) / total);
}

/** Whole days until `to` (ceil; 0 if past). */
export function daysLeft(to: Date | string | null | undefined, now: Date = new Date()): number {
  if (!to) return 0;
  const ms = new Date(to).getTime() - now.getTime();
  return ms > 0 ? Math.ceil(ms / 86_400_000) : 0;
}

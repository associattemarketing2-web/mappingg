// Small date helpers shared by the admin Dashboard and SEO & Health charts.

/** Monday (UTC) of the week containing `d`, as YYYY-MM-DD. */
export function weekStart(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

/** The last `n` week-starts, oldest first, ending with the current week. */
export function lastWeeks(n: number): string[] {
  const out: string[] = [];
  const start = new Date(weekStart(new Date()) + 'T00:00:00Z');
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() - i * 7);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Counts dates per week for the given weeks (dates outside them are ignored). */
export function perWeek(dates: unknown[], weeks: string[]) {
  const counts = new Map(weeks.map((w) => [w, 0]));
  for (const v of dates) {
    const d = new Date(String(v || ''));
    if (Number.isNaN(d.getTime())) continue;
    const w = weekStart(d);
    if (counts.has(w)) counts.set(w, (counts.get(w) || 0) + 1);
  }
  return weeks.map((week) => ({ week, count: counts.get(week) || 0 }));
}

/** YYYY-MM-DD of `d` in India Standard Time (the business's calendar day). */
const istDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
export function dayKeyIST(d: Date): string {
  return istDay.format(d);
}

/**
 * Per-day counts (IST) for the last `weeks` whole weeks, Monday-aligned and
 * ending today — the shape a calendar heatmap needs. Future days are omitted.
 */
export function perDay(dates: unknown[], weeks = 26) {
  const today = dayKeyIST(new Date());
  const t = new Date(today + 'T00:00:00Z');
  const start = new Date(t);
  start.setUTCDate(start.getUTCDate() - ((t.getUTCDay() + 6) % 7) - (weeks - 1) * 7);
  const counts = new Map<string, number>();
  for (let d = new Date(start); d <= t; d.setUTCDate(d.getUTCDate() + 1)) counts.set(d.toISOString().slice(0, 10), 0);
  for (const v of dates) {
    const d = new Date(String(v || ''));
    if (Number.isNaN(d.getTime())) continue;
    const k = dayKeyIST(d);
    if (counts.has(k)) counts.set(k, (counts.get(k) || 0) + 1);
  }
  return { today, days: [...counts.entries()].map(([date, count]) => ({ date, count })) };
}

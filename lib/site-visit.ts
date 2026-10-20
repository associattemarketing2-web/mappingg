// A site visit booked from the live map ("Book Site Visit"): the day the
// visitor picked (YYYY-MM-DD) and their time slot, e.g. "10:00 AM – 12:00 PM".

/** "Sat, 25 Oct 2026 · 10:00 AM – 12:00 PM" — or '' when nothing was picked. */
export function siteVisitSlot(date: unknown, time: unknown): string {
  const d = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  const day = d && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : '';
  const slot = typeof time === 'string' ? time.trim() : '';
  return [day, slot].filter(Boolean).join(' · ');
}

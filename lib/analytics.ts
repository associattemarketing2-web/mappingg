// Buyer-journey events for GA4 (browser only). No personal data is ever sent:
// no names, phone numbers or emails — only page context like a project number.
//
// With a GTM container (the live setup) events go to the dataLayer as
// { event: 'generate_lead', ... }: add a "Custom event" trigger and a GA4 event
// tag per event name in GTM (seo-doc/IMPLEMENTATION-REPORT.md lists them).
// Without GTM, the standalone gtag.js sends them to GA4 directly.
// Consent Mode (app/layout.tsx) still decides whether anything is stored.

type Params = Record<string, string | number | boolean | undefined>;

export function track(event: string, params: Params = {}): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { dataLayer?: unknown[]; mgTag?: string; gtag?: (...a: unknown[]) => void };
  if (!w.dataLayer) return; // no Google tags configured on this site
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''));
  if (w.mgTag === 'gtag' && typeof w.gtag === 'function') w.gtag('event', event, clean);
  else w.dataLayer.push({ event, ...clean });
}

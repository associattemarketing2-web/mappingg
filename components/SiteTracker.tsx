'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

// Anonymous website analytics for the super-admin dashboard (lib/site-analytics.ts):
// a page view per route change, link/button clicks, searches typed into the
// site's search boxes (home page, live map), and a heartbeat every
// minute while the tab is visible (that is what "active now" counts).
// No cookies or storage; events go out in small batches with sendBeacon.
// Staff areas are never tracked.
const SKIP = /^\/(dashboard|s-admin|intake|partners|api)(\/|$)/;
const HEARTBEAT_MS = 60_000;

type Ev = { k: 'pv'; p: string; r?: string; u?: string; w?: number } | { k: 'click'; p: string; l: string; h?: string } | { k: 'hb'; p: string } | { k: 'search'; p: string; l: string };
// The site's search boxes: the home page "ask" form and the live map's search.
const SEARCH_INPUT = 'input[type="search"], input[id*="search" i], input[name="q"], form[role="search"] input';

let queue: Ev[] = [];
// The same page reported twice within a second (React dev double-render,
// a quick re-mount) is one view.
let lastPv = { p: '', t: 0 };
// The referrer / campaign belong to the first page of a visit only.
let landed = false;
function flush() {
  if (!queue.length) return;
  const body = JSON.stringify({ e: queue.splice(0, 20) });
  try {
    if (!navigator.sendBeacon?.('/api/track', new Blob([body], { type: 'text/plain' }))) {
      fetch('/api/track', { method: 'POST', body, keepalive: true }).catch(() => {});
    }
  } catch { /* analytics must never break the page */ }
  if (queue.length) flush();
}
const send = (e: Ev, now = false) => { queue.push(e); if (now || queue.length >= 10) flush(); };

/** What a click was on: its tracking name, accessible label, heading (cards) or visible text. */
function labelOf(el: HTMLElement): string {
  const heading = el.querySelector('h1, h2, h3, h4, b, strong') as HTMLElement | null;
  const t = el.getAttribute('data-track') || el.getAttribute('aria-label') || el.getAttribute('title')
    || (el.innerText.length > 60 && heading ? heading.innerText : el.innerText) || '';
  return t.replace(/\s+/g, ' ').trim().slice(0, 80);
}
function hrefOf(el: HTMLElement): string | undefined {
  const raw = el.getAttribute('href');
  if (!raw || raw.startsWith('#') || raw.startsWith('javascript')) return undefined;
  if (/^(tel|mailto):/i.test(raw)) return raw.split('?')[0].slice(0, 200);
  try {
    const u = new URL(raw, location.href);
    return u.origin === location.origin ? u.pathname : u.hostname + (u.hostname === 'wa.me' ? u.pathname : '');
  } catch { return undefined; }
}

export default function SiteTracker() {
  const pathname = usePathname() || '/';

  // One page view per route.
  useEffect(() => {
    if (SKIP.test(pathname)) return;
    const now = Date.now();
    if (lastPv.p === pathname && now - lastPv.t < 1000) return;
    lastPv = { p: pathname, t: now };
    const params = new URLSearchParams(location.search);
    send({
      k: 'pv', p: pathname, w: window.innerWidth,
      ...(!landed ? { r: document.referrer || '', u: params.get('utm_source') || '' } : {}),
    }, true);
    landed = true;
  }, [pathname]);

  // Clicks + heartbeat, wired once.
  useEffect(() => {
    const here = () => location.pathname;
    function onClick(e: MouseEvent) {
      if (SKIP.test(here())) return;
      const el = (e.target as HTMLElement)?.closest?.('a, button, [data-track], [role="button"]') as HTMLElement | null;
      if (!el) return;
      const l = labelOf(el);
      if (!l) return;
      send({ k: 'click', p: here(), l, h: hrefOf(el) }, el.tagName === 'A');
    }
    document.addEventListener('click', onClick, { capture: true, passive: true });
    // A search counts when it is submitted (Enter / form submit), when typing
    // pauses (the live map filters as you type), when the box is left, or when
    // a suggestion is picked. The same term within 20 s is one search.
    let lastSearch = { l: '', t: 0 };
    let typing: ReturnType<typeof setTimeout> | undefined;
    function searched(input: HTMLInputElement | null, term?: string) {
      if (!term && (!input || input.type === 'password' || input.type === 'email')) return;
      if (SKIP.test(here())) return;
      const l = (term ?? input?.value ?? '').replace(/s+/g, ' ').trim().slice(0, 80);
      if (l.length < 2) return;
      const now = Date.now();
      if (l.toLowerCase() === lastSearch.l && now - lastSearch.t < 20_000) return;
      lastSearch = { l: l.toLowerCase(), t: now };
      send({ k: 'search', p: here(), l });
    }
    const asSearch = (t: EventTarget | null) => ((t as HTMLElement)?.matches?.(SEARCH_INPUT) ? (t as HTMLInputElement) : null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') searched(asSearch(e.target)); };
    const onChange = (e: Event) => searched(asSearch(e.target));
    const onInput = (e: Event) => {
      const input = asSearch(e.target);
      if (!input) return;
      clearTimeout(typing);
      typing = setTimeout(() => searched(input), 1500);
    };
    // Picking one of the live map's search suggestions.
    const onPick = (e: MouseEvent) => {
      const item = (e.target as HTMLElement)?.closest?.('.suggestion-item') as HTMLElement | null;
      if (item) { clearTimeout(typing); searched(null, (item.querySelector('span')?.textContent || item.textContent || '')); }
    };
    const onSubmit = (e: Event) => { const f = e.target as HTMLFormElement; if (f?.matches?.('form[role="search"]')) searched(f.querySelector('input')); };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('click', onPick, true);
    const beat = setInterval(() => {
      if (document.visibilityState === 'visible' && !SKIP.test(here())) send({ k: 'hb', p: here() }, true);
    }, HEARTBEAT_MS);
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    const t = setInterval(flush, 5000);
    return () => {
      document.removeEventListener('click', onClick, { capture: true });
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('change', onChange, true);
      document.removeEventListener('submit', onSubmit, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('click', onPick, true);
      clearTimeout(typing);
      document.removeEventListener('visibilitychange', onHide);
      clearInterval(beat); clearInterval(t); flush();
    };
  }, []);

  return null;
}

'use client';

import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

// Simple horizontal carousel: native scroll with snap (touch swipe, trackpad,
// keyboard arrows once focused) plus previous / next buttons on wider screens.
// It scrolls inside its own track, so it never widens the page.
export default function Carousel({ label, children }: { label: string; children: ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: true });
  const update = useCallback(() => {
    const el = track.current;
    if (el) setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [update, children]);
  const go = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.85, 220), behavior: smooth ? 'smooth' : 'auto' });
  };
  return (
    <div className="hf-carousel">
      <button type="button" className="hf-arrow prev" onClick={() => go(-1)} disabled={edge.start} aria-label={`Previous — ${label}`}><i className="fas fa-chevron-left" aria-hidden="true" /></button>
      <div className="hf-track" ref={track} onScroll={update} role="list" tabIndex={0} aria-label={`${label} — scroll sideways for more`}>
        {Children.map(children, (c) => <div role="listitem" className="hf-slide">{c}</div>)}
      </div>
      <button type="button" className="hf-arrow next" onClick={() => go(1)} disabled={edge.end} aria-label={`Next — ${label}`}><i className="fas fa-chevron-right" aria-hidden="true" /></button>
    </div>
  );
}

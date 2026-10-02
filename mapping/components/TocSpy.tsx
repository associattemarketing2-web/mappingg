'use client';

import { useEffect, useRef, useState } from 'react';

// Reading aids for the legal pages, all purely cosmetic (the page works as plain
// links without JS): highlights the table-of-contents entry for the section
// being read, fills a thin progress bar at the top of the screen, and shows a
// back-to-top button once the reader is well into the document.
export default function TocSpy() {
  const barRef = useRef<HTMLSpanElement>(null);
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.ipg-toc ol a[href^="#"]'));
    const sections = links
      .map((a) => document.getElementById(a.getAttribute('href')!.slice(1)))
      .filter((s): s is HTMLElement => !!s);
    if (!sections.length) return;

    const visible = new Set<string>();
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => (e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id)));
        const current = sections.find((s) => visible.has(s.id));
        if (!current) return;
        links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${current.id}`));
        // On small screens the TOC is a sideways-scrolling chip row — keep the active chip in view.
        const list = links[0].closest('ol');
        const active = links.find((a) => a.classList.contains('active'));
        if (list && active && list.scrollWidth > list.clientWidth) {
          list.scrollTo({ left: active.offsetLeft - list.offsetLeft - 12, behavior: 'smooth' });
        }
      },
      { rootMargin: '-110px 0px -55% 0px' },
    );
    sections.forEach((s) => obs.observe(s));

    // Progress is measured over the document body only, so it reaches 100% at
    // the last section rather than at the bottom of the footer.
    const doc = document.querySelector<HTMLElement>('.ipg-doc');
    let frame = 0;
    function onScroll() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (doc && barRef.current) {
          const r = doc.getBoundingClientRect();
          const total = r.height - window.innerHeight * 0.6;
          const p = Math.min(1, Math.max(0, (-r.top + 120) / Math.max(total, 1)));
          barRef.current.style.transform = `scaleX(${p})`;
        }
        setShowTop(window.scrollY > 900);
      });
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    return () => {
      obs.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <>
      <div className="ipg-progress" aria-hidden="true"><span ref={barRef} /></div>
      <button
        type="button"
        className={`ipg-top${showTop ? ' show' : ''}`}
        aria-label="Back to top"
        tabIndex={showTop ? 0 : -1}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </>
  );
}

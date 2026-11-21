'use client';

import { useEffect, useRef, useState } from 'react';
import './app-launch-banner.css';

// "The Mappingg app is coming soon" celebration on the home page: a floating card
// with a confetti burst and a link to the launch event's registration page
// (NEXT_PUBLIC_EVENT_SITE_URL, the separate mappinggevent site). Shown every time
// the home page opens or reloads; closing it hides it until the next visit.
// The app is Android-only for now (no App Store mention).

const EVENT_URL = process.env.NEXT_PUBLIC_EVENT_SITE_URL || '';
const COLORS = ['#0f5c47', '#2f7a3c', '#e3a83e', '#7f6527', '#a9532d', '#ffffff'];

function confetti(canvas: HTMLCanvasElement) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = (canvas.width = window.innerWidth * dpr);
  const h = (canvas.height = window.innerHeight * dpr);
  const bits = Array.from({ length: 140 }, () => ({
    x: w * (0.15 + Math.random() * 0.7), y: h + 20 * dpr,
    vx: (Math.random() - 0.5) * 14 * dpr, vy: -(12 + Math.random() * 14) * dpr,
    s: (5 + Math.random() * 6) * dpr, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
    c: COLORS[(Math.random() * COLORS.length) | 0],
  }));
  const start = performance.now();
  const tick = (t: number) => {
    ctx.clearRect(0, 0, w, h);
    for (const b of bits) {
      b.vy += 0.38 * dpr; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r);
      ctx.fillStyle = b.c; ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
      ctx.restore();
    }
    if (t - start < 3800) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, w, h);
  };
  requestAnimationFrame(tick);
}

export default function AppLaunchBanner() {
  const [open, setOpen] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setOpen(true);
      if (canvas.current) confetti(canvas.current);
    }, 1800);
    return () => clearTimeout(t);
  }, []);

  const close = () => setOpen(false);

  return (
    <>
      <canvas ref={canvas} className="alb-confetti" aria-hidden="true" />
      {open && (
        <aside className="alb" role="complementary" aria-label="Mappingg app launching soon">
          <button className="alb-x" onClick={close} aria-label="Close"><i className="fas fa-xmark" /></button>
          <div className="alb-top">
            <span className="alb-phone" aria-hidden="true"><i className="fas fa-mobile-screen-button" /><b>🎉</b></span>
            <div>
              <span className="alb-tag"><i className="fas fa-champagne-glasses" /> Coming soon</span>
              <h3>The Mappingg app is almost here!</h3>
            </div>
          </div>
          <p>Live project maps, new launches and price insights for Pune — right in your pocket. Launching soon on Android.</p>
          <div className="alb-stores" aria-hidden="true">
            <span><i className="fab fa-google-play" /> Coming soon on Google Play</span>
          </div>
          {EVENT_URL && (
            <a className="alb-cta" href={EVENT_URL} target="_blank" rel="noopener">
              Join the launch event <i className="fas fa-arrow-right" />
            </a>
          )}
        </aside>
      )}
    </>
  );
}

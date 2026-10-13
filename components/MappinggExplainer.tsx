'use client';

import { useEffect, useRef, useState } from 'react';

// "How Mappingg works" — a short looping animated explainer drawn in HTML/CSS
// (no video file) of the real live-map flow: explore the colour-coded pins →
// search a locality → open a project's details → enquire.
// Styles: .mx-* in app/info.css. Plays only while on screen; with
// prefers-reduced-motion it starts paused and the steps can be clicked through.

const STEPS = [
  { icon: 'fas fa-map-location-dot', title: 'Explore the live map', text: 'Every project is a pin on a real map of Pune and Mumbai, colour-coded as available, under construction, upcoming or sold.' },
  { icon: 'fas fa-magnifying-glass-location', title: 'Search where you want to buy', text: 'Type a locality such as Kharadi or Thane, or tap Near Me, and the map takes you there. Switch to satellite view to see the surroundings.' },
  { icon: 'fas fa-scale-balanced', title: 'Compare the details', text: 'Tap a pin, then View Full Details, for the price, configuration, possession date and MahaRERA number.' },
  { icon: 'fas fa-comments', title: 'Enquire in one tap', text: 'Share your name and WhatsApp number once, and the team gets back to you about the project you viewed.' },
];
const STATUS = ['#3f8f6b', '#c98a2c', '#3b6ea5', '#b5484c']; // available, under construction, upcoming, sold (live-map legend)
const STEP_MS = 4200;

// Pins on the mini map: [left %, top %, status index, near the searched locality]
const PINS: [number, number, number, boolean][] = [
  [18, 30, 0, false], [30, 62, 1, true], [44, 26, 2, false], [52, 48, 0, true], [63, 70, 3, false], [72, 34, 1, true], [84, 58, 2, false], [38, 80, 0, false],
];

export default function MappinggExplainer() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [visible, setVisible] = useState(false);
  const [cycle, setCycle] = useState(0); // restarts the progress animation
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setPlaying(false);
    const el = root.current;
    if (!el || !('IntersectionObserver' in window)) { setVisible(true); return; }
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const running = playing && visible;
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => { setStep((s) => (s + 1) % STEPS.length); setCycle((c) => c + 1); }, STEP_MS);
    return () => clearTimeout(t);
  }, [running, step, cycle]);

  const go = (i: number) => { setStep(i); setCycle((c) => c + 1); };

  return (
    <div className="mx" ref={root}>
      <div className={`mx-player s${step}${running ? '' : ' paused'}`} role="img" aria-label={`Animated demo of Mappingg, step ${step + 1} of 4: ${STEPS[step].title}`}>
        <div className="mx-bar">
          <span className="dots" aria-hidden="true"><i /><i /><i /></span>
          <span className="url"><i className="fas fa-lock" aria-hidden="true" /> mappingg.com/map</span>
          <span className="tag">Demo</span>
        </div>

        <div className="mx-stage" aria-hidden="true">
          {/* the map */}
          <svg className="mx-map" viewBox="0 0 400 225" preserveAspectRatio="xMidYMid slice">
            <rect width="400" height="225" fill="#f6f4ee" />
            <path d="M-10 150 C 60 120, 120 175, 190 150 S 320 110, 410 140" fill="none" stroke="#a9d0ef" strokeWidth="16" strokeLinecap="round" />
            <ellipse cx="70" cy="70" rx="42" ry="26" fill="#d6ebce" />
            <ellipse cx="330" cy="190" rx="50" ry="22" fill="#d6ebce" />
            <path d="M0 95 L400 70" stroke="#f3d48f" strokeWidth="9" />
            <path d="M150 0 L175 225" stroke="#ffffff" strokeWidth="7" />
            <path d="M270 0 L250 225" stroke="#ffffff" strokeWidth="7" />
            <path d="M0 190 L400 205" stroke="#ffffff" strokeWidth="6" />
            <path d="M40 0 L60 225" stroke="#ffffff" strokeWidth="4" />
            <path d="M340 0 L360 225" stroke="#ffffff" strokeWidth="4" />
            <path className="mx-metro" d="M0 40 C 120 60, 220 30, 400 55" fill="none" stroke="#7a5cc7" strokeWidth="3" strokeDasharray="8 6" />
          </svg>

          {PINS.map(([x, y, st, keep], i) => (
            <span key={i} className={`mx-pin${keep ? ' keep' : ''}${i === 1 ? ' hero' : ''}`} style={{ left: `${x}%`, top: `${y}%`, color: STATUS[st], ['--d' as string]: `${i * 110}ms` }}>
              <i className="fas fa-location-dot" />
            </span>
          ))}

          {/* step 1: status legend */}
          <div className="mx-legend">
            {['Available', 'Under construction', 'Upcoming', 'Sold'].map((l, i) => <span key={l}><i style={{ background: STATUS[i] }} />{l}</span>)}
          </div>

          {/* step 2: locality search */}
          <div className="mx-search">
            <div className="box"><i className="fas fa-magnifying-glass" /><span className="typed">Kharadi</span></div>
            <div className="sug"><span><i className="fas fa-location-dot" /> Kharadi, Pune</span><em>Locality</em></div>
          </div>

          {/* step 3: project card */}
          <div className="mx-card">
            <div className="ph"><i className="fas fa-building" /></div>
            <div className="bd">
              <b>Sample Residency</b>
              <small>Kharadi, Pune</small>
              <ul>
                <li><i className="fas fa-bed" /> 2 &amp; 3 BHK</li>
                <li><i className="fas fa-indian-rupee-sign" /> From ₹1.2 Cr</li>
                <li><i className="fas fa-calendar" /> Possession Dec 2028</li>
                <li className="ok"><i className="fas fa-circle-check" /> MahaRERA no. listed</li>
              </ul>
              <span className="btn-mini">View Full Details</span>
            </div>
          </div>

          {/* step 4: enquiry sent */}
          <div className="mx-toast">
            <span className="ic"><i className="fas fa-check" /></span>
            <div><b>Enquiry sent</b><small>The team will get back to you</small></div>
          </div>
          <span className="mx-cursor"><i className="fas fa-arrow-pointer" /></span>

          <div className="mx-caption" key={step}>
            <span>{step + 1}/4</span> {STEPS[step].title}
          </div>
        </div>

        <div className="mx-controls">
          <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause demo' : 'Play demo'}>
            <i className={`fas ${playing ? 'fa-pause' : 'fa-play'}`} aria-hidden="true" />
          </button>
          <div className="mx-progress">
            {STEPS.map((s, i) => (
              <button type="button" key={s.title} onClick={() => go(i)} aria-label={`Show step ${i + 1}: ${s.title}`} className={i < step ? 'done' : i === step ? 'now' : ''}>
                <span key={i === step ? cycle : undefined} style={{ animationDuration: `${STEP_MS}ms` }} />
              </button>
            ))}
          </div>
        </div>
      </div>

      <ol className="mx-steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className={i === step ? 'on' : ''}>
            <button type="button" onClick={() => go(i)}>
              <span className="ic"><i className={s.icon} aria-hidden="true" /></span>
              <span className="tx"><b><em>{String(i + 1).padStart(2, '0')}</em> {s.title}</b><small>{s.text}</small></span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

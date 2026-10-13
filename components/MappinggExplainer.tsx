'use client';

import { useEffect, useRef, useState } from 'react';

// "How Mappingg works" — a real screen recording of the live map (guest view):
// explore the pins → search Kharadi → open Riverdale Grand → the enquiry form
// (filled with sample details, never submitted), with zooms on each step and captions.
// File: public/video/how-mappingg-works-v1.mp4, recorded 13 Oct 2026. Chapter times match the captions.
// Plays muted and only while on screen; with prefers-reduced-motion it waits for a tap.
// Styles: .mx-* in app/info.css.

const SRC = '/video/how-mappingg-works-v1.mp4';
const POSTER = '/video/how-mappingg-works-v1.jpg';

const STEPS = [
  { at: 3.2, icon: 'fas fa-map-location-dot', title: 'Explore the live map', text: 'Every project is a pin on a real map of Pune and Mumbai, colour-coded as available, under construction, upcoming or sold.' },
  { at: 12.7, icon: 'fas fa-magnifying-glass-location', title: 'Search where you want to buy', text: 'Type a locality such as Kharadi or Thane, or tap Near Me, and the map takes you straight there.' },
  { at: 20.6, icon: 'fas fa-scale-balanced', title: 'Compare the details', text: 'Tap a pin for the price, configuration, carpet area, possession date, MahaRERA number and the project video.' },
  { at: 27.6, icon: 'fas fa-comments', title: 'Enquire in one tap', text: 'Share your name and WhatsApp number once, and the team gets back to you about the project you viewed.' },
];
const END = 38.0; // the closing card starts here

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function MappinggExplainer() {
  const video = useRef<HTMLVideoElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(41.5);
  const userPaused = useRef(false);

  // Autoplay (muted) only while the player is on screen, unless the visitor paused it
  // or prefers reduced motion.
  useEffect(() => {
    const v = video.current, el = root.current;
    if (!v || !el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !userPaused.current) v.play().catch(() => {});
      else if (!e.isIntersecting) v.pause();
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const step = STEPS.reduce((cur, s, i) => (t >= s.at - 0.05 ? i : cur), -1);
  const active = t >= END ? -1 : step;

  const toggle = () => {
    const v = video.current; if (!v) return;
    if (v.paused) { userPaused.current = false; v.play().catch(() => {}); }
    else { userPaused.current = true; v.pause(); }
  };
  const seek = (s: number) => {
    const v = video.current; if (!v) return;
    v.currentTime = s; setT(s);
    userPaused.current = false; v.play().catch(() => {});
  };
  const seekBar = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur);
  };
  const full = () => {
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!v) return;
    if (v.requestFullscreen) v.requestFullscreen().catch(() => {});
    else v.webkitEnterFullscreen?.(); // iOS Safari
  };

  return (
    <div className="mx" ref={root}>
      <div className={`mx-player${playing ? ' is-playing' : ''}`}>
        <div className="mx-bar">
          <span className="dots" aria-hidden="true"><i /><i /><i /></span>
          <span className="url"><i className="fas fa-lock" aria-hidden="true" /> mappingg.com/map</span>
          <span className="tag">Real demo</span>
        </div>

        <div className="mx-screen">
          <video
            ref={video} src={SRC} poster={POSTER} muted playsInline loop preload="metadata"
            aria-label="Screen recording: searching Kharadi on the Mappingg live map, opening a project and the enquiry form"
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 41.5)}
            onClick={toggle}
          />
          {!playing ? (
            <button type="button" className="mx-big-play" onClick={toggle} aria-label="Play the demo">
              <i className="fas fa-play" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <div className="mx-controls">
          <button type="button" onClick={toggle} aria-label={playing ? 'Pause demo' : 'Play demo'}>
            <i className={`fas ${playing ? 'fa-pause' : 'fa-play'}`} aria-hidden="true" />
          </button>
          <div className="mx-track" onClick={seekBar} role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(t)} tabIndex={-1}>
            <span className="fill" style={{ width: `${(t / dur) * 100}%` }} />
            {STEPS.map((s, i) => <span key={s.title} className="tick" style={{ left: `${(s.at / dur) * 100}%` }} title={`${i + 1}. ${s.title}`} />)}
          </div>
          <span className="time">{fmt(t)} / {fmt(dur)}</span>
          <button type="button" onClick={full} aria-label="Full screen"><i className="fas fa-expand" aria-hidden="true" /></button>
        </div>
      </div>

      <ol className="mx-steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className={i === active ? 'on' : ''}>
            <button type="button" onClick={() => seek(s.at)} aria-label={`Watch step ${i + 1}: ${s.title}`}>
              <span className="ic"><i className={s.icon} aria-hidden="true" /></span>
              <span className="tx">
                <b><em>{String(i + 1).padStart(2, '0')}</em> {s.title} <span className="at">{fmt(s.at)}</span></b>
                <small>{s.text}</small>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

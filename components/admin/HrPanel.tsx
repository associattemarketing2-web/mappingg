'use client';

import { useEffect, useRef, useState } from 'react';
import { PageHead } from './PageHead';
import { HR_ADMIN_NAV, HR_EMPLOYEE_NAV, hrActive, isHrPath } from '@/components/hr/nav';

// s-admin → Team & Administration → HR & Attendance. The HR module keeps its own
// pages (/dashboard/hr/…, they need their own styles and the selfie camera); they
// are shown in place below the usual page head, with the HR pages as sub-tabs in
// the super-admin's pill style. The page in view is kept in the URL (?hrp=) so a
// refresh stays on it.
export default function HrPanel({ isOwner }: { isOwner: boolean }) {
  const items = isOwner ? HR_ADMIN_NAV : HR_EMPLOYEE_NAV;
  const frame = useRef<HTMLIFrameElement>(null);
  const [src] = useState(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('hrp');
      if (isHrPath(p)) return p;
    } catch { /* ignore */ }
    return items[0].href;
  });
  const [path, setPath] = useState(src);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      if (e.data?.type !== 'hr:nav' || !isHrPath(e.data.path)) return;
      setPath(e.data.path);
      setLoaded(true);
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('hrp', e.data.path);
        window.history.replaceState(window.history.state, '', url);
      } catch { /* ignore */ }
    };
    window.addEventListener('message', onMsg);
    return () => {
      window.removeEventListener('message', onMsg);
      // Leaving the tab: the HR page is no longer in view.
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('hrp');
        window.history.replaceState(window.history.state, '', url);
      } catch { /* ignore */ }
    };
  }, []);

  const go = (href: string) => {
    setPath(href);
    // Same-page navigation inside the frame (fast); a reload if it is not ready yet.
    const w = frame.current?.contentWindow;
    if (w && loaded) w.postMessage({ type: 'hr:go', href }, window.location.origin);
    else if (frame.current) frame.current.src = href;
  };

  const active = hrActive(items, path.split('?')[0]);

  return (
    <div className="pg-wrap pg-hr">
      <PageHead
        icon="fa-user-clock"
        title={isOwner ? 'HR & Attendance' : 'My Attendance'}
        sub={isOwner ? 'Attendance with selfie check-in, tasks, leaves and salary of the team.' : 'Check in / out, your tasks, leaves and payslip.'}
      />
      <div className="adm-seg hr-seg" role="tablist" aria-label="HR pages">
        {items.map((i) => (
          <button key={i.href} type="button" role="tab" aria-selected={active === i.href} className={active === i.href ? 'on' : ''} onClick={() => go(i.href)}>
            <i className={`fas ${i.icon}`} /> {i.label}
          </button>
        ))}
      </div>
      <div className="hr-frame-wrap">
        {!loaded && <div className="hr-frame-loading"><i className="fas fa-spinner fa-spin" /> Loading…</div>}
        <iframe ref={frame} src={src} title="HR & Attendance" className="hr-frame" allow="camera; geolocation" onLoad={() => setLoaded(true)} />
      </div>
    </div>
  );
}

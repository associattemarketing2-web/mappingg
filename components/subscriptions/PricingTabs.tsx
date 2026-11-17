'use client';

import { useEffect, useState, type ReactNode } from 'react';

// Account-type switcher for /pricing. The panels are rendered on the server and
// all stay in the HTML (good for SEO); this only toggles which one is shown and
// keeps the URL hash in sync, so links like /pricing#cp open the right tab.
export default function PricingTabs({
  tabs,
  initial,
}: {
  tabs: { key: string; label: string; icon: string; panel: ReactNode }[];
  initial: string;
}) {
  const [active, setActive] = useState(initial);

  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1);
      if (tabs.some((t) => t.key === h)) setActive(h);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [tabs]);

  const pick = (key: string) => {
    setActive(key);
    history.replaceState(null, '', `#${key}`);
    // The tab bar is sticky: when switching from further down the page, jump back
    // to the top of the new plans instead of landing mid-table.
    requestAnimationFrame(() => {
      const panel = document.getElementById(key);
      if (panel && panel.getBoundingClientRect().top < 100) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <>
      <div className="pp-tabs" role="tablist" aria-label="Plans by account type">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`tab-${t.key}`}
            aria-controls={t.key}
            aria-selected={active === t.key}
            className={active === t.key ? 'on' : undefined}
            onClick={() => pick(t.key)}
          >
            <i className={t.icon} aria-hidden="true" /> {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <section key={t.key} id={t.key} role="tabpanel" aria-labelledby={`tab-${t.key}`} className="pp-panel" hidden={active !== t.key}>
          {t.panel}
        </section>
      ))}
    </>
  );
}

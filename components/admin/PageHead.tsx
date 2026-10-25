'use client';

import type { ReactNode } from 'react';

// Shared pieces of the super-admin page design: the page title card (icon,
// title, one-line description, main action) and the coloured stat cards.

export function PageHead({ icon, title, sub, children }: { icon: string; title: string; sub: string; children?: ReactNode }) {
  return (
    <header className="pg-head">
      <span className="pg-head-ic" aria-hidden="true"><i className={`fas ${icon}`} /></span>
      <div className="pg-head-t"><h2>{title}</h2><p>{sub}</p></div>
      {children && <div className="pg-head-acts">{children}</div>}
    </header>
  );
}

export type Tone = 'green' | 'blue' | 'amber' | 'violet' | 'rose' | 'teal';

/** A number card. With onClick it is a button (filters the list); `on` marks the active filter. */
export function StatCard({ icon, tone, value, label, on, onClick, title, disabled }: {
  icon: string; tone: Tone; value: ReactNode; label: string; on?: boolean; onClick?: () => void; title?: string; disabled?: boolean;
}) {
  const inner = (
    <>
      <span className="sc-ic" aria-hidden="true"><i className={icon.includes(' ') ? icon : `fas ${icon}`} /></span>
      <span className="sc-t"><b>{value}</b><small>{label}</small></span>
    </>
  );
  return onClick
    ? <button type="button" className={`sc ${tone}${on ? ' on' : ''}`} onClick={onClick} title={title} disabled={disabled}>{inner}</button>
    : <div className={`sc ${tone}`} title={title}>{inner}</div>;
}

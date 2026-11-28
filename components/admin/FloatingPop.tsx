'use client';

import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cssZoom } from './zoom';

// A dropdown panel drawn in its own top layer (a portal at the end of the panel's
// root, position: fixed, high z-index) and lined up under its button. Used by the
// notification bells so no page content — maps, sticky bars, cards with their own
// z-index — can ever show on top of the panel.
// Rendered inside `.adm2` when there is one, so the admin's colours and zoom still apply.

export default function FloatingPop({ anchor, popRef, className, label, children }: {
  /** The element the panel opens under (the bell's wrapper). */
  anchor: RefObject<HTMLElement>;
  /** Gets the panel element, so outside-click handlers can ignore clicks inside it. */
  popRef: RefObject<HTMLDivElement>;
  className: string;
  label: string;
  children: ReactNode;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ top: number; right?: number; left?: number } | null>(null);

  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a) return;
    const root = (a.closest('.adm2') as HTMLElement | null) || document.body;
    setHost(root);
    const place = () => {
      // Under the admin's CSS zoom, fixed offsets are CSS pixels that get zoomed.
      const z = root === document.body ? 1 : cssZoom(root);
      const r = a.getBoundingClientRect();
      const top = (r.bottom + 8) / z;
      if (window.innerWidth <= 560) setPos({ top, left: 12 / z, right: 12 / z });
      else setPos({ top, right: Math.max(8, window.innerWidth - r.right) / z });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor]);

  if (!host || !pos) return null;
  return createPortal(
    <div ref={popRef} className={`${className} nb-float`} role="dialog" aria-label={label} style={pos}>
      {children}
    </div>,
    host,
  );
}

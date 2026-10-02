'use client';

import { useEffect } from 'react';

const FA_HREF = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';

// Loads the Font Awesome icon stylesheet without blocking the first paint: text
// and layout render immediately and icons appear a moment later (icon boxes have
// fixed sizes, so nothing shifts). The tag is added to <head> once and kept, so
// client-side navigation between pages never re-requests or re-parses it.
export default function IconFont() {
  useEffect(() => {
    if (document.querySelector(`link[href="${FA_HREF}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FA_HREF;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }, []);

  return null;
}

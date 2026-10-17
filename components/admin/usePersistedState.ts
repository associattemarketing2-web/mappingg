'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * useState that survives a page refresh in this browser tab (sessionStorage) —
 * for "where am I" state such as a panel's sub-tab or filter, so a reload
 * reopens the same view. Restored after mount (the server render uses
 * `initial`), and only to one of `allowed` when given. Storage errors
 * (private mode, blocked site data) just fall back to normal state.
 */
export function usePersistedState<T extends string | number>(key: string, initial: T, allowed?: readonly T[]) {
  const [value, setValue] = useState<T>(initial);
  const restored = useRef(false);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`mg_admin:${key}`);
      if (raw != null) {
        const v = JSON.parse(raw) as T;
        if (!allowed || allowed.includes(v)) setValue(v);
      }
    } catch { /* storage unavailable */ }
    restored.current = true;
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!restored.current) return;
    try { sessionStorage.setItem(`mg_admin:${key}`, JSON.stringify(value)); } catch { /* storage unavailable */ }
  }, [key, value]);
  return [value, setValue] as const;
}

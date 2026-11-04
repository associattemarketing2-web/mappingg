'use client';

import { useEffect } from 'react';
import { track } from '@/lib/analytics';

/** Sends one analytics event when the page is shown (e.g. a project page view). */
export default function TrackOnView({ event, params }: { event: string; params?: Record<string, string | number> }) {
  const key = JSON.stringify(params || {});
  useEffect(() => {
    track(event, params);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per event + params
  }, [event, key]);
  return null;
}

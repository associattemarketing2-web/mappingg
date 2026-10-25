import { cache } from 'react';
import { getDb } from './mongodb';
import { cachedRead } from './data-cache';

export interface PublicSettings {
  gtm_container_id?: string;
  search_console_verification?: string;
  ga_measurement_id?: string;
  youtube_video_url?: string;
}

// The site's own Google IDs. Used whenever the admin Settings field is empty,
// so the rendered <head>, the health checks and the dashboard always agree.
export const DEFAULT_GSC_VERIFICATION = 'xjmisC7LNZagrEObXyZOZoVzRQW2g72BbVjGuaBXsL8';
export const DEFAULT_GTM_ID = 'GTM-59Q6QBP6';
export const DEFAULT_GA_ID = 'G-PWBF18X96P';

export const GTM_RE = /^GTM-[A-Z0-9]{1,20}$/i;
export const GSC_RE = /^[A-Za-z0-9_-]{1,200}$/;
export const GA_RE = /^G-[A-Z0-9]{4,20}$/i;

// The settings row is read by the root layout on every render, so it is kept in
// the shared data cache (lib/data-cache.ts); saving Settings clears it at once.
const readSettingsRow = cachedRead('site-settings', ['map_settings'], 3600, async () => {
  const db = await getDb();
  return (await db.collection('map_settings').findOne(
    { id: 1 },
    { projection: { gtm_container_id: 1, search_console_verification: 1, ga_measurement_id: 1, youtube_video_url: 1 } },
  )) as Record<string, unknown> | null;
});

// Reads the single site-settings row. Wrapped in React.cache so it runs at most
// once per request, and never throws (a DB blip must not break rendering).
export const getPublicSettings = cache(async (): Promise<PublicSettings> => {
  let row: Record<string, unknown> | null = null;
  try {
    row = await readSettingsRow();
  } catch {
    row = null;
  }
  const gtm = String(row?.gtm_container_id || '').trim();
  const gsc = String(row?.search_console_verification || '').trim();
  const ga = String(row?.ga_measurement_id || '').trim();
  return {
    // All are rendered into <head> (GTM/GA inside inline scripts), so anything
    // that isn't a well-formed ID is dropped in favour of the site default.
    gtm_container_id: GTM_RE.test(gtm) ? gtm : DEFAULT_GTM_ID,
    search_console_verification: GSC_RE.test(gsc) ? gsc : DEFAULT_GSC_VERIFICATION,
    ga_measurement_id: GA_RE.test(ga) ? ga : DEFAULT_GA_ID,
    youtube_video_url: (row?.youtube_video_url as string) || '',
  };
});

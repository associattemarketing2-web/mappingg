import { cache } from 'react';
import { getDb } from './mongodb';

export interface PublicSettings {
  gtm_container_id?: string;
  search_console_verification?: string;
  youtube_video_url?: string;
}

// Reads the single site-settings row. Wrapped in React.cache so it runs at most
// once per request, and never throws (a DB blip must not break rendering).
export const getPublicSettings = cache(async (): Promise<PublicSettings> => {
  try {
    const db = await getDb();
    const row = await db.collection('map_settings').findOne(
      { id: 1 },
      { projection: { gtm_container_id: 1, search_console_verification: 1, youtube_video_url: 1 } },
    );
    if (!row) return {};
    const gtm = String(row.gtm_container_id || '').trim();
    const gsc = String(row.search_console_verification || '').trim();
    return {
      // Both are rendered into <head> (GTM inside an inline script), so anything
      // that isn't a well-formed ID is dropped rather than trusted.
      gtm_container_id: /^GTM-[A-Z0-9]{1,20}$/i.test(gtm) ? gtm : '',
      search_console_verification: /^[A-Za-z0-9_-]{1,200}$/.test(gsc) ? gsc : '',
      youtube_video_url: (row.youtube_video_url as string) || '',
    };
  } catch {
    return {};
  }
});

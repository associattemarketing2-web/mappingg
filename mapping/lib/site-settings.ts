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
    const row = await db.collection('map_settings').findOne({ id: 1 });
    if (!row) return {};
    return {
      gtm_container_id: (row.gtm_container_id as string) || '',
      search_console_verification: (row.search_console_verification as string) || '',
      youtube_video_url: (row.youtube_video_url as string) || '',
    };
  } catch {
    return {};
  }
});

import { runDbOp } from './db-engine';

export interface SeoProject {
  id: string;
  number?: number;
  title?: string;
  location?: string;
  status?: string;
  type?: string;
  developer?: string;
}

// Server-side fetch of lightweight project info for crawlable SEO content.
// Uses the cached DB engine directly (no HTTP hop) and never throws, so a build
// or a transient DB outage can never break the page.
export async function getSeoProjects(): Promise<SeoProject[]> {
  try {
    const res = await runDbOp(
      {
        table: 'pins',
        action: 'select',
        columns: 'id,number,title,location,status,type,developer',
        order: { col: 'number', ascending: true },
      },
      false,
    );
    if (res.error || !Array.isArray(res.data)) return [];
    return res.data as SeoProject[];
  } catch {
    return [];
  }
}

// Areas covered — used for keywords and crawlable copy (from the site's own
// llms.txt description).
export const AREAS_PUNE = [
  'Mundhwa', 'Kharadi', 'Magarpatta', 'Hadapsar', 'Viman Nagar', 'Wagholi', 'Kothrud',
];
export const AREAS_MMR = [
  'Andheri West', 'Khar West', 'Vashi', 'Nerul', 'Kharghar', 'Airoli', 'Juinagar',
  'Thane', 'Dombivli', 'Kalyan Shil Road', 'Palava',
];

export function statusLabel(status?: string): string {
  switch ((status || '').toLowerCase()) {
    case 'available': return 'Available';
    case 'under_construction': return 'Under Construction';
    case 'upcoming': return 'Upcoming';
    case 'sold': return 'Sold';
    default: return status || '';
  }
}

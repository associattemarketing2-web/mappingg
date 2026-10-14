import { enquiries } from '@/lib/api-platform/endpoints';

// Mappingg Developer API — partner websites send enquiries into the CRM (scope enquiries:submit).
// POST only; server-to-server (no CORS headers). See lib/api-platform/enquiries.ts.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = enquiries;

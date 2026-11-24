// Same webhook with the secret in the path: /api/whatsapp/webhook/<WHATSAPP_WEBHOOK_SECRET>
// (for provider panels that reject or mangle a URL containing "?token=…").
import { GET, POST, PUT, PATCH, DELETE } from '../route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export { GET, POST, PUT, PATCH, DELETE };

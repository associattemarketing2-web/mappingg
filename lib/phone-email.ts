import { splitPhone } from './phone';

// Accounts created with just a WhatsApp number + code ("Create account with
// WhatsApp OTP") have no email yet. Every account needs a unique email (it's the
// sign-in key and has a unique index), so they get a stand-in on a reserved
// `.invalid` domain — it can never receive mail. It's replaced when the buyer
// adds their real email (the live map asks; PATCH /api/my/profile) and is never
// shown to anyone: use visibleEmail() wherever an account's email is displayed.
const DOMAIN = 'phone.mappingg.invalid';

export function placeholderEmail(mobile: string): string {
  const { code, number } = splitPhone(mobile);
  return `${code.replace(/\D/g, '')}${number}@${DOMAIN}`.toLowerCase();
}

export const isPlaceholderEmail = (email: unknown): boolean =>
  typeof email === 'string' && email.toLowerCase().endsWith(`@${DOMAIN}`);

/** The email to show: '' for a stand-in. */
export const visibleEmail = (email: unknown): string => (isPlaceholderEmail(email) ? '' : String(email || ''));

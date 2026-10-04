// Official Mappingg contact details and social accounts — the one place to
// change them. Used by the company/legal pages, the home page footer and the
// site's structured data (JSON-LD). The legacy map bundles
// (public/legacy/*.json) and public/partners/config.js carry their own copies
// of the email and WhatsApp number, so update those too if these change.

export const EMAIL = 'mappingg.associatte@gmail.com';

/** WhatsApp number in international format, digits only (for wa.me links). */
export const WHATSAPP_NUMBER = '918228828200';
export const WHATSAPP_DISPLAY = '+91 82288 28200';
export const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}`;

export const SOCIALS = [
  { name: 'Instagram', icon: 'fab fa-instagram', href: 'https://www.instagram.com/mappingg.associatte/' },
  { name: 'LinkedIn', icon: 'fab fa-linkedin-in', href: 'https://www.linkedin.com/company/mappingg-com/' },
  { name: 'YouTube', icon: 'fab fa-youtube', href: 'https://www.youtube.com/@mappingg-official' },
  { name: 'Facebook', icon: 'fab fa-facebook-f', href: 'https://www.facebook.com/share/1CH5PwZUsM/?mibextid=wwXIfr' },
] as const;

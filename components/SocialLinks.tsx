import { EMAIL, SOCIALS, WHATSAPP_URL } from '@/lib/contact';

// Round icon links to Mappingg's official accounts. Icons are inline SVG (no
// icon font needed), so this works on every page — the header, blog, info pages.
// Styles live in app/globals.css (.mg-socials).

const ICONS: Record<string, JSX.Element> = {
  Instagram: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  LinkedIn: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.5h4V21H3zM9.5 9.5h3.8v1.6h.1c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-5.2c0-1.24-.02-2.84-1.73-2.84-1.73 0-2 1.35-2 2.75V21h-4z" />
    </svg>
  ),
  YouTube: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M22.5 7.2a2.9 2.9 0 0 0-2-2C18.7 4.7 12 4.7 12 4.7s-6.7 0-8.5.5a2.9 2.9 0 0 0-2 2A30 30 0 0 0 1 12a30 30 0 0 0 .5 4.8 2.9 2.9 0 0 0 2 2c1.8.5 8.5.5 8.5.5s6.7 0 8.5-.5a2.9 2.9 0 0 0 2-2A30 30 0 0 0 23 12a30 30 0 0 0-.5-4.8zM9.8 15.1V8.9l5.4 3.1z" />
    </svg>
  ),
  Facebook: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.5 21.5v-7.7h2.6l.4-3h-3V8.9c0-.87.25-1.46 1.5-1.46h1.6V4.75a21 21 0 0 0-2.33-.12c-2.3 0-3.88 1.4-3.88 3.98v2.19H7.8v3h2.6v7.7z" />
    </svg>
  ),
  WhatsApp: (
    <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
      <path d="M16.02 3C9.4 3 4 8.38 4 15c0 2.29.64 4.44 1.75 6.28L4 29l7.94-1.7A11.94 11.94 0 0 0 16.02 27C22.65 27 28 21.63 28 15S22.65 3 16.02 3zm0 21.7c-1.95 0-3.77-.55-5.32-1.5l-.38-.23-4.71 1.01 1-4.6-.25-.4A9.63 9.63 0 0 1 6.3 15c0-5.36 4.36-9.7 9.72-9.7 5.36 0 9.72 4.34 9.72 9.7 0 5.36-4.36 9.7-9.72 9.7zm5.34-7.27c-.29-.15-1.73-.86-2-.95-.27-.1-.46-.15-.66.15-.2.29-.76.95-.93 1.15-.17.19-.34.22-.63.07-.29-.15-1.2-.44-2.29-1.41-.85-.75-1.42-1.68-1.59-1.97-.17-.29-.02-.45.13-.6.13-.13.29-.34.44-.51.15-.17.19-.29.29-.49.1-.19.05-.36-.02-.51-.07-.15-.66-1.6-.9-2.19-.24-.57-.48-.5-.66-.5-.17-.01-.36-.01-.56-.01-.19 0-.51.07-.78.36-.27.29-1.02 1-1.02 2.43 0 1.43 1.05 2.82 1.19 3.01.15.19 2.06 3.15 5 4.42.7.3 1.24.48 1.67.62.7.22 1.34.19 1.84.12.56-.08 1.73-.71 1.98-1.39.24-.68.24-1.27.17-1.39-.07-.12-.26-.19-.55-.34z" />
    </svg>
  ),
  Email: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" />
    </svg>
  ),
};

export default function SocialLinks({ email = false, className = '' }: { email?: boolean; className?: string }) {
  const links = [
    ...SOCIALS.map((s) => ({ name: s.name, href: s.href })),
    { name: 'WhatsApp', href: WHATSAPP_URL },
    ...(email ? [{ name: 'Email', href: `mailto:${EMAIL}` }] : []),
  ];
  return (
    <div className={`mg-socials${className ? ` ${className}` : ''}`}>
      {links.map((l) => (
        <a
          key={l.name}
          href={l.href}
          aria-label={l.name}
          title={l.name}
          {...(l.href.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {})}
        >
          {ICONS[l.name]}
        </a>
      ))}
    </div>
  );
}

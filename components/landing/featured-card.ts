import type { FeaturedProject } from '@/lib/featured-project';

// Real-project version of the "Make every property easy to understand" card
// (replaces the sample card between the <!--PV_CARD--> markers in body.ts). Same markup and
// look as the public map's project card, but display-only: nothing on it is
// clickable. The video autoplays muted when scrolled into view (see landing.js).

const ENQUIRE_ART = '<svg viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="29" fill="#2f3b93"/><text x="30" y="29" text-anchor="middle" font-family="Arial Narrow,Arial,Helvetica,sans-serif" font-weight="800" font-size="11" fill="#fff" textLength="44" lengthAdjust="spacingAndGlyphs">ENQUIRE</text><text x="30" y="42" text-anchor="middle" font-family="Arial Narrow,Arial,Helvetica,sans-serif" font-weight="800" font-size="12.5" fill="#fff" textLength="26" lengthAdjust="spacingAndGlyphs">NOW</text><g transform="translate(39 3) rotate(12)"><rect width="17" height="12" rx="1.5" fill="#e9b85c" stroke="#fff" stroke-width="1.2"/><path d="M1 1.2 L8.5 7 L16 1.2" fill="none" stroke="#8a5a14" stroke-width="1.1" stroke-linejoin="round"/></g></svg>';
const WHATSAPP_ICON = '<svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M16.02 3C9.4 3 4 8.38 4 15c0 2.29.64 4.44 1.75 6.28L4 29l7.94-1.7A11.94 11.94 0 0 0 16.02 27C22.65 27 28 21.63 28 15S22.65 3 16.02 3zm0 21.7c-1.95 0-3.77-.55-5.32-1.5l-.38-.23-4.71 1.01 1-4.6-.25-.4A9.63 9.63 0 0 1 6.3 15c0-5.36 4.36-9.7 9.72-9.7 5.36 0 9.72 4.34 9.72 9.7 0 5.36-4.36 9.7-9.72 9.7zm5.34-7.27c-.29-.15-1.73-.86-2-.95-.27-.1-.46-.15-.66.15-.2.29-.76.95-.93 1.15-.17.19-.34.22-.63.07-.29-.15-1.2-.44-2.29-1.41-.85-.75-1.42-1.68-1.59-1.97-.17-.29-.02-.45.13-.6.13-.13.29-.34.44-.51.15-.17.19-.29.29-.49.1-.19.05-.36-.02-.51-.07-.15-.66-1.6-.9-2.19-.24-.57-.48-.5-.66-.5-.17-.01-.36-.01-.56-.01-.19 0-.51.07-.78.36-.27.29-1.02 1-1.02 2.43 0 1.43 1.05 2.82 1.19 3.01.15.19 2.06 3.15 5 4.42.7.3 1.24.48 1.67.62.7.22 1.34.19 1.84.12.56-.08 1.73-.71 1.98-1.39.24-.68.24-1.27.17-1.39-.07-.12-.26-.19-.55-.34z"/></svg>';

const STATUS_COLOR: Record<string, string> = {
  available: '#3f8f6b', sold: '#b5484c', construction: '#c98a2c', upcoming: '#3b6ea5',
};

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function featuredCardHtml(p: FeaturedProject): string {
  const meta = (v?: string, cls = '') => (v ? `<div class="pv-meta${cls}">${esc(v)}</div>` : '');
  const pills = [
    p.status ? `<span class="pv-status" style="background:${STATUS_COLOR[p.statusKey] || STATUS_COLOR.available}">${esc(p.status)}</span>` : '',
    p.type ? `<span class="pv-type">${esc(p.type)}</span>` : '',
  ].join('');
  const details = [meta(p.rera, ' pv-rera'), meta(p.configuration), meta(p.price), meta(p.possession), meta(p.keyUsp)].join('');
  const vid = encodeURIComponent(p.videoId);

  return `<div class="pv-card" aria-label="${esc(p.title)} — project card, as shown on the map">
            <span class="pv-close" aria-hidden="true">×</span>
            <div class="pv-top${p.logo ? '' : ' no-logo'}">
              ${p.logo ? `<div class="pv-logo"><img src="${esc(p.logo)}" alt="${esc(p.title)} logo" decoding="async"></div>` : ''}
              <div class="pv-head">
                <p class="pv-title">${esc(p.title)}</p>
                ${meta(p.developer)}${meta(p.location)}
                ${pills ? `<div>${pills}</div>` : ''}
              </div>
            </div>
            <div class="pv-body">
              ${details ? `<div class="pv-details">${details}</div>` : ''}
              <div class="pv-label">Project video</div>
              <div class="pv-media pv-yt" data-yt="${vid}" aria-label="${esc(p.title)} video"
                style="background-image:url('https://i.ytimg.com/vi/${vid}/hqdefault.jpg')"><span class="pv-play"><i class="fas fa-play"></i></span></div>
            </div>
            <div class="pv-actions" aria-hidden="true">
              <span class="pv-enq">${ENQUIRE_ART}</span>
              <span class="pv-wa">${WHATSAPP_ICON}</span>
              <span class="pv-share">🔗</span>
            </div>
          </div>
`;
}

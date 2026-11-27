// How a shared file is shown on the public share page (/s/<code>/<token>):
// Google Drive / Docs links become their embeddable preview, PDFs open in a
// viewer, images show as images, videos play inline. Pure helpers (no I/O).

export interface Embed {
  /** iframe = an embedded viewer, img = picture, video = <video>, none = only buttons. */
  type: 'iframe' | 'img' | 'video' | 'none';
  src: string;
  /** Opens the file full screen (new tab). */
  open: string;
  /** Direct download, when there is one. */
  download: string;
}

/** Google Drive / Docs file id + kind, or null for any other link. */
export function googleFile(url: string): { id: string; kind: 'file' | 'doc' | 'sheet' | 'slides' | 'folder' } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'docs.google.com') {
    const m = /^\/(document|spreadsheets|presentation)\/d\/([\w-]{10,})/.exec(u.pathname);
    if (m) return { id: m[2], kind: m[1] === 'document' ? 'doc' : m[1] === 'spreadsheets' ? 'sheet' : 'slides' };
    const f = /^\/file\/d\/([\w-]{10,})/.exec(u.pathname);
    if (f) return { id: f[1], kind: 'file' };
    return null;
  }
  if (host !== 'drive.google.com') return null;
  const file = /\/file\/d\/([\w-]{10,})/.exec(u.pathname);
  if (file) return { id: file[1], kind: 'file' };
  const folder = /\/folders\/([\w-]{10,})/.exec(u.pathname);
  if (folder) return { id: folder[1], kind: 'folder' };
  const id = u.searchParams.get('id');
  if (id && /^[\w-]{10,}$/.test(id)) return { id, kind: 'file' };
  return null;
}

export const isGoogleLink = (url: string) => googleFile(url) !== null;
const isPdf = (url: string) => /\.pdf(\?|#|$)/i.test(url) || /[?&]path=[^&]*\.pdf/i.test(url) || /%2[Ff][^&?#]*\.pdf/i.test(url);
export const isImageUrl = (url: string) =>
  /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(url) || url.startsWith('/media/') || /[?&]f=(image|brochure_image)\b/.test(url) || /\/api\/media\/pins\//.test(url);
const isVideoFile = (url: string) => /\.(mp4|webm|3gp|mov)(\?|#|$)/i.test(url);
export const youtubeId = (u: string) => /(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/.exec(u)?.[1] || '';

/**
 * The embed for one shared file. `site` = the absolute site origin (PDF viewers need a
 * public absolute address). `hint` = the item kind, so a "video" or "photo" link is shown as one.
 */
export function embedFor(url: string, site: string, hint?: string): Embed {
  const abs = url.startsWith('/') ? `${site}${url}` : url;
  const g = googleFile(url);
  if (g) {
    if (g.kind === 'folder') {
      return { type: 'iframe', src: `https://drive.google.com/embeddedfolderview?id=${g.id}#grid`, open: `https://drive.google.com/drive/folders/${g.id}`, download: '' };
    }
    if (g.kind !== 'file') {
      const path = g.kind === 'doc' ? 'document' : g.kind === 'sheet' ? 'spreadsheets' : 'presentation';
      return {
        type: 'iframe', src: `https://docs.google.com/${path}/d/${g.id}/preview`, open: `https://docs.google.com/${path}/d/${g.id}/view`,
        download: g.kind === 'doc' ? `https://docs.google.com/document/d/${g.id}/export?format=pdf` : g.kind === 'slides' ? `https://docs.google.com/presentation/d/${g.id}/export/pdf` : '',
      };
    }
    // A Drive photo shows as a picture; everything else (PDF, video, …) in Drive's own viewer.
    if (hint === 'photo') return { type: 'img', src: `https://drive.google.com/thumbnail?id=${g.id}&sz=w1600`, open: `https://drive.google.com/file/d/${g.id}/view`, download: `https://drive.google.com/uc?export=download&id=${g.id}` };
    return { type: 'iframe', src: `https://drive.google.com/file/d/${g.id}/preview`, open: `https://drive.google.com/file/d/${g.id}/view`, download: `https://drive.google.com/uc?export=download&id=${g.id}` };
  }
  const yt = youtubeId(url);
  if (yt) return { type: 'iframe', src: `https://www.youtube-nocookie.com/embed/${yt}`, open: `https://youtu.be/${yt}`, download: '' };
  if (isImageUrl(url) || hint === 'photo') return { type: 'img', src: url, open: url, download: url };
  if (isVideoFile(url) || (hint === 'video' && /\/api\/wa-media\//.test(url))) return { type: 'video', src: url, open: url, download: url };
  // PDFs: Google's viewer renders them on every phone (mobile browsers can't show a PDF inside a page).
  if (isPdf(url) || /\/api\/wa-media\/.*\.pdf/i.test(url)) {
    return { type: 'iframe', src: `https://docs.google.com/viewer?embedded=true&url=${encodeURIComponent(abs)}`, open: url, download: url };
  }
  return { type: 'none', src: '', open: url, download: url };
}

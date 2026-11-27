import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getShareByCode, siteUrl, type ShareItem } from '@/lib/wa-share';
import { embedFor, isGoogleLink, isImageUrl } from '@/lib/share-embed';
import { WHATSAPP_NUMBER } from '@/lib/contact';
import ShareTracker from './ShareTracker';
import './share.css';

// Public page behind a project share link sent on WhatsApp (s-admin → WhatsApp →
// Bulk send → Share a project): /s/<code> or /s/<code>/<token>, where the token
// identifies the number it was sent to. Shows only what the team picked —
// project details, photos, brochures (shown inline: Google Drive preview, PDF
// viewer or image), floor plans, videos, files. Never indexed.
export const dynamic = 'force-dynamic';

type Props = { params: { slug: string[] } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const s = await getShareByCode(params.slug?.[0] || '').catch(() => null);
  const title = s ? `${s.title}${s.project?.location ? ` — ${s.project.location}` : ''}` : 'Mappingg';
  const photo = s?.items.find((i) => i.kind === 'photo' && !isGoogleLink(i.url))?.url;
  const desc = s ? [s.project?.configuration, s.project?.price, s.project?.developer && `by ${s.project.developer}`].filter(Boolean).join(' · ') || 'Project details, photos and brochure' : '';
  return {
    title, description: desc, robots: { index: false, follow: false },
    openGraph: { title, description: desc, ...(photo ? { images: [{ url: photo }] } : {}) },
  };
}

const LABEL: Record<ShareItem['kind'], string> = {
  photo: 'Photo', brochure: 'Brochure', floor_plan: 'Floor plan', payment_plan: 'Payment plan', video: 'Video', file: 'File',
};
const ICON: Record<ShareItem['kind'], string> = { photo: '🖼️', brochure: '📘', floor_plan: '📐', payment_plan: '💳', video: '🎬', file: '📄' };
const STATUS: Record<string, string> = { upcoming: 'Upcoming', construction: 'Under construction', under_construction: 'Under construction', available: 'Ready to move' };

export default async function SharePage({ params }: Props) {
  const [code, token = ''] = params.slug || [];
  if (!code || params.slug.length > 2) notFound();
  const s = await getShareByCode(code).catch(() => null);
  if (!s) notFound();
  const p = s.project;
  const site = siteUrl();
  // Photos as a gallery (a Google Drive photo link becomes its thumbnail image).
  const photos = s.items
    .filter((i) => i.kind === 'photo' || (i.kind === 'file' && isImageUrl(i.url) && !isGoogleLink(i.url)))
    .map((i) => ({ ...i, show: embedFor(i.url, site, 'photo') }));
  const videos = s.items.filter((i) => i.kind === 'video').map((i) => ({ ...i, show: embedFor(i.url, site, 'video') }));
  // Brochures, plans and other files: each with an inline preview (Drive / PDF viewer / image) + open & download.
  const files = s.items
    .filter((i) => !photos.some((ph) => ph.id === i.id) && i.kind !== 'video')
    .map((i) => ({ ...i, show: embedFor(i.url, site, i.kind) }));
  const facts = p && s.show_details ? ([
    ['Configuration', p.configuration], ['Price', p.price], ['Area', p.sqft], ['Possession', p.possession],
    ['Status', p.status ? STATUS[p.status.toLowerCase()] || p.status : ''], ['Type', p.type], ['Developer', p.developer], ['RERA', p.rera],
  ].filter(([, v]) => v) as [string, string][]) : [];
  const waText = `Hi, I saw ${s.title}${p?.location ? ` (${p.location})` : ''} on Mappingg and I'm interested. Please share more details.`;

  return (
    <main className="shr">
      <ShareTracker code={code} token={token} />
      <header className="shr-head">
        <a href="/" className="shr-brand">Mappingg</a>
        <span>Shared with you</span>
      </header>

      <section className="shr-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {p?.logo && <img className="shr-logo" src={p.logo} alt="" width={64} height={64} />}
        <div>
          <h1>{s.title}</h1>
          {p?.location && <p className="shr-loc">📍 {p.location}</p>}
          {p?.developer && <p className="shr-dev">by {p.developer}</p>}
        </div>
      </section>

      {s.note && <p className="shr-note">{s.note}</p>}

      {facts.length > 0 && (
        <section className="shr-card">
          <h2>Project details</h2>
          <dl className="shr-facts">
            {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          {p?.usp && <p className="shr-usp">{p.usp}</p>}
        </section>
      )}

      {photos.length > 0 && (
        <section className="shr-card">
          <h2>Photos <small>({photos.length})</small></h2>
          <div className="shr-gallery">
            {photos.map((ph, i) => (
              <a key={ph.id} href={ph.show.open} target="_blank" rel="noopener" data-track={ph.id} className={i === 0 ? 'big' : ''}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ph.show.src} alt={`${s.title} — ${ph.name}`} loading={i < 3 ? 'eager' : 'lazy'} referrerPolicy="no-referrer" />
              </a>
            ))}
          </div>
        </section>
      )}

      {files.length > 0 && (
        <section className="shr-card">
          <h2>Brochure &amp; documents <small>({files.length})</small></h2>
          <div className="shr-docs">
            {files.map((f, i) => (
              <details key={f.id} className="shr-doc" open={i === 0}>
                <summary data-track={f.id}>
                  <span className="ic" aria-hidden>{ICON[f.kind]}</span>
                  <span className="tx"><b>{f.name || LABEL[f.kind]}</b><small>{LABEL[f.kind]}{f.show.type !== 'none' ? ' · tap to show / hide' : ''}</small></span>
                </summary>
                {f.show.type === 'iframe' && (
                  <div className="shr-frame"><iframe src={f.show.src} title={f.name || LABEL[f.kind]} loading={i === 0 ? 'eager' : 'lazy'} allow="autoplay; fullscreen" allowFullScreen /></div>
                )}
                {f.show.type === 'img' && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="shr-doc-img" src={f.show.src} alt={f.name || LABEL[f.kind]} loading="lazy" referrerPolicy="no-referrer" />
                )}
                {f.show.type === 'video' && <video className="shr-video-file" src={f.show.src} controls preload="metadata" playsInline />}
                <div className="shr-doc-acts">
                  <a href={f.show.open} target="_blank" rel="noopener" data-track={f.id}>⤢ Open full screen</a>
                  {f.show.download && <a href={f.show.download} target="_blank" rel="noopener" download data-track={f.id}>↓ Download</a>}
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      {videos.length > 0 && (
        <section className="shr-card">
          <h2>Video</h2>
          {videos.map((v) => (
            <div key={v.id} className="shr-vid">
              {v.show.type === 'iframe' ? (
                <div className="shr-video"><iframe src={v.show.src} title={v.name} loading="lazy" allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /></div>
              ) : v.show.type === 'video' || v.show.type === 'img' ? (
                <video className="shr-video-file" src={v.show.src} controls preload="metadata" playsInline />
              ) : null}
              <div className="shr-doc-acts"><a href={v.show.open} target="_blank" rel="noopener" data-track={v.id}>▶ {v.name || 'Open video'}</a></div>
            </div>
          ))}
        </section>
      )}

      <div className="shr-cta">
        <a className="wa" href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(waText)}`} target="_blank" rel="noopener" data-track="whatsapp">💬 Chat on WhatsApp</a>
        {p?.page && <a className="more" href={p.page} data-track="project_page">View full project page</a>}
      </div>
      <footer className="shr-foot">Shared by <a href="/">Mappingg</a> — live map of real-estate projects.</footer>
    </main>
  );
}

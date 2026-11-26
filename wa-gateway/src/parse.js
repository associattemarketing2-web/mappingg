import { getContentType, normalizeMessageContent } from '@whiskeysockets/baileys';

// Turns a WhatsApp message into what the inbox stores: kind, text, file info.
// Returns null for things that are not chat messages (receipts, key
// exchanges, reactions, deletes…).

const SKIP = new Set(['protocolMessage', 'senderKeyDistributionMessage', 'reactionMessage', 'messageContextInfo', 'keepInChatMessage', 'pollUpdateMessage', 'encReactionMessage']);

export const MEDIA_KINDS = new Set(['image', 'video', 'audio', 'document', 'sticker']);

export function parseMessage(message) {
  const c = normalizeMessageContent(message);
  if (!c) return null;
  const type = getContentType(c);
  if (!type || SKIP.has(type)) return null;
  const m = c[type] || {};
  const file = (kind, extra = {}) => ({
    kind,
    body: String(m.caption || '').trim(),
    media: {
      mimetype: String(m.mimetype || ''),
      size: Number(m.fileLength || 0) || 0,
      ...(m.fileName ? { filename: String(m.fileName) } : {}),
      ...(m.seconds ? { seconds: Number(m.seconds) } : {}),
      ...extra,
    },
  });
  switch (type) {
    case 'conversation': return { kind: 'text', body: String(c.conversation || '') };
    case 'extendedTextMessage': return { kind: 'text', body: String(m.text || '') };
    case 'imageMessage': return file('image');
    case 'videoMessage': return file('video', m.gifPlayback ? { gif: true } : {});
    case 'audioMessage': return file('audio', m.ptt ? { voice: true } : {});
    case 'documentMessage': return { ...file('document'), body: String(m.caption || '').trim() };
    case 'stickerMessage': return file('sticker');
    case 'locationMessage':
    case 'liveLocationMessage':
      return { kind: 'location', body: [m.name, m.address].filter(Boolean).join(', '), media: { lat: m.degreesLatitude, lng: m.degreesLongitude } };
    case 'contactMessage': return { kind: 'contact', body: String(m.displayName || 'Contact') };
    case 'contactsArrayMessage': return { kind: 'contact', body: (m.contacts || []).map((x) => x.displayName).filter(Boolean).join(', ') || 'Contacts' };
    case 'pollCreationMessage':
    case 'pollCreationMessageV2':
    case 'pollCreationMessageV3':
      return { kind: 'poll', body: String(m.name || 'Poll') };
    case 'buttonsResponseMessage': return { kind: 'text', body: String(m.selectedDisplayText || '') };
    case 'listResponseMessage': return { kind: 'text', body: String(m.title || '') };
    case 'templateButtonReplyMessage': return { kind: 'text', body: String(m.selectedDisplayText || '') };
    case 'buttonsMessage': return { kind: 'text', body: String(m.contentText || '') };
    case 'templateMessage': return { kind: 'text', body: String(m.hydratedTemplate?.hydratedContentText || m.hydratedFourRowTemplate?.hydratedContentText || '') };
    case 'interactiveMessage': return { kind: 'text', body: String(m.body?.text || '') };
    default: return { kind: 'other', body: `[${type.replace(/Message$/, '')}]` };
  }
}

/** Short line for the chat list. */
export function preview(p) {
  const label = { image: '📷 Photo', video: '🎥 Video', audio: '🎤 Audio', document: '📄 Document', sticker: 'Sticker', location: '📍 Location', contact: '👤 Contact', poll: '📊 Poll' }[p.kind];
  const text = (p.kind === 'document' && p.media?.filename) ? `📄 ${p.media.filename}` : label;
  return [text, p.body].filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 160);
}

/** WhatsApp ack number → our status word (only for messages we sent). */
export function ackStatus(n) {
  return { 0: 'failed', 1: 'pending', 2: 'sent', 3: 'delivered', 4: 'read', 5: 'read' }[Number(n)] || '';
}

const RANK = { '': 0, pending: 1, sent: 2, delivered: 3, read: 4, failed: 5 };
/** A status may only move forward (a late "sent" must not undo "read"). */
export const laterStatus = (a, b) => ((RANK[b] ?? 0) > (RANK[a] ?? 0) ? b : a);

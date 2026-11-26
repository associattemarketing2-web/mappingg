import assert from 'node:assert/strict';
import test from 'node:test';
import { ackStatus, laterStatus, parseMessage, preview } from '../src/parse.js';

test('plain and extended text', () => {
  assert.deepEqual(parseMessage({ conversation: 'hi' }), { kind: 'text', body: 'hi' });
  assert.equal(parseMessage({ extendedTextMessage: { text: 'link https://x.y' } }).body, 'link https://x.y');
});

test('files keep type, caption and name', () => {
  const img = parseMessage({ imageMessage: { caption: 'flat', mimetype: 'image/jpeg', fileLength: 1200 } });
  assert.equal(img.kind, 'image'); assert.equal(img.body, 'flat'); assert.equal(img.media.mimetype, 'image/jpeg'); assert.equal(img.media.size, 1200);
  const doc = parseMessage({ documentWithCaptionMessage: { message: { documentMessage: { fileName: 'brochure.pdf', mimetype: 'application/pdf', caption: 'see' } } } });
  assert.equal(doc.kind, 'document'); assert.equal(doc.media.filename, 'brochure.pdf'); assert.equal(doc.body, 'see');
  assert.equal(preview(doc), '📄 brochure.pdf see');
  assert.equal(parseMessage({ audioMessage: { ptt: true, mimetype: 'audio/ogg' } }).media.voice, true);
});

test('disappearing-mode wrapper is unwrapped', () => {
  assert.equal(parseMessage({ ephemeralMessage: { message: { conversation: 'secret' } } }).body, 'secret');
});

test('non-chat messages are skipped', () => {
  assert.equal(parseMessage({ protocolMessage: { type: 0 } }), null);
  assert.equal(parseMessage({ reactionMessage: { text: '👍' } }), null);
  assert.equal(parseMessage(null), null);
});

test('ticks only move forward', () => {
  assert.equal(ackStatus(3), 'delivered'); assert.equal(ackStatus(4), 'read');
  assert.equal(laterStatus('read', 'delivered'), 'read');
  assert.equal(laterStatus('sent', 'read'), 'read');
});

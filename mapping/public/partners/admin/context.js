// Shared state for the admin views.
import { $ } from '../shared/lib.js';

export const ctx = { client: null, user: null, counts: null, leaveGuard: null };

// A view can block navigation while it has unsaved changes
export function setLeaveGuard(fn) { ctx.leaveGuard = fn; }

export async function refreshCounts() {
  const { data } = await ctx.client.rpc('admin_counts');
  ctx.counts = data || { by_status: {} };
  const bs = ctx.counts.by_status || {};
  const review = (bs.submitted || 0) + (bs.in_review || 0);
  const set = (k, v, hot) => {
    const el = $(`[data-count="${k}"]`);
    if (!el) return;
    el.textContent = v || '';
    el.classList.toggle('hot', !!hot && v > 0);
    el.style.display = v ? '' : 'none';
  };
  set('review', review, true);
  set('builders', ctx.counts.builders);
  set('live', ctx.counts.live);
  return ctx.counts;
}

// Signed URLs for private submission files (cached for the session)
const signed = new Map();
export async function previewUrl(path) {
  if (!path) return null;
  if (signed.has(path)) return signed.get(path);
  const { data, error } = await ctx.client.storage.from('submission-media').createSignedUrl(path, 3600);
  const url = error ? null : data.signedUrl;
  signed.set(path, url);
  return url;
}

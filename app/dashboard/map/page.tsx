import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { verificationOf } from '@/lib/verification';
import LegacyApp from '@/components/LegacyApp';
import LegacyPreloads from '@/components/LegacyPreloads';

export const dynamic = 'force-dynamic';

// Developers get a deliberately simpler editor than the super-admin: only the
// tools they need. These advanced pin fields are hidden in the sidebar…
const DEV_EDITOR_CSS = `
  #wrap-field-visibility, #wrap-pin-size, #wrap-public, #wrap-custom-fields { display: none !important; }
`;

// …and the toolbar is pruned to Add project, Lock/Unlock markers and Satellite.
// Everything else (infrastructure, roads/metro/boundary, boundary lock, leads,
// history, analytics, export, cards-data) is removed; editing a project is still
// done by clicking its pin. A pruning script is used (not just CSS) so fully
// emptied toolbar groups — which otherwise show a stray label chip — are hidden
// too. Runs on older iPad Safari, hence the plain-function / for-loop style.
const DEV_EDITOR_JS = `
window.MAPPINGG_DEV_EDIT = true;
(function () {
  var HIDE = ['btn-add-bridge','btn-draw-road','btn-draw-metro','btn-draw-boundary','btn-lock-boundary','btn-leads','btn-history','btn-tracking','btn-download-image','toggle-cards-data'];
  var done = false, obs = null;
  function prune() {
    if (!document.getElementById('btn-add-pin')) return false;
    for (var i = 0; i < HIDE.length; i++) {
      var el = document.getElementById(HIDE[i]);
      if (el) { el.style.display = 'none'; el.setAttribute('data-dev-hidden', '1'); }
    }
    var groups = document.querySelectorAll('#toolbar .tb-group');
    for (var g = 0; g < groups.length; g++) {
      var btns = groups[g].querySelectorAll('button, .btn'), visible = 0;
      for (var b = 0; b < btns.length; b++) {
        if (!btns[b].hasAttribute('data-dev-hidden') && btns[b].style.display !== 'none') visible++;
      }
      groups[g].style.display = visible ? '' : 'none';
    }
    return true;
  }
  function tryPrune() { if (!done && prune()) { done = true; if (obs) obs.disconnect(); } }
  function start() {
    tryPrune();
    try { obs = new MutationObserver(tryPrune); obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  window.addEventListener('load', tryPrune);
  setTimeout(tryPrune, 1500); setTimeout(tryPrune, 4000);
})();
`;

// Developer Map Editor — the SAME legacy editor the super-admin uses, but with a
// trimmed toolbar/sidebar (see DEV_EDITOR_CSS/JS above). Every pin read/write is
// owner-scoped server-side (see /api/db + lib/db-engine), so a developer only
// ever sees and edits their own projects, and each new/edited pin is held for
// super-admin review before it goes live. Gated to approved developers only.
export default async function DeveloperMapEditor() {
  const user = await getCurrentUser();
  if (!user) redirect('/?signin=1');
  if (user.role !== 'developer') redirect('/dashboard');

  const db = await getDb();
  const doc = await db.collection('users').findOne({ email: user.email.toLowerCase() });
  if (!doc || verificationOf(doc) !== 'approved') redirect('/dashboard');

  return (
    <>
      {/* Hide advanced pin fields, and flag this as the developer's own editor so
          db-shim.js treats the developer session as signed-in (writes stay
          owner-scoped + held for review). Both run before the bundle boots. */}
      <style dangerouslySetInnerHTML={{ __html: DEV_EDITOR_CSS }} />
      <script dangerouslySetInnerHTML={{ __html: DEV_EDITOR_JS }} />
      <LegacyPreloads slug="team-editor" />
      <LegacyApp slug="team-editor" />
    </>
  );
}

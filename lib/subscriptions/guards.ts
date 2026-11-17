import { NextResponse } from 'next/server';
import { isAvailable } from './db';
import { checkFeatureAccess, getEntitlements, hasFeature, limitOf, suggestUpgrade, validateProjectAccess, type AccessResult } from './entitlements';
import { developerProjectCount, publicPin } from './projects';
import { notifySub } from './notifications';
import { isoWeekKey } from './pricing';
import { subscriptionPath } from './notifications';

// Route-level guards: thin wrappers the existing API routes call so each one
// enforces the plan on the server with a consistent 402 response
// ({ error: { message, code, upgrade, usage, manage } }). Infrastructure
// failures in the subscription store never take the core site down: metering
// guards fail open (logged); they never grant a paid feature on error.

type User = { id: string; role: string };

function blocked(r: AccessResult, upgrade: { code: string; name: string } | null, category: string | null, extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    { error: { message: r.message || 'Upgrade your plan to continue.', code: r.code || 'upgrade_required', upgrade, manage: subscriptionPath(category as never), ...extra } },
    { status: 402, headers: { 'Cache-Control': 'private, no-store' } },
  );
}

/**
 * A CP / buyer opening a project's details (map "Enquire now", the details
 * panel, /api/subscriptions/access). Returns a 402 response when refused, else null.
 */
export async function guardProjectAccess(user: User | null, pinId: string): Promise<NextResponse | null> {
  if (!user || (user.role !== 'agent' && user.role !== 'buyer') || !isAvailable()) return null;
  try {
    const pin = await publicPin(pinId);
    if (!pin) return null; // the route itself answers 404
    const ent = await getEntitlements(user);
    const r = await validateProjectAccess(ent, pin);
    if (r.allowed) return null;
    if (r.code === 'limit_reached' && ent.category) {
      await notifySub(user.id, ent.category, 'limit_reached', {}, { dedupeKey: `limit:${user.id}:${ent.category === 'cp' ? isoWeekKey() : 'all'}`, email: false }).catch(() => {});
    }
    return blocked(r, await suggestUpgrade(ent, ent.category === 'cp' && r.code?.startsWith('city') ? 'cp_all_listings' : undefined), ent.category, { usage: 'usage' in r ? r.usage : undefined });
  } catch (e) {
    console.warn('[subscriptions] project access check failed (allowed):', e instanceof Error ? e.message : e);
    return null;
  }
}

/** A plan feature for the signed-in account (optionally for one of a developer's projects). */
export async function guardFeature(user: User, feature: string, projectId?: string): Promise<NextResponse | null> {
  if (!isAvailable()) return null;
  try {
    const ent = await getEntitlements(user);
    const r = checkFeatureAccess(ent, feature, { projectId });
    if (r.allowed) return null;
    return blocked(r, await suggestUpgrade(ent, feature), ent.category);
  } catch (e) {
    console.error('[subscriptions] feature check failed', e);
    return NextResponse.json({ error: { message: 'Could not check your plan. Please try again.' } }, { status: 503 });
  }
}

/** Developer listing limit: may this developer add `adding` more projects? */
export async function guardProjectLimit(user: User, adding: number): Promise<NextResponse | null> {
  if (user.role !== 'developer' || !isAvailable()) return null;
  try {
    const ent = await getEntitlements(user);
    const lim = limitOf(ent, 'dev_max_projects');
    if (lim == null) return null;
    const have = await developerProjectCount(user.id);
    if (have + adding <= lim) return null;
    const r: AccessResult = { allowed: !ent.enforced, wouldBlock: true, code: 'limit_reached', message: `Your plan lists up to ${lim} project${lim === 1 ? '' : 's'} (you have ${have}). Upgrade to list more — your existing projects stay as they are.` };
    if (r.allowed) return null;
    return blocked(r, await suggestUpgrade(ent), ent.category);
  } catch (e) {
    console.warn('[subscriptions] project limit check failed (allowed):', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Site-visit booking on a developer-owned project needs the developer's plan to
 * include it (Large and up). Projects Mappingg manages itself (no owner
 * account) keep site-visit booking for everyone, as before.
 */
export async function siteVisitAllowed(pinId: string): Promise<boolean> {
  if (!isAvailable()) return true;
  try {
    const pin = await publicPin(pinId);
    if (!pin?.owner) return true;
    const ent = await getEntitlements({ id: pin.owner, role: 'developer' });
    return !ent.enforced || hasFeature(ent, 'dev_site_visit_booking', { projectId: pin.id });
  } catch {
    return true;
  }
}

/** Plan flag for the current account without a response (for UI hints). */
export async function canUse(user: User, feature: string, projectId?: string): Promise<boolean> {
  if (!isAvailable()) return true;
  try {
    const ent = await getEntitlements(user);
    return checkFeatureAccess(ent, feature, { projectId }).allowed;
  } catch {
    return false;
  }
}

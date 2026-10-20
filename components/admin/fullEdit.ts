// "Edit all details" for a map pin: every project opens in the one full
// Projects Intake form (all intake fields), wherever it is clicked in the
// super-admin. Panels call requestFullEdit(pinId); AdminApp handles it (and the
// same request posted by the Map Editor iframe) — see useFullEditHandler.

export const FULL_EDIT_EVENT = 'mg:edit-pin';

/** Ask the super-admin shell to open this pin's full form. */
export function requestFullEdit(pinId: string) {
  window.dispatchEvent(new CustomEvent(FULL_EDIT_EVENT, { detail: { pinId } }));
}

/** The intake submission for a pin (an existing one, or a new linked one prefilled from the pin). */
export async function submissionForPin(pinId: string): Promise<{ submission_id: string; created: boolean }> {
  const res = await fetch('/api/partners/rpc/admin_open_for_pin', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_pin_id: pinId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body?.error?.message || `Could not open the full form (${res.status})`);
  return body.data;
}

// The super-admin is drawn at 90% (CSS `zoom`) on large screens. Pointer
// positions and getBoundingClientRect() are in screen pixels, while left/top
// set inside the admin are CSS pixels that get zoomed — divide by this first.
export function cssZoom(el: Element | null | undefined): number {
  const h = el as HTMLElement | null | undefined;
  if (!h || !h.offsetWidth) return 1;
  const z = h.getBoundingClientRect().width / h.offsetWidth;
  return z > 0 && Number.isFinite(z) ? z : 1;
}

// "Trusted by developers" section on the home page: the developer logos from
// Super admin → Developers in two scrolling rows — the first moves right to
// left, the second left to right (replaces the
// <!--DEV_LOGOS--> marker in body.ts). Each row's list is rendered twice so the
// CSS marquee loops without a gap; the copies are hidden from screen readers.

type Dev = { name: string; logo: string };

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Fewer logos than this would look empty rather than "trusted".
const MIN_LOGOS = 4;
// A second row only once there are enough logos to fill both.
const TWO_ROWS_FROM = 16;
// Each half of a track must be wider than the screen, so short lists repeat.
const MIN_PER_HALF = 14;

const item = (d: Dev, hidden: boolean) =>
  `<div class="trusted-logo${hidden ? ' dup' : ''}"${hidden ? ' aria-hidden="true"' : ''}><img src="${esc(d.logo)}" alt="${hidden ? '' : esc(d.name)}" title="${esc(d.name)}" loading="lazy" decoding="async"></div>`;

/** One scrolling row, right to left — or left to right with `reverse`. `secondsPerLogo` sets the speed. */
function row(devs: Dev[], secondsPerLogo: number, reverse = false): string {
  const repeats = Math.ceil(MIN_PER_HALF / devs.length);
  const half = Array.from({ length: repeats }, (_, r) => devs.map((d) => item(d, r > 0))).flat();
  const copy = half.map((_, i) => item(devs[i % devs.length], true));
  const duration = Math.round(half.length * secondsPerLogo);
  return `<div class="trusted-marquee">
      <div class="trusted-track${reverse ? ' rev' : ''}" style="animation-duration:${duration}s">
        ${half.join('')}${copy.join('')}
      </div>
    </div>`;
}

export function trustedDevelopersHtml(devs: Dev[]): string {
  if (devs.length < MIN_LOGOS) return '';
  const twoRows = devs.length >= TWO_ROWS_FROM;
  // Alternate logos between the rows so both get a mix of the biggest developers.
  const top = twoRows ? devs.filter((_, i) => i % 2 === 0) : devs;
  const bottom = twoRows ? devs.filter((_, i) => i % 2 === 1) : [];

  return `<section class="trusted-sec" aria-label="Trusted by developers">
  <div class="container">
    <div class="sec-head reveal">
      <span class="eyebrow"><span class="dot"></span>Developers on Mappingg</span>
      <h2>Trusted by <span class="accent">leading developers</span></h2>
      <p>Projects from these developers are live on the Mappingg map.</p>
    </div>
  </div>
  <div class="trusted-rows">
    ${row(top, 3.2)}
    ${bottom.length ? row(bottom, 3.2, true) : ''}
  </div>
</section>`;
}

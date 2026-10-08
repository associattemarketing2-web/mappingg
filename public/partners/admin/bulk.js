// Tick rows → act on all of them. Shared by the intake list views (builders,
// live projects). Uses the .bulk-bar / td.pick styles from admin.css.
import { h, esc, $ } from '../shared/lib.js';

/**
 * @param {{ actions: { act: string, label: string, tone?: string }[], onAction: (act: string, ids: string[]) => void }} opts
 * Returns the bar element plus helpers for a table's header / row cells.
 */
export function createBulk({ actions, onAction }) {
  const selected = new Set();
  let redraw = () => {};
  const bar = h(`<div class="bulk-bar" hidden>
    <b class="bulk-n"></b>
    ${actions.map(a => `<button class="btn ${a.tone || 'ghost'} sm" data-act="${esc(a.act)}">${esc(a.label)}</button>`).join('')}
    <button class="btn ghost sm" data-act="clear">Clear selection</button>
  </div>`);
  bar.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'clear') { selected.clear(); redraw(); return; }
    onAction(act, [...selected]);
  });
  const sync = () => {
    bar.hidden = !selected.size;
    $('.bulk-n', bar).textContent = `${selected.size} selected`;
  };
  return {
    bar,
    selected,
    /** Call at the start of each draw with that draw function. */
    attach(draw) { redraw = draw; sync(); },
    status(text) { $('.bulk-n', bar).textContent = text; },
    /** `<th>` with a select-all box for the ids currently shown. */
    headCell(ids) {
      const th = h('<th class="pick"><input type="checkbox" aria-label="Select all shown"></th>');
      const box = $('input', th);
      const n = ids.filter(id => selected.has(id)).length;
      box.checked = ids.length > 0 && n === ids.length;
      box.indeterminate = n > 0 && n < ids.length;
      box.addEventListener('change', () => { ids.forEach(id => (box.checked ? selected.add(id) : selected.delete(id))); redraw(); });
      return th;
    },
    /** `<td>` with this row's box; clicks don't open the row. */
    rowCell(id, label) {
      const td = h(`<td class="pick"><input type="checkbox" aria-label="Select ${esc(label)}" ${selected.has(id) ? 'checked' : ''}></td>`);
      td.addEventListener('click', e => e.stopPropagation());
      $('input', td).addEventListener('change', e => { e.target.checked ? selected.add(id) : selected.delete(id); redraw(); });
      return td;
    },
  };
}

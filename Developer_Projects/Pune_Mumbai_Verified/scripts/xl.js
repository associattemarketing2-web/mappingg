// Sheet styling: bold frozen header, filters, readable widths. Numbers stay numbers; RERA numbers stay text.
function styleSheet(ws, data, note) {
  let start = 1;
  if (note) { ws.getCell('A1').value = note; ws.getCell('A1').font = { italic: true, color: { argb: 'FF555555' } }; start = 2; }
  const cols = Object.keys(data[0] || { info: '' });
  ws.getRow(start).values = cols;
  ws.getRow(start).font = { bold: true };
  ws.getRow(start).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
  for (const r of data) ws.addRow(cols.map((c) => (r[c] == null ? null : typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c])));
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    const len = Math.max(c.length, ...data.slice(0, 300).map((r) => String(r[c] ?? '').length));
    col.width = Math.min(60, Math.max(10, len + 2));
    if (/^(lat|lng|latitude|longitude)/i.test(c)) col.numFmt = '0.000000';
    if (/rera|pincode|registration_no/i.test(c)) col.eachCell((cell, n) => { if (n > start && cell.value != null) cell.value = String(cell.value); });
  });
  ws.views = [{ state: 'frozen', ySplit: start }];
  ws.autoFilter = { from: { row: start, column: 1 }, to: { row: start, column: cols.length } };
}
module.exports = { styleSheet };

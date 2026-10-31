import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, deflateSync } from 'node:zlib';
import { extractRecipients } from '../lib/wa-bulk';

/** Minimal zip writer (deflate) — enough to build .xlsx / .docx fixtures. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text, 'utf8'));
    const n = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data);
    central.push(ch, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const phones = (r: ReturnType<typeof extractRecipients>) => r.recipients.map((x) => x.phone);

test('CSV with phone + name columns, duplicates and bad numbers', () => {
  const csv = 'Name,Mobile Number,City\nRahul,98765 43210,Pune\nPriya,+91-9876543211,Mumbai\nRahul again,919876543210,Pune\nBad,12345,Pune\nZero,09876543212,Pune\n';
  const r = extractRecipients(Buffer.from(csv), 'leads.csv');
  assert.deepEqual(phones(r), ['919876543210', '919876543211', '919876543212']);
  assert.equal(r.recipients[0].name, 'Rahul');
  assert.equal(r.recipients[0].phone_display, '+91 98765 43210');
  assert.equal(r.duplicates, 1);
  assert.deepEqual(r.invalid, ['12345']);
});

test('pasted list: one per line, commas, names next to numbers', () => {
  const r = extractRecipients(Buffer.from('9876543210\n+91 98765 43211, Amit\n9876543212 9876543213'), '');
  assert.deepEqual(phones(r), ['919876543210', '919876543211', '919876543212', '919876543213']);
  assert.equal(r.recipients[1].name, 'Amit');
});

test('Excel .xlsx: shared strings, numeric cells, E notation', () => {
  const sheet = `<worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
    <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>9876543210</v></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Neha &amp; Co</t></is></c><c r="B3"><v>9.876543211E9</v></c></row>
    <row r="4"><c r="B4" t="s"><v>3</v></c></row>
  </sheetData></worksheet>`;
  const shared = '<sst><si><t>Customer Name</t></si><si><t>WhatsApp</t></si><si><t>Sanjay</t></si><si><t>+91 98765 43212</t></si></sst>';
  const r = extractRecipients(zip({ 'xl/workbook.xml': '<workbook/>', 'xl/sharedStrings.xml': shared, 'xl/worksheets/sheet1.xml': sheet }), 'list.xlsx');
  assert.deepEqual(phones(r), ['919876543210', '919876543211', '919876543212']);
  assert.deepEqual(r.recipients.map((x) => x.name), ['Sanjay', 'Neha & Co', '']);
  assert.equal(r.format, 'Excel');
});

test('Word .docx', () => {
  const doc = '<w:document><w:body><w:p><w:r><w:t>Call 98765 43210</w:t></w:r></w:p><w:p><w:r><w:t>+919876543211</w:t></w:r></w:p></w:body></w:document>';
  assert.deepEqual(phones(extractRecipients(zip({ 'word/document.xml': doc }), 'n.docx')), ['919876543210', '919876543211']);
});

test('text PDF with a compressed content stream', () => {
  const content = deflateSync(Buffer.from('BT /F1 12 Tf 72 700 Td (Rahul 9876543210) Tj 0 -14 Td [(98765) -50 (43211)] TJ T* <FEFF002B00390031002000390038003700360035003400330032003100320020> Tj ET'));
  const pdf = Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
    content,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);
  assert.deepEqual(phones(extractRecipients(pdf, 'numbers.pdf')), ['919876543210', '919876543211', '919876543212']);
});

test('PDF without readable text and old .xls give a clear error', () => {
  assert.throws(() => extractRecipients(Buffer.from('%PDF-1.4\n%%EOF'), 'scan.pdf'), /CSV or Excel/);
  assert.throws(() => extractRecipients(Buffer.from('d0cf11e0a1b11ae1', 'hex'), 'old.xls'), /\.xlsx or CSV/);
});

test('vCard contacts', () => {
  const vcf = 'BEGIN:VCARD\nFN:Ravi Kumar\nTEL;TYPE=CELL:+91 98765 43210\nEND:VCARD\nBEGIN:VCARD\nFN:Meena\nTEL:09876543211\nEND:VCARD\n';
  const r = extractRecipients(Buffer.from(vcf), 'contacts.vcf');
  assert.deepEqual(r.recipients.map((x) => [x.phone, x.name]), [['919876543210', 'Ravi Kumar'], ['919876543211', 'Meena']]);
});

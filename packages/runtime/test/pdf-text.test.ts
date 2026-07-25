// `pdf-text.ts` unit tests (gap #19, PLAN_GAPS_19.md D19.6/D19.7) — exercises a hand-built,
// multi-page, `TJ`-kerning-array-bearing fixture PDF, built the same way
// `apiV2/src/orders/order-receipt.util.ts` (the app this grammar was built to consume) builds its
// own, so the extractor is tested against exactly the shape it claims to support. Runtime
// integration (the `body pdf text` subject itself) is covered separately in
// `body-csv-pdf.test.ts`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { RuntimeError } from '../src/eval.js';
import { extractPdfText } from '../src/pdf-text.js';

const PDF_HEADER = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);

/** Builds a minimal, well-formed multi-page PDF from raw content-stream strings — same
 * catalog/pages/font/xref/trailer shape `order-receipt.util.ts` writes, generalized to accept
 * caller-supplied PDF operators directly (so a test can embed a `TJ` array without going through
 * `pdfEscape`/`Tj`-only helper). `compress: false` produces an uncompressed (no `/Filter`)
 * content stream, exercising the extractor's "else treat as raw bytes" branch. */
function buildTestPdf(contents: string[], opts: { compress?: boolean } = {}): Buffer {
  const compress = opts.compress !== false;
  const pageCount = contents.length;
  const firstPageObjNum = 3;
  const fontObjNum = firstPageObjNum + pageCount;
  const firstContentObjNum = fontObjNum + 1;

  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>\n', 'ascii'),
    Buffer.from(
      `<< /Type /Pages /Kids [${contents.map((_, i) => `${firstPageObjNum + i} 0 R`).join(' ')}] /Count ${pageCount} >>\n`,
      'ascii',
    ),
  ];
  for (let i = 0; i < pageCount; i++) {
    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /MediaBox [0 0 612 792] /Contents ${firstContentObjNum + i} 0 R >>\n`,
        'ascii',
      ),
    );
  }
  objects.push(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\n', 'ascii'));
  for (const c of contents) {
    const raw = Buffer.from(c, 'ascii');
    const payload = compress ? deflateSync(raw) : raw;
    const filterEntry = compress ? ' /Filter /FlateDecode' : '';
    objects.push(
      Buffer.concat([
        Buffer.from(`<< /Length ${payload.length}${filterEntry} >>\nstream\n`, 'ascii'),
        payload,
        Buffer.from('\nendstream\n', 'ascii'),
      ]),
    );
  }

  const parts: Buffer[] = [PDF_HEADER];
  const offsets: number[] = [0];
  let cursor = parts[0]!.length;
  for (let i = 0; i < objects.length; i++) {
    offsets.push(cursor);
    const objBuf = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'ascii'), objects[i]!, Buffer.from('endobj\n', 'ascii')]);
    parts.push(objBuf);
    cursor += objBuf.length;
  }
  const xrefOffset = cursor;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) xref += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  parts.push(Buffer.from(xref, 'ascii'));

  return Buffer.concat(parts);
}

test('extracts text from a single-page, Tj-only, FlateDecode-compressed PDF', () => {
  const pdf = buildTestPdf(['BT\n/F1 11 Tf\n72 740 Td\n14 TL\n(Line one) Tj\nT*\n(Line two) Tj\nET']);
  assert.equal(extractPdfText(pdf), 'Line one\nLine two');
});

test('extracts text from a multi-page PDF, including a TJ kerning array and escaped parens/backslash on page 2', () => {
  const page1 = 'BT\n/F1 11 Tf\n72 740 Td\n14 TL\n(Line one) Tj\nT*\n(Line two) Tj\nET';
  const page2 = 'BT\n/F1 11 Tf\n72 740 Td\n14 TL\n[(Hel) -20 (lo, World)] TJ\nT*\n(Total: $19.98 \\(paid\\) C:\\\\temp) Tj\nET';
  const pdf = buildTestPdf([page1, page2]);
  assert.equal(extractPdfText(pdf), 'Line one\nLine two\n\nHello, World\nTotal: $19.98 (paid) C:\\temp');
});

test('extracts text from an uncompressed (no /Filter) content stream', () => {
  const pdf = buildTestPdf(['BT\n/F1 11 Tf\n72 740 Td\n14 TL\n(Raw bytes, no FlateDecode) Tj\nET'], { compress: false });
  assert.equal(extractPdfText(pdf), 'Raw bytes, no FlateDecode');
});

test('throws a RuntimeError naming the problem when there is no /trailer at all', () => {
  assert.throws(
    () => extractPdfText(Buffer.from('not a pdf at all', 'ascii')),
    (err: unknown) => err instanceof RuntimeError && /no \/trailer found \(is this response actually a PDF\?\)/.test(err.message),
  );
});

test('throws a RuntimeError when the trailer has no /Root reference', () => {
  const junk = Buffer.from('%PDF-1.4\ntrailer\n<< /Size 1 >>\nstartxref\n0\n%%EOF', 'ascii');
  assert.throws(
    () => extractPdfText(junk),
    (err: unknown) => err instanceof RuntimeError && /trailer has no \/Root reference/.test(err.message),
  );
});

test('throws a RuntimeError when /Root points at an object that does not exist', () => {
  const junk = Buffer.from('%PDF-1.4\ntrailer\n<< /Size 1 /Root 99 0 R >>\nstartxref\n0\n%%EOF', 'ascii');
  assert.throws(
    () => extractPdfText(junk),
    (err: unknown) => err instanceof RuntimeError && /no \/Catalog object found/.test(err.message),
  );
});

test('throws a RuntimeError when a page has no /Contents reference', () => {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n',
  ].join('');
  const junk = Buffer.from(`%PDF-1.4\n${objects}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n0\n%%EOF`, 'ascii');
  assert.throws(
    () => extractPdfText(junk),
    (err: unknown) => err instanceof RuntimeError && /no \/Contents stream found on page 3 0 R/.test(err.message),
  );
});

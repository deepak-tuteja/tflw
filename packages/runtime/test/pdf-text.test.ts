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
function buildTestPdf(contents: string[], opts: { compress?: boolean; level?: number } = {}): Buffer {
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
    const payload = compress ? deflateSync(raw, opts.level === undefined ? {} : { level: opts.level }) : raw;
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

// ---- D173: a stream's extent is its `/Length`, not a scan of its bytes ------------------------
//
// A stream holds *binary* data, and the old parser located its end by text: slice to `endstream`,
// then `.replace(/\r?\n$/, '')` to drop the EOL a writer puts before that keyword. When the
// compressed data's own last byte is CR (0x0D) the slice ends `\x0D\x0A` and that regex eats
// **both** — one byte of real deflate output, gone. `inflateSync` then throws `unexpected end of
// file`, which is how it reached testFlow-tests' CI (`31176634985`, page 3 0 R).
//
// Measured on 40,000 receipt-shaped payloads: 0.36% end in CR. That is the "red once, green on the
// re-run" rate, and it is why a re-run passing is not evidence — the draw changed, not the code.
// The first test below is that mechanism, at a fixed payload so it fires every time.
//
// Scanning has a second, far rarer failure: `endstream`/`endobj` occurring *inside* the compressed
// bytes (~1e-11 for a receipt — real, but never the cause here). Both go away for the same reason:
// `/Length` states the byte count and nothing has to be inferred from the data.

test('a content stream whose compressed bytes end in CR keeps that byte', () => {
  // The actual CI failure. This exact string was found by searching receipt-shaped inputs for one
  // whose deflate output ends in 0x0D; everything about it is ordinary except that last byte.
  const content = 'BT\n/F1 11 Tf\n72 740 Td\n14 TL\n(Receipt total $14.99) Tj\nET';

  // Control, and the load-bearing part: if a zlib version ever changes its output for this input,
  // the payload stops ending in CR and the test below would pass against *either* parser while
  // appearing to still cover the bug. Asserting the precondition makes that a loud failure rather
  // than a silent one.
  const payload = deflateSync(Buffer.from(content, 'ascii'));
  assert.equal(payload[payload.length - 1], 0x0d, 'fixture precondition: the deflate stream must end in CR');

  assert.equal(extractPdfText(buildTestPdf([content])), 'Receipt total $14.99');
});

/** Occurrences of `needle` in `pdf` — the control for the two tests below. Each asserts a *decoy*
 * exists before the stream's real terminator; without that assertion the test would pass against
 * the scanning parser too, and prove nothing. */
const countOf = (pdf: Buffer, needle: string): number => pdf.toString('latin1').split(needle).length - 1;

for (const sentinel of ['endstream', 'endobj'] as const) {
  test(`a content stream whose bytes contain a literal \`${sentinel}\` is read to its full /Length`, () => {
    const text = `A receipt line mentioning ${sentinel} inline`;
    const pdf = buildTestPdf([`BT\n/F1 11 Tf\n72 740 Td\n14 TL\n(${text}) Tj\nET`], { level: 0 });

    // Control: the same PDF with the word removed from the text, so the count difference isolates
    // the decoy from the PDF's own structural occurrences. Exactly one more means the stream data
    // itself holds a `${sentinel}` for a scan to hit first — the only reason this test can tell the
    // two parsers apart. Self-calibrating, so adding an object to the fixture cannot quietly turn
    // it vacuous.
    const clean = buildTestPdf([`BT\n/F1 11 Tf\n72 740 Td\n14 TL\n(A receipt line mentioning inline) Tj\nET`], { level: 0 });
    assert.equal(countOf(pdf, sentinel), countOf(clean, sentinel) + 1, `the fixture must embed a decoy \`${sentinel}\` in the stream`);

    assert.equal(extractPdfText(pdf), text);
  });
}

test('an indirect `/Length N 0 R` is resolved rather than falling back to the scan', () => {
  // The spelling a writer emits when it streams an object out before knowing its own size. Without
  // resolution this silently degrades to the scanning behaviour the tests above forbid.
  const content = 'BT\n/F1 11 Tf\n72 740 Td\n(Indirect length) Tj\nET';
  const payload = deflateSync(Buffer.from(content, 'ascii'));
  const objects = [
    Buffer.from('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n', 'ascii'),
    Buffer.from('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n', 'ascii'),
    Buffer.from('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n', 'ascii'),
    Buffer.concat([
      Buffer.from('4 0 obj\n<< /Length 5 0 R /Filter /FlateDecode >>\nstream\n', 'ascii'),
      payload,
      Buffer.from('\nendstream\nendobj\n', 'ascii'),
    ]),
    Buffer.from(`5 0 obj\n${payload.length}\nendobj\n`, 'ascii'),
    Buffer.from('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF', 'ascii'),
  ];
  assert.equal(extractPdfText(Buffer.concat([Buffer.from('%PDF-1.4\n', 'ascii'), ...objects])), 'Indirect length');
});

test('a stream with no /Length at all still reads, by scanning', () => {
  // The fallback is retained deliberately: `/Length` is required by the spec but a hand-rolled
  // writer can omit it, and scanning is right far more often than throwing is.
  const content = 'BT\n/F1 11 Tf\n72 740 Td\n(No length key) Tj\nET';
  const objects = [
    '%PDF-1.4\n',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< >>\nstream\n${content}\nendstream\nendobj\n`,
    'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n0\n%%EOF',
  ].join('');
  assert.equal(extractPdfText(Buffer.from(objects, 'latin1')), 'No length key');
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
